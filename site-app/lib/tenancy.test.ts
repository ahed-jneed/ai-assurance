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
    list: (sql: string, args: unknown[]): Record<string, unknown>[] => {
      void sql;
      void args;
      return [];
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
        return { results: state.list(sql, args) };
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
  d1.state.list = () => [];
  rows([]);
});
afterEach(() => {
  delete env.DB;
  delete env.SELF_SIGNUP;
  delete env.IDENTITY_MODE;
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
        /SELECT role,client_id,access_since FROM memberships/,
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
    env.SELF_SIGNUP = "open";
    let provisioned = false;
    d1.state.lookup = (sql) => {
      if (/SELECT tenant_id FROM memberships/.test(sql)) return null;
      if (/SELECT role,client_id,access_since FROM memberships/.test(sql))
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
      // Named after its founder, so practices are told apart (#55).
      expect(d1.state.writes[0].args[1]).toBe("Lea Lead practice");
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

  // F-44 / F-09: outside the development server nobody provisions a practice
  // without an invitation unless SELF_SIGNUP allows it.
  it.each([
    ["unset outside dev", {}],
    ["unset in trusted-headers mode", { IDENTITY_MODE: "trusted-headers" }],
    ["off, even in dev", { IDENTITY_MODE: "dev", SELF_SIGNUP: "off" }],
    ["an allowlist without the user", { SELF_SIGNUP: "boss@practice.example" }],
  ])("refuses self-signup when SELF_SIGNUP is %s", async (_label, vars) => {
    Object.assign(env, vars);
    const error = await as(lea, () => context()).catch((e: unknown) => e);
    expect(error).toEqual(
      new ApiError(
        403,
        "You have no practice membership or pending invitation. Ask a practice administrator to invite lea@practice.example.",
      ),
    );
    expect(d1.state.writes).toEqual([]);
  });

  it.each([
    ["unset on the development server", { IDENTITY_MODE: "dev" }],
    ["open", { SELF_SIGNUP: "open" }],
    [
      "an allowlist naming the user",
      { SELF_SIGNUP: "x@y.test, LEA@practice.example" },
    ],
    ["an allowlist naming the domain", { SELF_SIGNUP: "@practice.example" }],
  ])("allows self-signup when SELF_SIGNUP is %s", async (_label, vars) => {
    Object.assign(env, vars);
    await as(lea, () => context()).catch(() => undefined);
    expect(d1.state.writes[0].sql).toMatch(/INSERT OR IGNORE INTO tenants/);
  });

  it("joins the inviting practice at first sign-in instead of provisioning one", async () => {
    let joined = false;
    d1.state.list = (sql, args) =>
      /FROM invitations WHERE email=\?/.test(sql)
        ? (expect(args[0]).toBe("lea@practice.example"),
          [
            {
              tenant_id: "tenant-firm",
              id: "INV-1",
              display_name: "Lea",
              role: "Auditor",
              client_id: null,
              engagement_ids: '["ENG-1"]',
              invited_by: "user-admin",
            },
          ])
        : [];
    d1.state.lookup = (sql) => {
      if (
        /SELECT tenant_id FROM memberships WHERE user_id=\? AND status/.test(
          sql,
        )
      )
        return joined ? { tenant_id: "tenant-firm" } : null;
      if (/SELECT role,client_id,access_since FROM memberships/.test(sql))
        return joined
          ? { role: "Auditor", client_id: null, access_since: "2026-11-06" }
          : null;
      return null;
    };
    const batch = d1.db.batch;
    d1.db.batch = async (statements) => {
      joined = true;
      return batch(statements);
    };
    try {
      const ctx = await as(lea, () => context());
      expect(ctx).toMatchObject({
        tenantId: "tenant-firm",
        role: "Auditor",
        practiceAdmin: false,
        accessSince: "2026-11-06",
      });
      const writes = d1.state.writes.map(
        ({ sql }) => /^(?:UPDATE|INSERT INTO) (\w+)/.exec(sql)?.[1],
      );
      expect(writes).toEqual([
        "invitations",
        "memberships",
        "engagement_access",
        "tenants",
        "management_events",
      ]);
      // A revoked membership comes back with the invited role only.
      expect(d1.state.writes[1].sql).toContain(
        "WHERE memberships.status<>'active'",
      );
      expect(d1.state.writes[4].args[3]).toBe("acceptInvitation");
    } finally {
      d1.db.batch = batch;
    }
  });
});
