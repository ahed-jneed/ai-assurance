// Early refusals on a keep-alive connection (#209): a POST the Worker refuses
// before reading its body (the same-origin check's 403, the runner bearer
// check's 401) must not leave that body on the connection, or the next
// request on it hangs or gets a 503 from the local Worker. Sends each refused
// POST and then a GET over one raw socket to the built Worker's real HTTP
// listener (Miniflare, as `npm start` runs it locally). Needs `npm run build`
// first.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Miniflare } from "miniflare";
import "./harness/env.mjs";

const modules = [
  "index.js",
  ...(await fs.readdir("dist/server", { recursive: true })).filter(
    (p) => p !== "index.js" && /\.m?js$/.test(p),
  ),
];
const mf = new Miniflare({
  modules: modules.map((p) => ({
    type: "ESModule",
    path: path.resolve("dist/server", p),
  })),
  modulesRoot: path.resolve("dist/server"),
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    IDENTITY_MODE: "trusted-headers",
    IDENTITY_TRUSTED_HEADERS: "loopback-tests",
  },
  d1Databases: { DB: "refused-body" },
  r2Buckets: { BUCKET: "refused-body-evidence" },
  d1Persist: false,
  r2Persist: false,
});

/** The status lines of every response read from the socket so far. */
const statuses = (text) =>
  [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]));

/**
 * Sends `first` (head plus body) and then a GET on the same socket, and
 * returns the two statuses, or null for the second when it never arrives.
 */
async function sameConnection(url, first, body) {
  const socket = net.connect(Number(url.port), url.hostname);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  let text = "";
  socket.on("data", (chunk) => (text += chunk.toString("latin1")));
  socket.on("error", () => {});
  const until = async (done, ms) => {
    const end = Date.now() + ms;
    while (!done() && Date.now() < end)
      await new Promise((resolve) => setTimeout(resolve, 25));
  };
  try {
    socket.write(first + "Content-Length: " + body.length + "\r\n\r\n");
    socket.write(body);
    await until(() => statuses(text).length >= 1, 10000);
    socket.write(
      "GET /api/workspace HTTP/1.1\r\nHost: " +
        url.host +
        "\r\nConnection: close\r\n\r\n",
    );
    await until(() => statuses(text).length >= 2 || socket.destroyed, 10000);
    const [refused, next = null] = statuses(text);
    return { refused, next };
  } finally {
    socket.destroy();
  }
}

try {
  const url = await mf.ready;
  const head = (target, extra = "") =>
    "POST " +
    target +
    " HTTP/1.1\r\nHost: " +
    url.host +
    "\r\nContent-Type: application/json\r\nConnection: keep-alive\r\n" +
    extra;
  for (const size of [64, 256 * 1024]) {
    const body = JSON.stringify({ padding: "x".repeat(size) });
    // No Origin header: the same-origin check refuses with 403.
    assert.deepEqual(
      await sameConnection(url, head("/api/workspace"), body),
      { refused: 403, next: 401 },
      "the request after a refused cross-origin POST of " + size + " bytes",
    );
    // A malformed bearer token: the runner refuses with 401.
    assert.deepEqual(
      await sameConnection(
        url,
        head("/api/runner", "Authorization: Bearer not-a-token\r\n"),
        body,
      ),
      { refused: 401, next: 401 },
      "the request after a refused runner POST of " + size + " bytes",
    );
  }
  // A body over the management limit: readBounded stops reading and
  // cancels with 413 partway through.
  assert.deepEqual(
    await sameConnection(
      url,
      head("/api/management", "Origin: " + url.origin + "\r\n"),
      JSON.stringify({ padding: "x".repeat(256 * 1024) }),
    ),
    { refused: 413, next: 401 },
    "the request after a POST refused partway through its body",
  );
  console.log(
    "PASS a request refused before its body is read leaves the keep-alive connection usable",
  );
} finally {
  await mf.dispose();
}
