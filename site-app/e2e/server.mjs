// Starts the built Worker for the Playwright persona suite (playwright.config.ts
// runs it as its webServer). Every run starts from an empty local D1 database
// in .wrangler/e2e-state, so the suite never depends on, or changes, the
// .wrangler/state that `npm run dev` and `npm start` use. The Worker trusts the
// x-assurance-user-* headers each persona's browser context sends
// (IDENTITY_MODE=trusted-headers, loopback only; docs/security/identity.md).
// Self-signup is off outside the development server, so the Worker allows it
// for the persona domain only (SELF_SIGNUP=@personas.test): qa-lead, qa-lead2
// and qa-outsider provision the practices the specs expect, and any other
// identity is still refused.
//
// The Worker runs in Miniflare directly, as the check harnesses run it
// (scripts/harness/worker.mjs), not under `wrangler dev` (#194). `wrangler dev`
// is a development server: it watches dist/server, and on any change it
// pauses its proxy, queues every request until the reload completes and then
// replays only GET and HEAD. A build in the same checkout during a run (for
// example `npm run check` beside `npm run test:e2e`) deletes and rewrites
// dist/, so a request was held across the reload or never answered, and the
// proxy's extra hop to the Worker reported `Network connection lost`. The
// suite tests a fixed build, so the server loads it once and serves it on one
// hop: a request is answered by the Worker or fails, never queued.
//
//   npm run build && node e2e/server.mjs [port]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProblems } from "./build-files.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.argv[2] ?? process.env.E2E_PORT ?? "8790");
const state = ".wrangler/e2e-state";
const server = path.join(projectRoot, "dist/server");
const config = path.join(server, "wrangler.json");

// Refuse an incomplete build at once (#199), before the database is reset:
// an interrupted build can leave wrangler.json beside missing modules.
const problems = buildProblems(server);
if (problems.length) {
  console.error(
    [
      "dist/server is not a complete build; run `npm run build` first.",
      ...problems.slice(0, 10).map((p) => "  - " + p),
      ...(problems.length > 10 ? [`  - and ${problems.length - 10} more`] : []),
    ].join("\n"),
  );
  process.exit(1);
}
rmSync(path.join(projectRoot, state), { recursive: true, force: true });
const migrate = spawnSync(
  process.execPath,
  ["scripts/db-migrate-local.mjs", "--persist-to", state],
  { cwd: projectRoot, stdio: "inherit" },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

// The same environment `wrangler dev` gets from wrangler-env.mjs (no metrics or
// log files in the checkout); importing it also moves to the project root.
await import("../scripts/wrangler-env.mjs");
const { Log, LogLevel, Miniflare } = await import("miniflare");
const { unstable_getMiniflareWorkerOptions } = await import("wrangler");

// The bindings, compatibility settings and static assets of the build's
// wrangler.json, read the way `wrangler dev` reads them.
const options = unstable_getMiniflareWorkerOptions(config);
const { workerOptions } = options;
const main = path
  .relative(server, path.resolve(server, options.main))
  .replaceAll("\\", "/");
// Every module of the build, entry first: the build is not bundled
// (no_bundle) and loads its chunks dynamically, so each one is attached, as
// `wrangler dev` attaches them.
const modules = [
  main,
  ...readdirSync(server, { recursive: true })
    .map((file) => String(file).replaceAll("\\", "/"))
    .filter((file) => file !== main && /\.m?js$/.test(file)),
];

const mf = new Miniflare({
  ...workerOptions,
  name: "ai-assurance-workspace-e2e",
  modules: modules.map((file) => ({
    type: "ESModule",
    path: path.join(server, file),
  })),
  modulesRoot: server,
  bindings: {
    ...workerOptions.bindings,
    IDENTITY_MODE: "trusted-headers",
    IDENTITY_TRUSTED_HEADERS: "loopback-tests",
    SELF_SIGNUP: "@personas.test",
    // A throwaway key-encryption key for this run's practice signing keys,
    // so the dossier specs can seal (docs/security/signing-keys.md). The
    // database it wraps keys in is deleted at the next start.
    DOSSIER_KEK: randomBytes(32).toString("base64"),
  },
  // The D1 database and R2 bucket that db-migrate-local.mjs migrated, at the
  // path `wrangler dev --persist-to` uses.
  defaultPersistRoot: path.join(projectRoot, state, "v3"),
  host: "127.0.0.1",
  port,
  log: new Log(LogLevel.WARN),
});
const url = await mf.ready;
console.log(`E2E Worker ready on ${url.origin}`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    mf.dispose().finally(() => process.exit(0));
  });
