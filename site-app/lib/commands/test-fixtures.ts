// Builders shared by the command bus tests; the app never imports this module.
import type { Engagement, Role } from "../domain";
import { freshEngagement } from "../factories";
import type { Context } from "../tenancy";
import { resolveNew } from "../criteria/pin";

/** A signed-in caller of the fixture practice, acting in `role`. */
export function caller(
  role: Role = "Lead Auditor",
  practiceAdmin = true,
): Context {
  return {
    user: {
      userId: "user-lead",
      displayName: "Lead",
      email: "lead@fixture.invalid",
    },
    tenantId: "tenant-1",
    role,
    clientId: null,
    practiceAdmin,
  };
}

/** An engagement without the structured workflow, as getEngagement loads it. */
export function stored(version = 3): Engagement {
  const e = freshEngagement(
    resolveNew(),
    "CL-1",
    "Model risk audit",
    "user-lead",
  );
  e.version = version;
  return e;
}

/** A same-origin JSON POST to an API route. */
export function postRequest(path: string, body: unknown) {
  return new Request("https://workspace.test" + path, {
    method: "POST",
    headers: {
      origin: "https://workspace.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** A prepared statement as the fake D1 records it. */
export type FakeStatement = { sql: string; args: unknown[] };

/**
 * A D1 stand-in: `answer` returns the row (for `first`) or rows (for `all`)
 * of a query, and every `batch` is recorded with its bound arguments. Each
 * batched statement reports `changes` changed rows.
 */
export function fakeD1(
  answer: (sql: string, args: unknown[]) => unknown = () => null,
  changes = 1,
) {
  const batches: FakeStatement[][] = [];
  const statement = (sql: string, args: unknown[]) => ({
    sql,
    args,
    bind: (...bound: unknown[]) => statement(sql, bound),
    first: async () => answer(sql, args) ?? null,
    all: async () => ({ results: answer(sql, args) ?? [] }),
  });
  const db = {
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: FakeStatement[]) => {
      batches.push(statements.map(({ sql, args }) => ({ sql, args })));
      return statements.map(() => ({ meta: { changes } }));
    },
  };
  return { db: db as unknown as D1Database, batches };
}
