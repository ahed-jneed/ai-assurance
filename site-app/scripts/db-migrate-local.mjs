// Applies the pending drizzle/*.sql migrations to a local D1 database, in
// order, and records each one so that running it again changes nothing (F-15).
//
//   npm run build                       (once: writes dist/server/wrangler.json)
//   npm run db:migrate:local            (.wrangler/state, shared with npm run dev/start)
//   npm run db:migrate:local -- --persist-to .wrangler/e2e-state
//
// Applied migrations are recorded in the table `local_migrations` of the local
// database. A database that predates this script (migrations applied by hand
// with `wrangler d1 execute`) is adopted once: a migration counts as applied
// when every table, index, trigger and added column it creates already exists,
// and a migration that only changes data counts as applied when a later one
// does. Only the local preview database is touched; deployments apply their
// migrations separately.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const persistTo = option("--persist-to", ".wrangler/state");
const binding = option("--binding", "DB");
const config = "dist/server/wrangler.json";
const TABLE = "local_migrations";

if (!existsSync(path.join(projectRoot, config))) {
  console.error(`${config} is missing; run \`npm run build\` first.`);
  process.exit(1);
}

/** Runs `wrangler d1 execute` against the local database and returns its rows. */
function execute(target) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/sites-env.mjs",
      "./node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      binding,
      "--local",
      "--config",
      config,
      "--persist-to",
      persistTo,
      "--json",
      ...target,
    ],
    { cwd: projectRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(output || `wrangler exited with ${result.status}`);
  }
  const start = result.stdout.indexOf("[");
  const parsed = JSON.parse(result.stdout.slice(start));
  return parsed.flatMap((batch) => batch.results ?? []);
}
const query = (sql) => execute(["--command", sql]);

/** The schema objects a migration creates, to recognise it in an old database. */
function createdObjects(sql) {
  const objects = [];
  for (const match of sql.matchAll(
    /CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi,
  ))
    objects.push({ type: match[1].toLowerCase(), name: match[2] });
  for (const match of sql.matchAll(
    /ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?/gi,
  ))
    objects.push({ type: "column", table: match[1], name: match[2] });
  return objects;
}

const migrations = readdirSync(path.join(projectRoot, "drizzle"))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

try {
  const schema = query(
    "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  );
  const exists = (type, name) =>
    schema.some((row) => row.type === type && row.name === name);
  let applied = new Set();
  if (exists("table", TABLE)) {
    applied = new Set(query(`SELECT name FROM ${TABLE}`).map((r) => r.name));
  } else {
    const adopted = [];
    if (schema.some((row) => row.type === "table")) {
      // Hand-applied migrations: recognise them by the objects they create.
      const columns = new Map();
      const hasColumn = (table, name) => {
        if (!columns.has(table))
          columns.set(
            table,
            exists("table", table)
              ? query(`SELECT name FROM pragma_table_info('${table}')`).map(
                  (r) => r.name,
                )
              : [],
          );
        return columns.get(table).includes(name);
      };
      const present = migrations.map((name) => {
        const objects = createdObjects(
          readFileSync(path.join(projectRoot, "drizzle", name), "utf8"),
        );
        if (!objects.length) return undefined;
        return objects.every((o) =>
          o.type === "column"
            ? hasColumn(o.table, o.name)
            : exists(o.type, o.name),
        );
      });
      migrations.forEach((name, i) => {
        const later = present.slice(i + 1).some((p) => p === true);
        if (present[i] === true || (present[i] === undefined && later))
          adopted.push(name);
      });
    }
    const values = adopted.map((name) => `('${name}', 'adopted')`).join(", ");
    query(
      `CREATE TABLE ${TABLE} (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);` +
        (values
          ? ` INSERT INTO ${TABLE} (name, applied_at) VALUES ${values};`
          : ""),
    );
    applied = new Set(adopted);
    if (adopted.length)
      console.log(
        `Adopted ${adopted.length} migration(s) applied before tracking: ${adopted.join(", ")}.`,
      );
  }

  const pending = migrations.filter((name) => !applied.has(name));
  if (!pending.length) {
    console.log(
      `Local D1 (${persistTo}) is up to date: ${migrations.length} migrations applied.`,
    );
    process.exit(0);
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), "d1-migrate-"));
  try {
    for (const name of pending) {
      // The record is the file's last statement, so it is written only after
      // every statement of the migration succeeded.
      const file = path.join(scratch, name);
      writeFileSync(
        file,
        readFileSync(path.join(projectRoot, "drizzle", name), "utf8") +
          `\n--> statement-breakpoint\nINSERT INTO ${TABLE} (name, applied_at) VALUES ('${name}', strftime('%Y-%m-%dT%H:%M:%fZ','now'));\n`,
      );
      execute(["--file", file]);
      console.log(`Applied ${name}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(
    `Local D1 (${persistTo}): applied ${pending.length} pending migration(s).`,
  );
} catch (error) {
  console.error(
    "db:migrate:local failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
