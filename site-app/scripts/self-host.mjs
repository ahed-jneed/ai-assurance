// Runs the workspace on this machine with one command, like a self-hosted
// app: builds it if needed, creates the secrets on first start, applies the
// database migrations and serves it. All data stays in one directory.
//
//   npm run self-host                                 (http://127.0.0.1:8787)
//   PORT=3000 npm run self-host
//   npm run self-host -- --rebuild                    (after an upgrade)
//   npm run self-host -- reset-password owner@example.com
//
// --rebuild builds the workspace again before it starts. Without it an
// existing build (dist/) is reused, so after `git pull` and `npm ci` the old
// version would still be served. The Docker image does not need it: a new
// image holds a new build. See docs/self-hosting/upgrading.md.
//
// Settings (environment variables):
//   PORT       port to listen on (default 8787)
//   HOST       address to listen on (default 127.0.0.1; the Docker image uses 0.0.0.0)
//   DATA_DIR   where the database, evidence and secrets live (default ./data)
//
// The first visit asks for the owner account (docs/security/identity.md).
import { spawnSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
process.chdir(projectRoot);
const dataDir = path.resolve(process.env.DATA_DIR || "data");
const stateDir = path.join(dataDir, "state");
const secretsFile = path.join(dataDir, "secrets.env");
const config = "dist/server/wrangler.json";
const wrangler = [
  "--import",
  "./scripts/wrangler-env.mjs",
  "./node_modules/wrangler/bin/wrangler.js",
];

function run(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

/** DOSSIER_KEK signs reports and sign-up links; created once, kept in DATA_DIR. */
function ensureSecrets() {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(secretsFile)) {
    writeFileSync(
      secretsFile,
      "# Created by npm run self-host. Keep this file private and back it up with the data:\n" +
        "# without DOSSIER_KEK, signed reports cannot be signed again with the same keys.\n" +
        `DOSSIER_KEK=${randomBytes(32).toString("base64")}\n`,
      { mode: 0o600 },
    );
    console.log(`Created ${secretsFile}`);
  }
  try {
    chmodSync(secretsFile, 0o600);
  } catch {
    // Not every file system has POSIX modes (for example a Windows volume).
  }
  if (!/^DOSSIER_KEK=\S+$/m.test(readFileSync(secretsFile, "utf8"))) {
    console.error(`${secretsFile} has no DOSSIER_KEK line.`);
    process.exit(1);
  }
}

function ensureBuild() {
  if (existsSync(config) && !process.argv.includes("--rebuild")) return;
  console.log("Building the workspace (first start only)...");
  run(["./scripts/run-framework.mjs", "build"]);
}

function migrate() {
  run(["./scripts/db-migrate-local.mjs", "--persist-to", stateDir]);
}

/** As lib/local-auth.ts hashes passwords. */
function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  return [
    "pbkdf2-sha256",
    100_000,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

function resetPassword(email) {
  if (!email || !/^[^\s@']+@[^\s@']+$/.test(email)) {
    console.error("Usage: npm run self-host -- reset-password <email>");
    process.exit(1);
  }
  ensureBuild();
  migrate();
  const password = randomBytes(12).toString("base64url");
  const normalized = email.trim().toLowerCase();
  const sql =
    `UPDATE local_accounts SET password_hash='${hashPassword(password)}',password_changed_at='${new Date().toISOString()}',failed_attempts=0,locked_until=NULL WHERE email='${normalized}';` +
    `DELETE FROM local_sessions WHERE user_id IN (SELECT user_id FROM local_accounts WHERE email='${normalized}');` +
    `SELECT COUNT(*) AS n FROM local_accounts WHERE email='${normalized}';`;
  const result = spawnSync(
    process.execPath,
    [
      ...wrangler,
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      config,
      "--persist-to",
      stateDir,
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
  const rows = JSON.parse(
    result.stdout.slice(result.stdout.indexOf("[")),
  ).flatMap((batch) => batch.results ?? []);
  if (!rows.some((row) => row.n === 1)) {
    console.error(`No account has the email ${normalized}.`);
    process.exit(1);
  }
  console.log(`Temporary password for ${normalized}: ${password}`);
  console.log(
    "Sign in with it, then change it from the account menu (Change password).",
  );
}

const [command, ...rest] = process.argv
  .slice(2)
  .filter((a) => a !== "--rebuild");
if (command === "reset-password") {
  ensureSecrets();
  resetPassword(rest[0]);
  process.exit(0);
}
if (command) {
  console.error(
    `Unknown command ${command}. Use no command, or reset-password <email>.`,
  );
  process.exit(1);
}

const port = process.env.PORT || "8787";
const host = process.env.HOST || "127.0.0.1";
ensureSecrets();
ensureBuild();
migrate();
console.log(
  `\nAI Assurance is starting on http://${host === "0.0.0.0" ? "localhost" : host}:${port}` +
    `\nData: ${dataDir}\nThe first visit asks you to create the owner account.\n`,
);
run([
  ...wrangler,
  "dev",
  "--config",
  config,
  "--local",
  "--persist-to",
  stateDir,
  "--ip",
  host,
  "--port",
  port,
  "--env-file",
  secretsFile,
  "--inspector-port",
  "0",
  "--show-interactive-dev-session=false",
]);
