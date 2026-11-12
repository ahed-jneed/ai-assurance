import { env } from "cloudflare:workers";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordTitle } from "../app/assurance-register";
import type { AssuranceRecord } from "./assurance-core";
import {
  canonicalCaseForm,
  caseForms,
  reviewQueuePage,
  reviewQueueSummary,
  searchRecords,
  searchPageSize,
  type RecordSearch,
  type RecordSearchPage,
} from "./assurance-search";
import { caller } from "./commands/test-fixtures";
import type { Role } from "./domain";
import { ApiError } from "./http";
import { sha256 } from "./ids";
import { sqliteD1 } from "./test-d1";
import {
  selectWorkbenchRecords,
  workbenchReviewQueue,
  workbenchReviewState,
} from "./workbench-presentation";

let sqlite: DatabaseSync;
const at0 = "2026-01-01T00:00:00.000Z";
beforeEach(() => {
  const d1 = sqliteD1();
  env.DB = d1.db;
  sqlite = d1.sqlite;
  for (const tenant of ["tenant-1", "tenant-2"]) {
    sqlite
      .prepare("INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)")
      .run(tenant, "Practice", at0);
    sqlite
      .prepare(
        "INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES('CL-1',?,'Client','Finance',?)",
      )
      .run(tenant, at0);
  }
  for (const [tenant, engagement] of [
    ["tenant-1", "ENG-1"],
    ["tenant-1", "ENG-2"],
    ["tenant-2", "ENG-1"],
  ])
    sqlite
      .prepare(
        "INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES(?,?,'CL-1','Audit',1,'{}','init')",
      )
      .run(engagement, tenant);
  for (const [user, name] of people)
    sqlite
      .prepare(
        "INSERT INTO memberships(tenant_id,user_id,role,display_name) VALUES('tenant-1',?,'Auditor',?)",
      )
      .run(user, name);
});
afterEach(() => {
  delete env.DB;
});

const people = [
  ["user-lead", "Lena Lead"],
  ["user-auditor", "Arto Auditor"],
  ["user-reviewer", "Rhea Reviewer"],
  ["user-mueller", "Jörg Müller"],
] as const;
const person = (id: string) =>
  people.find(([user]) => user === id)?.[1] ?? "Practice member";

type Seed = {
  id: string;
  kind: string;
  body: Record<string, unknown>;
  at: string;
  actor?: string;
  engagement?: string;
  tenant?: string;
};
async function insert(seeds: Seed[]) {
  const statement = sqlite.prepare(
    "INSERT INTO assurance_records(tenant_id,engagement_id,id,kind,body,sha256,created_at,actor) VALUES(?,?,?,?,?,?,?,?)",
  );
  sqlite.exec("BEGIN");
  for (const s of seeds) {
    const text = JSON.stringify(s.body);
    statement.run(
      s.tenant ?? "tenant-1",
      s.engagement ?? "ENG-1",
      s.id,
      s.kind,
      text,
      await sha256(text),
      s.at,
      s.actor ?? "user-auditor",
    );
  }
  sqlite.exec("COMMIT");
}
function everyRecord(engagementId = "ENG-1"): AssuranceRecord[] {
  return sqlite
    .prepare(
      "SELECT id,kind,body,sha256,created_at,actor FROM assurance_records WHERE tenant_id='tenant-1' AND engagement_id=? ORDER BY created_at,id",
    )
    .all(engagementId)
    .map((r) => ({
      id: String(r.id),
      kind: String(r.kind),
      body: JSON.parse(String(r.body)),
      sha256: String(r.sha256),
      createdAt: String(r.created_at),
      actor: String(r.actor),
    }));
}
const at = (second: number) =>
  new Date(Date.UTC(2026, 10, 5, 9, 0, second)).toISOString();

function generator(seed: number) {
  let t = seed >>> 0;
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: <T>(values: readonly T[]) =>
      values[Math.floor(next() * values.length)],
  };
}
// Words the records carry and the searches look for. None is a kind name or
// part of a register's fallback title, so the in-memory search and the SQL
// search must agree on them. Some carry non-ASCII letters, whose case the
// search ignores too, and LIKE's and GLOB's wildcards.
const words = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "50%_off",
  "Überprüfung",
  "ærøskøbing",
  "Σχέδιο",
  "Σκοπός",
  "a*[b]?c",
];
/**
 * Random records of the kinds the registers show: assessments with one title
 * field, reviews of any target and decision, supersession, and sources with
 * searchable words in the fields a register shows.
 */
