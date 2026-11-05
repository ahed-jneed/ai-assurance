// An in-memory D1 database for unit tests: SQLite (node:sqlite) with the app's
// migrations in drizzle/ applied, behind the D1 calls the app makes (prepare,
// bind, all, first, run and batch). Queries run as they would on D1, so tests
// can check SQL rather than a fake's answers. The app never imports this module.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type Statement = { sql: string; values: SQLInputValue[] };

export function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:"),
    migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(new URL(file, migrations), "utf8").split(
      "--> statement-breakpoint",
    ))
      if (sql.trim()) sqlite.exec(sql);
  const run = ({ sql, values }: Statement) => ({
    meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
  });
  const prepared = (sql: string, values: SQLInputValue[] = []) => ({
    sql,
    values,
    bind: (...bound: SQLInputValue[]) => prepared(sql, bound),
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    run: async () => run({ sql, values }),
  });
  const db = {
    prepare: (sql: string) => prepared(sql),
    // A batch is one transaction, as on D1.
    batch: async (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(run);
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}
