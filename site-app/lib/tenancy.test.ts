import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/http";
import { runWithIdentity, type Identity } from "@/lib/identity";
import { context } from "@/lib/tenancy";

// A D1 stand-in that answers context()'s lookups from `rows` and records every
// statement that would write. Each test installs it as the DB binding.
type Row = Record<string, unknown> | null;
function fakeD1() {
  const state = {
    writes: [] as { sql: string; args: unknown[] }[],
    lookup: (sql: string, args: unknown[]): Record<string, unknown> | null => {
      void sql;
      void args;
      return null;
    },
  };
  const write = (sql: string) =>
    /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
  function statement(sql: string, args: unknown[] = []) {
    return {
      sql,
      args,
      bind: (...next: unknown[]) => statement(sql, next),
      async first() {
        if (write(sql)) state.writes.push({ sql, args });
        return state.lookup(sql, args);
      },
      async all() {
        return { results: [] };
      },
      async run() {
        if (write(sql)) state.writes.push({ sql, args });
        return { meta: {} };
      },
    };
  }
  const db = {
    prepare: (sql: string) => statement(sql),
    async batch(statements: { sql: string; args: unknown[] }[]) {
      for (const s of statements)
        if (write(s.sql)) state.writes.push({ sql: s.sql, args: s.args });
      return [];
    },
  };
  return { state, db };
}
const d1 = fakeD1();

const lea: Identity = {
  userId: "user-lea",
  email: "lea@practice.example",
  displayName: "Lea Lead",
  fullName: "Lea Lead",
};
function as<T>(identity: Identity | null, run: () => Promise<T>) {
  return runWithIdentity(identity, run);
}
function rows(answers: [RegExp, Row][]) {
  d1.state.lookup = (sql) =>
    answers.find(([pattern]) => pattern.test(sql))?.[1] ?? null;
}

beforeEach(() => {
  env.DB = d1.db as unknown as D1Database;
  d1.state.writes = [];
  rows([]);
});
afterEach(() => {
  delete env.DB;
});

describe("context", () => {
  it("answers 401 without a signed-in user", async () => {
    const error = await as(null, () => context()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(d1.state.writes).toEqual([]);
  });

  it("only reads when it resolves an existing member (F-53)", async () => {
    rows([
      [/status='active' ORDER BY tenant_id/, { tenant_id: "tenant-1" }],
      [
        /SELECT role,client_id FROM memberships/,
        { role: "Auditor", client_id: null },
      ],
      [/FROM practice_admins/, null],
    ]);
    await expect(as(lea, () => context())).resolves.toEqual({
      user: lea,
      tenantId: "tenant-1",
      role: "Auditor",
      clientId: null,
      practiceAdmin: false,
    });
    await expect(as(lea, () => context("tenant-1"))).resolves.toMatchObject({
      tenantId: "tenant-1",
    });
    expect(d1.state.writes).toEqual([]);
  });

  it("provisions a first practice the user administers and may open", async () => {
    let provisioned = false;
    d1.state.lookup = (sql) => {
      if (/SELECT tenant_id FROM memberships/.test(sql)) return null;
      if (/SELECT role,client_id FROM memberships/.test(sql))
        return provisioned ? { role: "Lead Auditor", client_id: null } : null;
      if (/FROM practice_admins/.test(sql))
        return provisioned ? { 1: 1 } : null;
      return null;
    };
    const batch = d1.db.batch;
    d1.db.batch = async (statements) => {
      provisioned = true;
      return batch(statements);
    };
    try {
      const ctx = await as(lea, () => context());
      expect(ctx).toMatchObject({ role: "Lead Auditor", practiceAdmin: true });
      const tables = d1.state.writes.map(
        ({ sql }) => /INSERT OR IGNORE INTO (\w+)/.exec(sql)?.[1],
      );
      expect(tables).toEqual([
        "tenants",
        "memberships",
        "practice_admins",
        "clients",
        "engagements",
        "engagement_snapshots",
        "engagement_access_policies",
        "engagement_access",
      ]);
      const grant = d1.state.writes.at(-1)!.args;
      expect(grant.slice(0, 4)).toEqual([
        ctx.tenantId,
        "ENG-default",
        "user-lea",
        "user-lea",
      ]);
      expect(d1.state.writes[2].args).toEqual([ctx.tenantId, "user-lea"]);
    } finally {
      d1.db.batch = batch;
    }
  });

  it("refuses a user whose access was revoked without provisioning again", async () => {
    rows([
      [/status='active' ORDER BY tenant_id/, null],
      [
        /SELECT tenant_id FROM memberships WHERE user_id=\? LIMIT 1/,
        { tenant_id: "tenant-1" },
      ],
    ]);
    const error = await as(lea, () => context()).catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(403);
    expect(d1.state.writes).toEqual([]);
  });
});