function randomRecords(seed: number, count: number): Seed[] {
  const g = generator(seed),
    seeds: Seed[] = [],
    assessments: Seed[] = [],
    successors = new Set<string>(),
    word = () => g.pick(words) + "-" + Math.floor(g.next() * 50),
    actor = () => g.pick(people)[0];
  for (let i = 0; i < count; i++) {
    const id = "AS-" + i.toString(36).padStart(4, "0") + g.pick([..."abcdef"]),
      when = at(Math.floor(g.next() * 12)),
      roll = g.next();
    if (roll < 0.4) {
      const kind = g.pick(["assertion", "impact", "obligation"] as const),
        body: Record<string, unknown> =
          kind === "assertion"
            ? { statement: word(), criterion: word() }
            : kind === "impact"
              ? { description: word() }
              : { code: word() };
      const previous = assessments.length && g.pick(assessments);
      if (previous && g.next() < 0.25 && !successors.has(kind + previous.id)) {
        successors.add(kind + previous.id);
        body.supersedesId = previous.id;
      }
      const record = { id, kind, body, at: when, actor: actor() };
      assessments.push(record);
      seeds.push(record);
    } else if (roll < 0.7) {
      const target = assessments.length ? g.pick(assessments) : undefined,
        family =
          g.next() < 0.85 && target
            ? target.kind
            : g.pick(["assertion", "impact", "obligation"]),
        field =
          g.next() < 0.8
            ? family + "Id"
            : g.pick(["assertionId", "impactId", "obligationId"]),
        body: Record<string, unknown> = {
          [field]: target && g.next() < 0.9 ? target.id : "AS-missing",
          decision: g.pick(["approve", "confirmed", "return", "returned"]),
        };
      if (g.next() < 0.1) body.assertionId = null;
      seeds.push({
        id,
        kind: family + "_review",
        body,
        at: when,
        actor: actor(),
      });
    } else if (roll < 0.9)
      seeds.push({
        id,
        kind: "location",
        body: { label: word(), locator: word(), artifactName: word() },
        at: when,
        actor: actor(),
      });
    else
      seeds.push({
        id,
        kind: "system",
        body: { name: word(), intendedUse: word(), version: id },
        at: when,
        actor: actor(),
      });
  }
  return seeds;
}

