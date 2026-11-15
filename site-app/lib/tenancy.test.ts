import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";
import { runWithIdentity, type Identity } from "@/lib/identity";
import { signInGapHours, signInRetentionDays } from "@/lib/access-events";
import {
  archivedMessage,
  context,
  pruneSignIns,
  signInPruneBatch,
} from "@/lib/tenancy";
import { sqliteD1 } from "@/lib/test-d1";

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
    /** Whether running the statement fails. */
    failRun: (sql: string): boolean => {
      void sql;
      return false;
    },
    /** The rows a write changed: none unless a test says otherwise. */
    changes: (sql: string): number => {
      void sql;
      return 0;
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
        if (state.failRun(sql)) throw new Error("D1 busy");
        return { meta: { changes: state.changes(sql) } };
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
/**
 * Answers lookups from `answers`; unless they say otherwise, the member
 * signed in recently, so context() records no sign-in (#181).
 */
function rows(answers: [RegExp, Row][]) {
  const all: [RegExp, Row][] = [...answers, [/FROM sign_in_events/, { 1: 1 }]];
  d1.state.lookup = (sql) =>
    all.find(([pattern]) => pattern.test(sql))?.[1] ?? null;
}

beforeEach(() => {
  env.DB = d1.db as unknown as D1Database;
  d1.state.writes = [];
  d1.state.list = () => [];
  d1.state.changes = () => 0;
  d1.state.failRun = () => false;
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
        /SELECT role,client_id,access_since,email,display_name FROM memberships/,
        { role: "Auditor", client_id: null, email: "lea@practice.example" },
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

  it("records a sign-in for the Access log only after a gap without one (#181)", async () => {
    const member: [RegExp, Row][] = [
      [
        /SELECT role,client_id,access_since,email,display_name FROM memberships/,
        { role: "Reviewer", client_id: null, email: "lea@practice.example" },
      ],
    ];
    rows([[/FROM sign_in_events/, null], ...member]);
    const before = Date.now();
    await as(lea, () => context("tenant-1"));
    expect(d1.state.writes).toHaveLength(1);
    const { sql, args } = d1.state.writes[0];
    expect(sql).toMatch(
      /^INSERT INTO sign_in_events\(tenant_id,id,user_id,role,created_at\) SELECT \?,\?,\?,\?,\? WHERE NOT EXISTS\(SELECT 1 FROM sign_in_events WHERE tenant_id=\? AND user_id=\? AND created_at>\?\)$/,
    );
    expect(args[0]).toBe("tenant-1");
    expect(args[1]).toMatch(/^SI-/);
    expect(args.slice(2, 4)).toEqual(["user-lea", "Reviewer"]);
    expect(args.slice(5, 7)).toEqual(["tenant-1", "user-lea"]);
    // The guard looks back signInGapHours from the sign-in's own time.
    expect(Date.parse(args[4] as string) - Date.parse(args[7] as string)).toBe(
      signInGapHours * 3600000,
    );
    expect(Date.parse(args[4] as string)).toBeGreaterThanOrEqual(before);

    // Within the gap nothing is written.
    d1.state.writes = [];
    rows(member);
    await as(lea, () => context("tenant-1"));
    expect(d1.state.writes).toEqual([]);
  });

  it("prunes the practice's expired sign-ins when it records one (#185)", async () => {
    rows([
      [/FROM sign_in_events/, null],
      [
        /SELECT role,client_id,access_since,email,display_name FROM memberships/,
        { role: "Auditor", client_id: null, email: "lea@practice.example" },
      ],
    ]);
    // The guarded insert wrote the sign-in.
    d1.state.changes = (sql) =>
      /^INSERT INTO sign_in_events/.test(sql) ? 1 : 0;
    await as(lea, () => context("tenant-1"));
    expect(d1.state.writes.map((w) => w.sql.split(" ")[0])).toEqual([
      "INSERT",
      "DELETE",
    ]);
    const [insert, prune] = d1.state.writes;
    expect(prune.sql).toMatch(/^DELETE FROM sign_in_events WHERE tenant_id=\?/);
    expect(prune.args.slice(0, 2)).toEqual(["tenant-1", "tenant-1"]);
    expect(
      Date.parse(insert.args[4] as string) -
        Date.parse(prune.args[2] as string),
    ).toBe(signInRetentionDays * 86400000);
    expect(prune.args[3]).toBe(signInPruneBatch);

    // A prune that fails still lets the request through.
    d1.state.writes = [];
    d1.state.failRun = (sql) => /^DELETE FROM sign_in_events/.test(sql);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(as(lea, () => context("tenant-1"))).resolves.toMatchObject({
        role: "Auditor",
      });
      expect(warn).toHaveBeenCalledWith(
        "Access log: expired sign-ins could not be pruned: D1 busy",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("records no prune when the guarded insert wrote nothing", async () => {
    rows([
      [/FROM sign_in_events/, null],
      [
        /SELECT role,client_id,access_since,email,display_name FROM memberships/,
        { role: "Auditor", client_id: null, email: "lea@practice.example" },
      ],
    ]);
    // A concurrent request recorded the sign-in first.
    await as(lea, () => context("tenant-1"));
    expect(d1.state.writes.map((w) => w.sql.split(" ")[0])).toEqual(["INSERT"]);
  });

  it("never refuses a request when the sign-in cannot be recorded", async () => {
    rows([
      [
        /SELECT role,client_id,access_since,email,display_name FROM memberships/,
        { role: "Auditor", client_id: null, email: "lea@practice.example" },
      ],
    ]);
    const lookup = d1.state.lookup;
    d1.state.lookup = (sql, args) => {
      if (/sign_in_events/.test(sql)) throw new Error("D1 unavailable");
      return lookup(sql, args);
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(as(lea, () => context("tenant-1"))).resolves.toMatchObject({
        role: "Auditor",
      });
      expect(warn).toHaveBeenCalledWith(
        "Access log: the sign-in could not be recorded: D1 unavailable",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("records a member's identity email once when it is missing or changed (#95)", async () => {
    for (const stored of [null, "old@practice.example"]) {
      d1.state.writes = [];
      rows([
        [
          /SELECT role,client_id,access_since,email,display_name FROM memberships/,
          { role: "Auditor", client_id: null, email: stored },
        ],
      ]);
      await as({ ...lea, email: " Lea@Practice.example " }, () =>
        context("tenant-1"),
      );
      expect(d1.state.writes).toEqual([
        {
          sql: "UPDATE memberships SET email=? WHERE tenant_id=? AND user_id=? AND email IS NOT ?",
          args: [
            "lea@practice.example",
            "tenant-1",
            "user-lea",
            "lea@practice.example",
          ],
        },
      ]);
    }
  });

  it("records the member's name when the membership names them only by email (#241)", async () => {
    const member = (display_name: string | null) =>
      rows([
        [
          /SELECT role,client_id,access_since,email,display_name FROM memberships/,
          {
            role: "Auditor",
            client_id: null,
            email: lea.email,
            display_name,
          },
        ],
      ]);
    for (const stored of ["LEA@practice.example", "", null]) {
      d1.state.writes = [];
      member(stored);
      await as(lea, () => context("tenant-1"));
      expect(d1.state.writes).toEqual([
        {
          sql: "UPDATE memberships SET display_name=? WHERE tenant_id=? AND user_id=? AND display_name IS ?",
          args: ["Lea Lead", "tenant-1", "user-lea", stored],
        },
      ]);
    }
    // A name an administrator gave stays; without a full name nothing is known.
    for (const [identity, stored] of [
      [lea, "Lea L. (Risk)"],
      [{ ...lea, fullName: null, displayName: lea.email }, lea.email],
    ] as const) {
      d1.state.writes = [];
      member(stored);
      await as(identity, () => context("tenant-1"));
      expect(d1.state.writes).toEqual([]);
    }
  });

  it("provisions a first practice the user administers and may open", async () => {
    env.SELF_SIGNUP = "open";
    let provisioned = false;
    d1.state.lookup = (sql) => {
      if (/SELECT tenant_id FROM memberships/.test(sql)) return null;
      if (
        /SELECT role,client_id,access_since,email,display_name FROM memberships/.test(
          sql,
        )
      )
        return provisioned
          ? { role: "Lead Auditor", client_id: null, email: lea.email }
          : null;
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
      // The founder's first sign-in is recorded for the Access log (#181).
      expect(d1.state.writes.pop()!.sql).toMatch(/^INSERT INTO sign_in_events/);
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
      // The founder's identity email is recorded on the membership (#95).
      expect(d1.state.writes[1].args.at(-1)).toBe("lea@practice.example");
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

  it("tells a member of an archived practice why they lost access (#151)", async () => {
    Object.assign(env, { SELF_SIGNUP: "open" });
    rows([
      [/status='active' ORDER BY tenant_id/, null],
      [/m\.status='archived' AND t\.archived_at IS NOT NULL/, { 1: 1 }],
    ]);
    for (const tenantId of [undefined, "tenant-1"]) {
      const error = await as(lea, () => context(tenantId)).catch(
        (e: unknown) => e,
      );
      expect(error).toEqual(new ApiError(403, archivedMessage));
    }
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
              created_at: "2026-11-01T00:00:00.000Z",
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
      if (
        /SELECT role,client_id,access_since,email,display_name FROM memberships/.test(
          sql,
        )
      )
        return joined
          ? {
              role: "Auditor",
              client_id: null,
              access_since: "2026-11-06",
              email: lea.email,
            }
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
        "sign_in_events",
      ]);
      // A revoked membership comes back with the invited role only.
      expect(d1.state.writes[1].sql).toContain(
        "WHERE memberships.status<>'active' AND (memberships.access_since IS NULL OR memberships.access_since<?)",
      );
      // Acceptance itself refuses an invitation the current grant overtook.
      expect(d1.state.writes[0].sql).toContain(
        "AND NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=? AND access_since IS NOT NULL AND access_since>=?)",
      );
      expect(d1.state.writes[0].args.slice(-3)).toEqual([
        "tenant-firm",
        "user-lea",
        "2026-11-01T00:00:00.000Z",
      ]);
      expect(d1.state.writes[4].args[3]).toBe("acceptInvitation");
    } finally {
      d1.db.batch = batch;
    }
  });

  it("withholds an invited engagement where the invitee declared a conflict (#112)", async () => {
    let joined = false;
    d1.state.list = (sql) =>
      /FROM invitations WHERE email=\?/.test(sql)
        ? [
            {
              tenant_id: "tenant-firm",
              id: "INV-1",
              display_name: "Lea",
              role: "Auditor",
              client_id: null,
              engagement_ids: '["ENG-1","ENG-2"]',
              invited_by: "user-admin",
              created_at: "2026-11-01T00:00:00.000Z",
            },
          ]
        : [];
    const conflicted = {
      workflow: {
        declarations: [
          { userId: "user-lea", exclusions: ["financial_interest"] },
        ],
      },
    };
    d1.state.lookup = (sql, args) => {
      if (/SELECT body FROM engagements/.test(sql))
        return args[1] === "ENG-1"
          ? { body: JSON.stringify(conflicted) }
          : { body: JSON.stringify({ workflow: { declarations: [] } }) };
      if (
        /SELECT tenant_id FROM memberships WHERE user_id=\? AND status/.test(
          sql,
        )
      )
        return joined ? { tenant_id: "tenant-firm" } : null;
      if (
        /SELECT role,client_id,access_since,email,display_name FROM memberships/.test(
          sql,
        )
      )
        return joined
          ? {
              role: "Auditor",
              client_id: null,
              access_since: "2026-11-06",
              email: lea.email,
            }
          : null;
      return null;
    };
    const batch = d1.db.batch;
    d1.db.batch = async (statements) => {
      joined = true;
      return batch(statements);
    };
    try {
      await as(lea, () => context());
      const grants = d1.state.writes.filter((w) =>
        w.sql.startsWith("INSERT INTO engagement_access"),
      );
      expect(grants.map((g) => g.args[1])).toEqual(["ENG-2"]);
      const event = d1.state.writes.find((w) =>
        w.sql.startsWith("INSERT INTO management_events"),
      )!;
      expect(JSON.parse(String(event.args[4]))).toMatchObject({
        engagementIds: ["ENG-2"],
        withheld: [
          {
            engagementId: "ENG-1",
            reason:
              "This person declared a disqualifying relationship with the engagement and cannot be assigned",
          },
        ],
      });
    } finally {
      d1.db.batch = batch;
    }
  });

  it("closes an invitation issued before a revocation as superseded and never restores the membership", async () => {
    d1.state.list = (sql) =>
      /FROM invitations WHERE email=\?/.test(sql)
        ? [
            {
              tenant_id: "tenant-firm",
              id: "INV-1",
              display_name: null,
              role: "Lead Auditor",
              client_id: null,
              engagement_ids: '["ENG-1"]',
              invited_by: "user-admin",
              created_at: "2026-11-01T00:00:00.000Z",
            },
          ]
        : [];
    rows([
      // memberships.access_since (the revocation) is after created_at.
      [
        /SELECT 1 AS superseded WHERE EXISTS\(SELECT 1 FROM memberships/,
        {
          superseded: 1,
        },
      ],
    ]);
    await expect(as(lea, () => context("tenant-firm"))).rejects.toBeInstanceOf(
      ApiError,
    );
    const writes = d1.state.writes.map(
      ({ sql }) => /^(?:UPDATE|INSERT INTO) (\w+)/.exec(sql)?.[1],
    );
    expect(writes).toEqual(["invitations", "tenants", "management_events"]);
    expect(d1.state.writes[0].sql).toMatch(
      /^UPDATE invitations SET status='superseded'/,
    );
    expect(d1.state.writes[2].args[3]).toBe("supersedeInvitation");
    expect(
      d1.state.writes.some(({ sql }) =>
        /memberships|engagement_access/.test(sql.split(" WHERE ")[0]),
      ),
    ).toBe(false);
  });
});

describe("pruneSignIns (#185)", () => {
  it("deletes one practice's sign-ins past the retention period, oldest first, in bounded batches", async () => {
    const { db, sqlite } = sqliteD1();
    env.DB = db as unknown as D1Database;
    for (const t of ["tenant-1", "tenant-2"])
      sqlite
        .prepare("INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)")
        .run(t, t, "2024-01-01T00:00:00.000Z");
    const at = "2026-11-05T12:00:00.000Z",
      cutoff = Date.parse(at) - signInRetentionDays * 86400000,
      iso = (ms: number) => new Date(ms).toISOString();
    const insert = sqlite.prepare(
      "INSERT INTO sign_in_events(tenant_id,id,user_id,role,created_at) VALUES(?,?,?,?,?)",
    );
    const expired = signInPruneBatch + 3;
    sqlite.exec("BEGIN");
    // More expired sign-ins than one batch.
    for (let i = 0; i < expired; i++)
      insert.run(
        "tenant-1",
        "OLD-" + String(i).padStart(4, "0"),
        "lea",
        "Auditor",
        iso(cutoff - 86400000 - (expired - i) * 1000),
      );
    insert.run("tenant-1", "EDGE", "lea", "Auditor", iso(cutoff));
    insert.run("tenant-1", "NEW", "lea", "Auditor", iso(cutoff + 1));
    insert.run("tenant-2", "OTHER", "lea", "Auditor", iso(cutoff - 86400000));
    sqlite.exec("COMMIT");
    sqlite
      .prepare(
        "INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) VALUES('tenant-1','M1','lea','grantMember','{}','h',?)",
      )
      .run(iso(cutoff - 86400000));
    const left = () =>
      (
        sqlite
          .prepare(
            "SELECT id FROM sign_in_events WHERE tenant_id='tenant-1' ORDER BY created_at,id",
          )
          .all() as { id: string }[]
      ).map((r) => r.id);
    try {
      expect(await pruneSignIns("tenant-1", at)).toBe(signInPruneBatch);
      // The oldest batch went; the newest expired ones wait for the next.
      expect(left()).toEqual([
        "OLD-0500",
        "OLD-0501",
        "OLD-0502",
        "EDGE",
        "NEW",
      ]);
      expect(await pruneSignIns("tenant-1", at)).toBe(3);
      // A sign-in exactly the retention period old is kept.
      expect(left()).toEqual(["EDGE", "NEW"]);
      expect(await pruneSignIns("tenant-1", at)).toBe(0);
      // Another practice's sign-ins and the management events stay.
      expect(
        sqlite
          .prepare("SELECT id FROM sign_in_events WHERE tenant_id='tenant-2'")
          .all(),
      ).toEqual([{ id: "OTHER" }]);
      expect(
        sqlite.prepare("SELECT COUNT(*) AS n FROM management_events").get(),
      ).toEqual({ n: 1 });
    } finally {
      sqlite.close();
    }
  });
});
