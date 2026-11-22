// Starts the built Worker for the `auth-pages` Playwright project
// (playwright.config.ts runs it as its second webServer, #273). Unlike
// e2e/server.mjs, which trusts the persona headers, this server runs the
// default built-in account mode (`local`, docs/security/identity.md): no
// IDENTITY_MODE, so the Worker serves its own setup, sign-in, sign-up and
// password pages. Every start deletes .wrangler/e2e-auth and migrates an empty
// local D1 database there, so the first visit is offered /auth/setup. It never
// touches .wrangler/e2e-state (the persona server's) or .wrangler/state (the
// one `npm run dev` and `npm start` use), so both servers can run side by side.
// It loads the build in Miniflare once, as e2e/server.mjs does (#194).
//
//   npm run build && node e2e/auth-server.mjs [port]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProblems } from "./build-files.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.argv[2] ?? process.env.E2E_AUTH_PORT ?? "8791");
const state = ".wrangler/e2e-auth";
const server = path.join(projectRoot, "dist/server");
const config = path.join(server, "wrangler.json");

// Refuse an incomplete build before the database is reset (#199).
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

await import("../scripts/wrangler-env.mjs");
const { Log, LogLevel, Miniflare, convertV4MiniflareOptions } =
  await import("miniflare");
const { unstable_getMiniflareWorkerOptions } = await import("wrangler");

const options = unstable_getMiniflareWorkerOptions(config);
const { workerOptions } = options;
const main = path
  .relative(server, path.resolve(server, options.main))
  .replaceAll("\\", "/");
const modules = [
  main,
  ...readdirSync(server, { recursive: true })
    .map((file) => String(file).replaceAll("\\", "/"))
    .filter((file) => file !== main && /\.m?js$/.test(file)),
];

// The build's own variables, minus any identity setting, so the Worker runs
// in its default mode as a self-hosted installation does.
const bindings = { ...workerOptions.bindings };
for (const key of Object.keys(bindings))
  if (key.startsWith("IDENTITY_")) delete bindings[key];

const mf = new Miniflare(
  convertV4MiniflareOptions({
    ...workerOptions,
    name: "ai-assurance-workspace-e2e-auth",
    modules: modules.map((file) => ({
      type: "ESModule",
      path: path.join(server, file),
    })),
    modulesRoot: server,
    bindings: {
      ...bindings,
      // Only the owner may found a practice; everyone else joins by invitation.
      SELF_SIGNUP: "off",
      // A throwaway key for this run: it keys the invitation sign-up links,
      // which exist only with DOSSIER_KEK (docs/security/identity.md).
      DOSSIER_KEK: randomBytes(32).toString("base64"),
    },
    resourcePersistencePath: path.join(projectRoot, state, "v3"),
    host: "127.0.0.1",
    port,
    log: new Log(LogLevel.WARN),
  }),
);
const url = await mf.ready;
console.log(`E2E auth Worker ready on ${url.origin}`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    mf.dispose().finally(() => process.exit(0));
  });