const ctx = caller();
async function allPages(read: (cursor?: string) => Promise<RecordSearchPage>) {
  const pages: RecordSearchPage[] = [];
  let cursor: string | undefined;
  do {
    const page = await read(cursor);
    pages.push(page);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return pages;
}
const ids = (records: { id: string }[]) => records.map((r) => r.id);
async function searchAll(search: RecordSearch, context = ctx) {
  const pages = await allPages((cursor) =>
    searchRecords(context, "ENG-1", { ...search, cursor }),
  );
  return { pages, records: pages.flatMap((p) => p.records) };
}

describe("record search in SQL", () => {
  it.each([1, 2, 3])(
    "agrees with the in-memory register filter and review states (seed %i)",
    async (seed) => {
      await insert(randomRecords(seed, 500));
      const all = everyRecord();
      for (const record of (await searchAll({})).records)
        expect(record.reviewState, record.id).toBe(
          ["assertion", "impact", "obligation"].includes(record.kind)
            ? workbenchReviewState(record, all)
            : null,
        );
      const kindSets = [
        ["assertion"],
        ["location"],
        ["impact", "obligation"],
        ["system", "location", "assertion", "obligation"],
        [],
      ];
      const terms = [
        "",
        "alpha",
        "ECHO-1",
        "50%_",
        "%",
        "_off",
        "rhea",
        "arto auditor",
        "AS-00",
        "nothing-matches",
        "überprüfung",
        "ÜBERPRÜFUNG-1",
        "ÆRØ",
        "σχέδιο",
        "Σκοπός",
        "σκοπός",
        "ΣΚΟΠΌΣ-1",
        "MÜLLER",
        "jörg müller",
        "*",
        "?",
        "[b]",
        "A*[B]?C",
        "[",
      ];
      for (const kinds of kindSets)
        for (const term of terms)
          for (const review of ["all", "Awaiting review", "Returned"]) {
            const rows = kinds.length
                ? all.filter((r) => kinds.includes(r.kind))
                : all,
              expected = selectWorkbenchRecords(
                rows,
                all,
                term,
                review,
                recordTitle,
                person,
              ),
              { pages, records } = await searchAll({
                kinds,
                term,
                review,
                limit: 37,
              });
            expect(
              ids(records),
              JSON.stringify({ kinds, term, review }),
            ).toEqual(ids(expected));
            expect(pages[0].total).toBe(expected.length);
          }
    },
    30_000,
  );

  it("stays within the tenant and the engagement", async () => {
    await insert([
      { id: "AS-1", kind: "location", body: { label: "alpha" }, at: at(1) },
      {
        id: "AS-2",
        kind: "location",
        body: { label: "alpha" },
        at: at(1),
        engagement: "ENG-2",
      },
      {
        id: "AS-3",
        kind: "location",
        body: { label: "alpha" },
        at: at(1),
        tenant: "tenant-2",
      },
      // A review in another engagement does not confirm ENG-1's assertion.
      { id: "AS-4", kind: "assertion", body: { statement: "x" }, at: at(1) },
      {
        id: "AS-5",
        kind: "assertion_review",
        body: { assertionId: "AS-4", decision: "approve" },
        at: at(2),
        engagement: "ENG-2",
      },
    ]);
    expect(ids((await searchAll({ term: "alpha" })).records)).toEqual(["AS-1"]);
    expect(
      ids((await searchRecords(ctx, "ENG-2", { term: "alpha" })).records),
    ).toEqual(["AS-2"]);
    expect(
      (await searchRecords(ctx, "ENG-1", { kinds: ["assertion"] })).records[0]
        .reviewState,
    ).toBe("Awaiting review");
  });

  it("knows every case form of every letter", () => {
    const expected = new Map<string, string[]>();
    for (let cp = 0x80; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp < 0xe000) continue;
      const c = String.fromCodePoint(cp),
        canonical = canonicalCaseForm(c);
      if (canonical === undefined || canonical === c) continue;
      expected.set(canonical, [...(expected.get(canonical) ?? []), c]);
    }
    expect(expected.size).toBeGreaterThan(1000);
    for (const [canonical, forms] of expected)
      expect([...caseForms(canonical)].sort(), canonical).toEqual(forms.sort());
    expect(caseForms("σ").sort()).toEqual(["Σ", "ς"].sort());
  }, 30_000);

  it("ignores the case of non-ASCII letters", async () => {
    await insert([
      {
        id: "AS-1",
        kind: "location",
        body: { label: "überprüfung der Daten" },
        at: at(1),
      },
      {
        id: "AS-Ü-2",
        kind: "assertion",
        body: { statement: "x" },
        at: at(2),
        actor: "user-mueller",
      },
      { id: "AS-3", kind: "location", body: { label: "Uber" }, at: at(3) },
    ]);
    const find = async (term: string) =>
      ids((await searchAll({ term })).records);
    expect(await find("Überprüfung")).toEqual(["AS-1"]);
    expect(await find("ÜBERPRÜFUNG DER")).toEqual(["AS-1"]);
    expect(await find("überprüfung")).toEqual(["AS-1"]);
    expect(await find("as-ü-2")).toEqual(["AS-Ü-2"]);
    expect(await find("  MÜLLER  ")).toEqual(["AS-Ü-2"]);
    expect(await find("JÖRG")).toEqual(["AS-Ü-2"]);
    // An umlaut is its own letter, not its base letter.
    expect(await find("uber")).toEqual(["AS-3"]);
    // Every character is literal, and a term may pass D1's 50-byte patterns.
    expect(await find("ÜBERPRÜFUNG DER DATEN")).toEqual(["AS-1"]);
    expect(await find("%")).toEqual([]);
    await insert([
      {
        id: "AS-5",
        kind: "location",
        body: { label: "Σκοπός της αξιολόγησης" },
        at: at(5),
      },
    ]);
    // Σ, σ and ς are one letter, wherever they stand.
    expect(await find("Σκοπός")).toEqual(["AS-5"]);
    expect(await find("σκοπός")).toEqual(["AS-5"]);
    expect(await find("ΣΚΟΠΌΣ")).toEqual(["AS-5"]);
    expect(await find("σκοπόσ τησ")).toEqual(["AS-5"]);
    expect(await find("ΑΞΙΟΛΌΓΗΣΗΣ")).toEqual(["AS-5"]);
    // An accented letter is its own letter, as an umlaut is.
    expect(await find("ΣΚΟΠΟΣ")).toEqual([]);
    const greek = "αβγδεζηθικλμνξοπρστυφχψω";
    await insert([
      {
        id: "AS-4",
        kind: "location",
        body: { label: greek + " " + "x".repeat(60) },
        at: at(4),
      },
    ]);
    expect(await find(greek.toUpperCase() + " " + "X".repeat(60))).toEqual([
      "AS-4",
    ]);
  });

  it("finds a record far past the first page among 5,000", async () => {
    const seeds: Seed[] = Array.from({ length: 5000 }, (_, i) => ({
      id: "AS-" + String(i).padStart(5, "0"),
      kind: i % 2 ? "location" : "assertion",
      body:
        i % 2
          ? { label: "Source " + i, locator: "page " + i }
          : { statement: "Assertion " + i, criterion: "Art. 10" },
      at: at(Math.floor(i / 100)),
      actor: people[i % 3][0],
    }));
    seeds[4321].body = { label: "Needle validation extract", locator: "p. 9" };
    await insert(seeds);
    const started = performance.now(),
      found = await searchRecords(ctx, "ENG-1", { term: "needle" });
    expect(ids(found.records)).toEqual(["AS-04321"]);
    expect(found).toMatchObject({ total: 1, nextCursor: null });
    // The first page of records (200, in record order) does not hold it.
    expect(
      everyRecord()
        .slice(0, 200)
        .some((r) => r.id === "AS-04321"),
    ).toBe(false);
    const first = await searchRecords(ctx, "ENG-1", {
      kinds: ["location", "assertion"],
    });
    expect(first.records).toHaveLength(searchPageSize);
    expect(first.total).toBe(5000);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it.each([
    [{ kinds: ["Location"] }, "Invalid record kinds"],
    [{ kinds: ["a;drop"] }, "Invalid record kinds"],
    [{ review: "Approved" }, "Invalid review state"],
    [{ cursor: "not a cursor" }, "Invalid page cursor"],
  ] as [RecordSearch, string][])("rejects %j", async (search, message) => {
    const outcome = await searchRecords(ctx, "ENG-1", search).catch(
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ApiError);
    expect(outcome).toMatchObject({ status: 400, message });
  });

  it("bounds the page size", async () => {
    await insert(
      Array.from({ length: 250 }, (_, i) => ({
        id: "AS-" + String(i).padStart(3, "0"),
        kind: "location",
        body: {},
        at: at(1),
      })),
    );
    expect(
      (await searchRecords(ctx, "ENG-1", { limit: 1000 })).records,
    ).toHaveLength(200);
    expect(
      (await searchRecords(ctx, "ENG-1", { limit: 0 })).records,
    ).toHaveLength(1);
  });

  it("looks up each assessment's latest review through idx_review_subject", async () => {
    const statements: string[] = [],
      prepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql: string) => {
      statements.push(sql);
      return prepare(sql);
    };
    await searchRecords(ctx, "ENG-1", { review: "Confirmed" });
    const plan = sqlite
      .prepare("EXPLAIN QUERY PLAN " + statements[0])
      .all()
      .map((row) => String(row.detail));
    // Tenant, engagement, review kind and subject, newest first: one seek.
    expect(plan).toContain(
      "SEARCH v USING INDEX idx_review_subject (tenant_id=? AND engagement_id=? AND kind=? AND <expr>=?)",
    );
    expect(plan.some((d) => d.includes("TEMP B-TREE"))).toBe(false);
    // No window over every review of the engagement any more.
    expect(statements[0]).not.toMatch(/ROW_NUMBER|OVER \(/);
  });
});

describe("review queue in SQL", () => {
  it.each([
    ["Lead Auditor", "user-lead"],
    ["Reviewer", "user-reviewer"],
    ["Auditor", "user-auditor"],
  ] as [Role, string][])(
    "agrees with the in-memory queue for a %s",
    async (role, userId) => {
      await insert(randomRecords(7, 600));
      const all = everyRecord(),
        context = { ...caller(role), user: { ...ctx.user, userId } },
        expected = workbenchReviewQueue(all, role, userId);
      for (const state of [
        "awaiting",
        "returned",
        "reviewable",
        "revisable",
      ] as const) {
        const pages = await allPages((cursor) =>
          reviewQueuePage(context, "ENG-1", state, { cursor, limit: 13 }),
        );
        expect(ids(pages.flatMap((p) => p.records)), state).toEqual(
          ids(expected[state]),
        );
        expect(pages[0].total, state).toBe(expected[state].length);
      }
      const summary = await reviewQueueSummary(context, "ENG-1");
      expect(summary).toMatchObject({
        awaiting: expected.awaiting.length,
        returned: expected.returned.length,
        reviewable: expected.reviewable.length,
        revisable: expected.revisable.length,
        canReview: expected.canReview,
        canRevise: expected.canRevise,
      });
      expect(summary.next.awaiting?.id).toBe(expected.awaiting[0]?.id);
      expect(summary.next.reviewable?.id).toBe(expected.reviewable[0]?.id);
      expect(summary.next.returned?.id).toBe(expected.returned[0]?.id);
      expect(summary.next.revisable?.id).toBe(expected.revisable[0]?.id);
      expect(expected.awaiting.length).toBeGreaterThan(20);
      expect(expected.returned.length).toBeGreaterThan(20);
    },
  );
});
