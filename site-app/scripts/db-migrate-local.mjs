// Applies the pending drizzle/*.sql migrations to a local D1 database, in
// order, and records each one so that running it again changes nothing (F-15).
//
//   npm run build                       (once: writes dist/server/wrangler.json)
//   npm run db:migrate:local            (.wrangler/state, shared with npm run dev/start)
//   npm run db:migrate:local -- --persist-to .wrangler/e2e-state
//
// Applied migrations are recorded in the table `local_migrations` of the local
// database, each with the SHA-256 of the file's content, and a migration is
// identified by that content hash (#96):
//
// - a file whose name and content are recorded is applied;
// - a file renamed after it was applied (same content, its old name gone from
//   drizzle/) is applied, and its record takes the new name;
// - a file whose name is recorded with other content was edited after it was
//   applied. Nothing is applied then: an applied migration is never edited, so
//   add a new migration, or delete the local database and migrate again.
//
// A table recorded before content hashes (names only) gets them once, from
// the files as they are at that run: an edit made before that run cannot be
// detected, and a record whose file was renamed before that run gets no hash,
// so the renamed file matches no record and is applied again (which usually
// fails on an object that already exists). That run names such records; give
// the file its old name back for that run, or delete the local database and
// migrate again. A database that predates this script (migrations applied by hand
// with `wrangler d1 execute`) is adopted once: a migration counts as applied
// when every table, index, trigger and added column it creates already exists,
// and a migration that only changes data counts as applied when a later one
// does. Only the local preview database is touched; deployments apply their
// migrations separately.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
      "./scripts/wrangler-env.mjs",
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
// Names and hashes are written into SQL text below, so only plain file names
// are accepted.
const unsafe = migrations.find((name) => !/^[\w.-]+$/.test(name));
if (unsafe) {
  console.error(`drizzle/${unsafe}: use letters, digits, _, . and - only.`);
  process.exit(1);
}
const sql = new Map(
  migrations.map((name) => [
    name,
    readFileSync(path.join(projectRoot, "drizzle", name), "utf8"),
  ]),
);
/**
 * The SHA-256 of a migration file's content, which identifies it. Line
 * endings are normalised first, so a checkout with CRLF line endings
 * (core.autocrlf on Windows) names the same migration as one with LF.
 */
const hashes = new Map(
  migrations.map((name) => [
    name,
    createHash("sha256")
      .update(sql.get(name).replace(/\r\n/g, "\n"))
      .digest("hex"),
  ]),
);

/**
 * Matches the recorded migrations to the files by content hash: which files
 * are applied, which were renamed since, and which were edited since.
 */
function reconcile(records) {
  const applied = new Set(),
    renamed = [],
    edited = [];
  for (const name of migrations) {
    const hash = hashes.get(name);
    const own = records.find((r) => r.name === name);
    if (own?.sha256 === hash) applied.add(name);
    else if (own) edited.push({ name, recorded: own.sha256, hash });
    else {
      // The same content recorded under a name no file has any more.
      const old = records.find((r) => r.sha256 === hash && !hashes.has(r.name));
      if (old) {
        applied.add(name);
        renamed.push({ from: old.name, to: name });
      }
    }
  }
  return { applied, renamed, edited };
}

try {
  const schema = query(
    "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  );
  const exists = (type, name) =>
    schema.some((row) => row.type === type && row.name === name);
  let applied = new Set();
  if (exists("table", TABLE)) {
    // A table recorded before content hashes gets the column, and its records
    // the hashes of the files as they are now.
    if (
      !query(`SELECT name FROM pragma_table_info('${TABLE}')`).some(
        (r) => r.name === "sha256",
      )
    ) {
      const names = query(`SELECT name FROM ${TABLE}`).map((r) => r.name);
      const known = names.filter((name) => hashes.has(name));
      const orphaned = names.filter((name) => !hashes.has(name));
      query(
        `ALTER TABLE ${TABLE} ADD COLUMN sha256 TEXT;` +
          known
            .map(
              (name) =>
                ` UPDATE ${TABLE} SET sha256 = '${hashes.get(name)}' WHERE name = '${name}';`,
            )
            .join(""),
      );
      console.log(
        `Recorded the content hashes of ${known.length} applied migration(s); an edit made before this run cannot be detected.`,
      );
      if (orphaned.length)
        console.warn(
          `No file in drizzle/ has the recorded name of ${orphaned.join(", ")}, so it gets no hash. If it was renamed, the renamed file counts as pending and is applied again: give it its old name back for this run, or delete ${persistTo} and migrate again.`,
        );
    }
    const records = query(`SELECT name, sha256 FROM ${TABLE}`);
    const found = reconcile(records);
    if (found.edited.length) {
      for (const { name, recorded, hash } of found.edited)
        console.error(
          `drizzle/${name} changed after it was applied to this database (applied ${String(recorded).slice(0, 12)}, now ${hash.slice(0, 12)}).`,
        );
      console.error(
        `Nothing was applied. An applied migration is never edited: restore it and add a new migration, or delete ${persistTo} and migrate again.`,
      );
      process.exit(1);
    }
    if (found.renamed.length) {
      query(
        found.renamed
          .map(
            ({ from, to }) =>
              `UPDATE ${TABLE} SET name = '${to}' WHERE name = '${from}';`,
          )
          .join(" "),
      );
      for (const { from, to } of found.renamed)
        console.log(`Renamed ${from} to ${to}: same content, already applied.`);
    }
    applied = found.applied;
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
        const objects = createdObjects(sql.get(name));
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
    const values = adopted
      .map((name) => `('${name}', 'adopted', '${hashes.get(name)}')`)
      .join(", ");
    query(
      `CREATE TABLE ${TABLE} (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL, sha256 TEXT);` +
        (values
          ? ` INSERT INTO ${TABLE} (name, applied_at, sha256) VALUES ${values};`
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
        sql.get(name) +
          `\n--> statement-breakpoint\nINSERT INTO ${TABLE} (name, applied_at, sha256) VALUES ('${name}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), '${hashes.get(name)}');\n`,
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
