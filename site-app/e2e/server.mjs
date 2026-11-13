// Starts the built Worker for the Playwright persona suite (playwright.config.ts
// runs it as its webServer). Every run starts from an empty local D1 database
// in .wrangler/e2e-state, so the suite never depends on, or changes, the
// .wrangler/state that `npm run dev` and `npm start` use. The Worker trusts the
// oai-authenticated-user-* headers each persona's browser context sends
// (IDENTITY_MODE=trusted-headers, loopback only; docs/security/identity.md).
// Self-signup is off outside the development server, so the Worker allows it
// for the persona domain only (SELF_SIGNUP=@personas.test): qa-lead, qa-lead2
// and qa-outsider provision the practices the specs expect, and any other
// identity is still refused.
//
//   npm run build && node e2e/server.mjs [port]
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const port = process.argv[2] ?? process.env.E2E_PORT ?? "8790";
const state = ".wrangler/e2e-state";

if (!existsSync(path.join(projectRoot, "dist/server/wrangler.json"))) {
  console.error("dist/server is missing; run `npm run build` first.");
  process.exit(1);
}
rmSync(path.join(projectRoot, state), { recursive: true, force: true });
const migrate = spawnSync(
  process.execPath,
  ["scripts/db-migrate-local.mjs", "--persist-to", state],
  { cwd: projectRoot, stdio: "inherit" },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const worker = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/sites-env.mjs",
    "./node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--config",
    "dist/server/wrangler.json",
    "--local",
    "--persist-to",
    state,
    "--ip",
    "127.0.0.1",
    "--port",
    port,
    "--inspector-port",
    "0",
    "--show-interactive-dev-session=false",
    "--var",
    "IDENTITY_MODE:trusted-headers",
    "--var",
    "IDENTITY_TRUSTED_HEADERS:loopback-tests",
    "--var",
    "SELF_SIGNUP:@personas.test",
    // A throwaway key-encryption key for this run's practice signing keys,
    // so the dossier specs can seal (docs/security/signing-keys.md). The
    // database it wraps keys in is deleted at the next start.
    "--var",
    "DOSSIER_KEK:" + randomBytes(32).toString("base64"),
  ],
  { cwd: projectRoot, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => worker.kill(signal));
worker.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
