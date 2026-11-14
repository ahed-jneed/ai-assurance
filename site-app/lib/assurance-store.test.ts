import { env } from "cloudflare:workers";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssuranceRecord } from "./assurance-core";
import {
  assuranceGates,
  assurancePageSize,
  assurancePins,
  briefingExport,
  compiledJobIds,
  currentObligations,
  datasetVersions,
  dossierSeal,
  hasSuccessor,
  jobs,
  jobTelemetry,
  pendingJobCount,
  pinnedRecordFacts,
  recordCount,
  recordKindCounts,
  recordPage,
  recordsById,
  storedBodies,
  systemRevisionExists,
  type AssessmentKind,
} from "./assurance-store";
import { caller } from "./commands/test-fixtures";
import { ApiError } from "./http";
import { sha256 } from "./ids";
import { sqliteD1 } from "./test-d1";

// The gate and pin computations of lib/assurance-store.ts at main@582657f,
// verbatim: they read every record of the engagement into memory (up to the
// old 1,000-record limit) in (created_at, id) order. The SQL computations
// must give the same results on the same records.
function legacyCurrentAssessments(all: AssuranceRecord[]) {
  const superseded = new Set(
    all
      .filter((r) => ["assertion", "impact", "obligation"].includes(r.kind))
      .map((r) => r.body.supersedesId)
      .filter(Boolean),
  );
  return all.filter(
    (r) =>
      ["assertion", "impact", "obligation"].includes(r.kind) &&
      !superseded.has(r.id),
  );
}
function legacyGates(all: AssuranceRecord[], opinion: string) {
  const messages: string[] = [];
  for (const r of legacyCurrentAssessments(all)) {
    const review = all
      .filter(
        (x) =>
          x.kind === r.kind + "_review" &&
          (x.body.assertionId ?? x.body.impactId ?? x.body.obligationId) ===
            r.id,
      )
      .at(-1);
    if (!review || !["approve", "confirmed"].includes(review.body.decision))
      messages.push(
        "Independent review required: " +
          (r.body.statement ?? r.body.description ?? r.body.code),
      );
    if (
      r.kind === "assertion" &&
      (r.body.conclusion === "unassessed" ||
        (opinion === "Readiness assessment" &&
          r.body.conclusion !== "supported"))
    )
      messages.push(
        "Assertion does not support this opinion: " + r.body.statement,
      );
    if (
      r.kind === "obligation" &&
      (r.body.applicability === "needs_information" ||
        (opinion === "Readiness assessment" &&
          r.body.applicability === "applicable" &&
          r.body.outcome !== "supported"))
    )
      messages.push("Obligation assessment remains unresolved: " + r.body.code);
  }
  return messages;
}
function legacyPins(all: AssuranceRecord[]) {
  return all
    .filter(
      (r) =>
        ![
          "assistant",
          "assistant_export",
          "assistant_acceptance",
          "key_rotation",
          "dossier",
          "access_event",
          "worker_event",
        ].includes(r.kind),
    )
    .map((r) => ({ id: r.id, kind: r.kind, sha256: r.sha256 }));
}

const ctx = caller(),
  opinions = [
    "Readiness assessment",
    "Qualified conclusion",
    "Adverse conclusion",
    "Unable to conclude",
  ];
let sqlite: DatabaseSync;
beforeEach(() => {
  const d1 = sqliteD1();
  env.DB = d1.db;
  sqlite = d1.sqlite;
  const at = "2026-01-01T00:00:00.000Z";
  for (const tenant of ["tenant-1", "tenant-2"]) {
    sqlite
      .prepare("INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)")
      .run(tenant, "Practice", at);
    sqlite
      .prepare(
        "INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES('CL-1',?,'Client','Finance',?)",
      )
      .run(tenant, at);
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
});
afterEach(() => {
  delete env.DB;
});

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
}
/** Every record of the engagement, read as the old records() did. */
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

// Gate edge cases: review order and ties, supersession, review targets,
// decisions and fields that are missing, null or not text.
const scenario: Seed[] = [
  {
    id: "AS-a01",
    kind: "assertion",
    body: { statement: "A1", conclusion: "supported" },
    at: at(1),
  },
  {
    id: "AS-a01r",
    kind: "assertion_review",
    body: { assertionId: "AS-a01", decision: "approve" },
    at: at(2),
  },
  // Approved, then returned: the latest review decides.
  {
    id: "AS-a02",
    kind: "assertion",
    body: { statement: "A2", conclusion: "qualified" },
    at: at(1),
  },
  {
    id: "AS-a02r1",
    kind: "assertion_review",
    body: { assertionId: "AS-a02", decision: "approve" },
    at: at(3),
  },
  {
    id: "AS-a02r2",
    kind: "assertion_review",
    body: { assertionId: "AS-a02", decision: "return" },
    at: at(4),
  },
  // Reviews recorded at the same instant: the larger id is the later one.
  {
    id: "AS-a03",
    kind: "assertion",
    body: { statement: "A3", conclusion: "supported" },
    at: at(5),
  },
  {
    id: "AS-a03rb",
    kind: "assertion_review",
    body: { assertionId: "AS-a03", decision: "approve" },
    at: at(6),
  },
  {
    id: "AS-a03ra",
    kind: "assertion_review",
    body: { assertionId: "AS-a03", decision: "return" },
    at: at(6),
  },
  {
    id: "AS-a04",
    kind: "assertion",
    body: { statement: "A4", conclusion: "supported" },
    at: at(5),
  },
  {
    id: "AS-a04ra",
    kind: "assertion_review",
    body: { assertionId: "AS-a04", decision: "approve" },
    at: at(6),
  },
  {
    id: "AS-a04rb",
    kind: "assertion_review",
    body: { assertionId: "AS-a04", decision: "return" },
    at: at(6),
  },
  // An unassessed conclusion supports no opinion.
  {
    id: "AS-a05",
    kind: "assertion",
    body: { statement: "A5", conclusion: "unassessed" },
    at: at(7),
  },
  {
    id: "AS-a05r",
    kind: "assertion_review",
    body: { assertionId: "AS-a05", decision: "confirmed" },
    at: at(8),
  },
  // A superseded assessment no longer gates; its successor does, and a
  // review of another kind is not its review.
  {
    id: "AS-a06",
    kind: "assertion",
    body: { statement: "A6", conclusion: "unassessed" },
    at: at(9),
  },
  {
    id: "AS-a07",
    kind: "assertion",
    body: { statement: "A7", conclusion: "supported", supersedesId: "AS-a06" },
    at: at(10),
  },
  {
    id: "AS-a07r",
    kind: "impact_review",
    body: { impactId: "AS-a07", decision: "confirmed" },
    at: at(11),
  },
  // Supersession across kinds counts.
  {
    id: "AS-a08",
    kind: "assertion",
    body: { statement: "A8", conclusion: "supported" },
    at: at(12),
  },
  {
    id: "AS-i02",
    kind: "impact",
    body: { description: "I2", supersedesId: "AS-a08" },
    at: at(13),
  },
  {
    id: "AS-i02r",
    kind: "impact_review",
    body: { impactId: "AS-i02", decision: "confirmed" },
    at: at(14),
  },
  // A review's target is assertionId ?? impactId ?? obligationId.
  {
    id: "AS-i01",
    kind: "impact",
    body: { description: "I1", decision: "no_effect" },
    at: at(15),
  },
  {
    id: "AS-i01r",
    kind: "impact_review",
    body: { assertionId: null, impactId: "AS-i01", decision: "confirmed" },
    at: at(16),
  },
  {
    id: "AS-o01",
    kind: "obligation",
    body: {
      code: "O-1",
      applicability: "needs_information",
      outcome: "unassessed",
    },
    at: at(17),
  },
  {
    id: "AS-o01r",
    kind: "obligation_review",
    body: { impactId: "AS-o02", obligationId: "AS-o01", decision: "confirmed" },
    at: at(18),
  },
  {
    id: "AS-o02",
    kind: "obligation",
    body: { code: "O-2", applicability: "applicable", outcome: "qualified" },
    at: at(19),
  },
  {
    id: "AS-o02r",
    kind: "obligation_review",
    body: { obligationId: "AS-o02", decision: "confirmed" },
    at: at(20),
  },
  {
    id: "AS-o03",
    kind: "obligation",
    body: { code: "O-3", applicability: "applicable", outcome: "supported" },
    at: at(21),
  },
  {
    id: "AS-o03r",
    kind: "obligation_review",
    body: { obligationId: "AS-o03" },
    at: at(22),
  },
  { id: "AS-o04", kind: "obligation", body: {}, at: at(23) },
  {
    id: "AS-a09",
    kind: "assertion",
    body: { statement: null, description: "D9" },
    at: at(24),
  },
  {
    id: "AS-a10",
    kind: "assertion",
    body: { statement: { text: "structured" }, conclusion: true },
    at: at(25),
  },
  {
    id: "AS-a11",
    kind: "assertion",
    body: { statement: "A11", conclusion: "supported" },
    at: at(26),
  },
  {
    id: "AS-a11r",
    kind: "assertion_review",
    body: { assertionId: "AS-a11", decision: ["approve"] },
    at: at(27),
  },
  {
    id: "AS-a12",
    kind: "assertion",
    body: { statement: "A12", conclusion: "supported" },
    at: at(28),
  },
  {
    id: "AS-a12r",
    kind: "assertion_review",
    body: { assertionId: "AS-a12", decision: "approve" },
    at: at(29),
    engagement: "ENG-2",
  },
  // Records of other kinds, pinned or not, never gate.
  {
    id: "AS-l01",
    kind: "location",
    body: { label: "Policy", artifactId: "EV-1" },
    at: at(1),
  },
  {
    id: "AS-s01",
    kind: "system",
    body: { name: "Scorer", version: "1" },
    at: at(2),
  },
  {
    id: "AS-d01",
    kind: "dataset",
    body: { name: "Applicants", version: "1.0" },
    at: at(3),
  },
  {
    id: "AS-d02",
    kind: "dataset",
    body: { name: "Applicants", version: "2.0" },
    at: at(30),
  },
  { id: "AS-p01", kind: "sample", body: { procedureId: "PROC-1" }, at: at(4) },
  {
    id: "AS-e01",
    kind: "assistant_export",
    body: { packetSha256: "f".repeat(64), processingDestination: "offline" },
    at: at(5),
  },
  {
    id: "AS-e02",
    kind: "assistant_export",
    body: { packetSha256: "f".repeat(64), processingDestination: "offline" },
    at: at(31),
  },
  ...[
    "assistant",
    "assistant_acceptance",
    "key_rotation",
    "access_event",
    "worker_event",
  ].map((kind, i) => ({
    id: "AS-u0" + i,
    kind,
    body: { statement: kind },
    at: at(6),
  })),
  {
    id: "AS-k01",
    kind: "dossier",
    body: { reportId: "REPORT-1", audience: "internal" },
    at: at(32),
  },
  // Another engagement and another practice are never read.
  {
    id: "AS-x01",
    kind: "assertion",
    body: { statement: "X1" },
    at: at(1),
    engagement: "ENG-2",
  },
  {
    id: "AS-x02",
    kind: "location",
    body: { label: "X2" },
    at: at(1),
    tenant: "tenant-2",
  },
  {
    id: "AS-x03",
    kind: "dossier",
    body: { reportId: "REPORT-1", audience: "client" },
    at: at(1),
    engagement: "ENG-2",
  },
];

// A deterministic generator (mulberry32), so a failure reproduces.
function generator(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: <T>(values: readonly T[]) =>
      values[Math.floor(next() * values.length)],
  };
}
/**
 * Random records of every kind: assessments with any mix of fields, reviews
 * of any target and decision, supersession across kinds, and timestamps
 * drawn from a few instants so that many records share one.
 */
function randomRecords(seed: number, count: number): Seed[] {
  const g = generator(seed),
    seeds: Seed[] = [],
    assessments: Seed[] = [],
    successors = new Set<string>(),
    maybe = <T>(value: T) => (g.next() < 0.15 ? undefined : value);
  for (let i = 0; i < count; i++) {
    const id = "AS-" + i.toString(36).padStart(4, "0") + g.pick([..."abcdef"]),
      when = at(Math.floor(g.next() * 12)),
      roll = g.next();
    if (roll < 0.35) {
      const kind = g.pick(["assertion", "impact", "obligation"] as const),
        body: Record<string, unknown> = {
          statement: maybe(kind === "assertion" ? "S" + i : undefined),
          description: maybe(kind === "impact" ? "D" + i : undefined),
          code: maybe(kind === "obligation" ? "C" + i : undefined),
          conclusion: maybe(
            g.pick(["unassessed", "supported", "qualified", "unsupported"]),
          ),
          applicability: maybe(
            g.pick([
              "applicable",
              "readiness",
              "not_applicable",
              "needs_information",
            ]),
          ),
          outcome: maybe(g.pick(["unassessed", "supported", "qualified"])),
        };
      // At most one successor of a kind per record (idx_assessment_successor).
      const previous = assessments.length && g.pick(assessments);
      if (previous && g.next() < 0.3 && !successors.has(kind + previous.id)) {
        successors.add(kind + previous.id);
        body.supersedesId = previous.id;
      }
      const record = { id, kind, body, at: when };
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
          decision: maybe(
            g.pick(["approve", "confirmed", "return", "returned"]),
          ),
        };
      if (g.next() < 0.1) body.assertionId = null;
      seeds.push({ id, kind: family + "_review", body, at: when });
    } else
      seeds.push({
        id,
        kind: g.pick([
          "location",
          "sample",
          "prediction",
          "statistics",
          "assistant",
          "assistant_export",
          "assistant_acceptance",
          "key_rotation",
          "access_event",
          "worker_event",
        ]),
        body: { n: i },
        at: when,
      });
  }
  return seeds;
}

describe("assurance gates and pins in SQL", () => {
  it("agree with the in-memory computations on the edge cases", async () => {
    await insert(scenario);
    const all = everyRecord();
    for (const opinion of opinions)
      expect(await assuranceGates(ctx, "ENG-1", opinion), opinion).toEqual(
        legacyGates(all, opinion),
      );
    const pins = await assurancePins(ctx, "ENG-1");
    expect(pins).toEqual(legacyPins(all));
    // Reports compare pins as JSON, so the key order matters too.
    expect(JSON.stringify(pins)).toBe(JSON.stringify(legacyPins(all)));
  });

  it("name the assessments that block an opinion", async () => {
    await insert(scenario);
    expect(await assuranceGates(ctx, "ENG-1", "Adverse conclusion")).toEqual([
      "Independent review required: A2",
      "Independent review required: A4",
      "Assertion does not support this opinion: A5",
      "Independent review required: A7",
      "Independent review required: O-1",
      "Obligation assessment remains unresolved: O-1",
      "Independent review required: O-3",
      "Independent review required: undefined",
      "Independent review required: D9",
      "Independent review required: [object Object]",
      "Independent review required: A11",
      "Independent review required: A12",
    ]);
    const readiness = await assuranceGates(
      ctx,
      "ENG-1",
      "Readiness assessment",
    );
    expect(readiness).toContain("Assertion does not support this opinion: A2");
    expect(readiness).toContain(
      "Obligation assessment remains unresolved: O-2",
    );
    expect(readiness).toContain(
      "Assertion does not support this opinion: [object Object]",
    );
    expect(readiness.join()).not.toMatch(/A1\b|A3|A6|A8|I1|I2|X1/);
  });

  // Hashing and inserting 600 to 1,200 records, then comparing every gate
  // and pin with the in-memory computation, takes 0.1 to 0.4 s on an idle
  // machine but passed the default 5 s timeout with three suites running at
  // once (#174). These tests check results, not speed, so the timeout only
  // ends a run that never finishes.
  const heavy = 60_000;
  it.each([1, 2, 3])(
    "agree with the in-memory computations on random records (seed %i)",
    async (seed) => {
      await insert(randomRecords(seed, 600));
      const all = everyRecord();
      expect(all).toHaveLength(600);
      // The records mix approved, unreviewed and superseded assessments.
      const current = legacyCurrentAssessments(all),
        unapproved = legacyGates(all, "Adverse conclusion").filter((m) =>
          m.startsWith("Independent review required"),
        );
      expect(current.length).toBeGreaterThan(100);
      expect(current.length).toBeLessThan(
        all.filter((r) =>
          ["assertion", "impact", "obligation"].includes(r.kind),
        ).length,
      );
      expect(unapproved.length).toBeGreaterThan(20);
      expect(unapproved.length).toBeLessThan(current.length - 20);
      for (const opinion of opinions)
        expect(await assuranceGates(ctx, "ENG-1", opinion), opinion).toEqual(
          legacyGates(all, opinion),
        );
      expect(await assurancePins(ctx, "ENG-1")).toEqual(legacyPins(all));
    },
    heavy,
  );

  it(
    "read past the old 1,000-record limit",
    async () => {
      await insert(randomRecords(4, 1200));
      const all = everyRecord();
      expect(all).toHaveLength(1200);
      expect(await assuranceGates(ctx, "ENG-1", "Adverse conclusion")).toEqual(
        legacyGates(all, "Adverse conclusion"),
      );
      const pins = await assurancePins(ctx, "ENG-1");
      expect(pins.length).toBeGreaterThan(500);
      expect(pins).toEqual(legacyPins(all));
    },
    heavy,
  );
});

describe("assurance record lookups", () => {
  it("look records up by id in record order, within the engagement", async () => {
    await insert(scenario);
    const all = everyRecord();
    const found = await recordsById(ctx, "ENG-1", [
      "AS-o01",
      "AS-a01",
      "AS-a01",
      7,
      null,
      "AS-x01",
      "AS-x02",
      "AS-missing",
    ]);
    expect(found).toEqual(
      all.filter((r) => ["AS-a01", "AS-o01"].includes(r.id)),
    );
    expect(await recordsById(ctx, "ENG-1", [])).toEqual([]);
    const bodies = await storedBodies(ctx, "ENG-1", ["AS-a10", "AS-x01"]);
    expect([...bodies.keys()]).toEqual(["AS-a10"]);
    const text = JSON.stringify(scenario.find((s) => s.id === "AS-a10")!.body);
    expect(bodies.get("AS-a10")).toEqual({
      body: text,
      sha256: await sha256(text),
    });
  });

  it("find successors, system revisions, dataset versions, exports and seals as in memory", async () => {
    await insert(scenario);
    const all = everyRecord();
    for (const kind of [
      "assertion",
      "impact",
      "obligation",
    ] as AssessmentKind[])
      for (const r of all)
        expect(await hasSuccessor(ctx, "ENG-1", kind, r.id), kind + r.id).toBe(
          all.some((x) => x.kind === kind && x.body.supersedesId === r.id),
        );
    expect(await systemRevisionExists(ctx, "ENG-1", "Scorer", "1")).toBe(true);
    expect(await systemRevisionExists(ctx, "ENG-1", "Scorer", "2")).toBe(false);
    expect(await datasetVersions(ctx, "ENG-1")).toEqual([
      { name: "Applicants", version: "1.0" },
      { name: "Applicants", version: "2.0" },
    ]);
    expect(
      (await briefingExport(ctx, "ENG-1", "f".repeat(64), "offline"))?.id,
    ).toBe("AS-e01");
    expect(
      await briefingExport(ctx, "ENG-1", "f".repeat(64), "elsewhere"),
    ).toBeUndefined();
    expect(await dossierSeal(ctx, "ENG-1", "REPORT-1", "internal")).toEqual(
      all.find((r) => r.id === "AS-k01"),
    );
    expect(
      await dossierSeal(ctx, "ENG-1", "REPORT-1", "client"),
    ).toBeUndefined();
  });

  it("find scoped seals by their scope digest and keep the full seal apart (#83)", async () => {
    await insert(scenario);
    const scoped = "a".repeat(64);
    await insert([
      {
        id: "AS-k02",
        kind: "dossier",
        body: {
          reportId: "REPORT-1",
          audience: "internal",
          scopeSha256: scoped,
        },
        at: at(33),
      },
    ]);
    expect((await dossierSeal(ctx, "ENG-1", "REPORT-1", "internal"))?.id).toBe(
      "AS-k01",
    );
    expect(
      (await dossierSeal(ctx, "ENG-1", "REPORT-1", "internal", null))?.id,
    ).toBe("AS-k01");
    expect(
      (await dossierSeal(ctx, "ENG-1", "REPORT-1", "internal", scoped))?.id,
    ).toBe("AS-k02");
    expect(
      await dossierSeal(ctx, "ENG-1", "REPORT-1", "internal", "b".repeat(64)),
    ).toBeUndefined();
    // drizzle 0012: one seal per report, audience and scope.
    for (const scopeSha256 of [undefined, scoped])
      await expect(
        insert([
          {
            id: "AS-k9" + (scopeSha256 ? "s" : "f"),
            kind: "dossier",
            body: { reportId: "REPORT-1", audience: "internal", scopeSha256 },
            at: at(34),
          },
        ]),
      ).rejects.toThrow("UNIQUE constraint failed");
  });

  it("read the facts a scope selects pinned records by, without bodies", async () => {
    await insert(scenario);
    const facts = await pinnedRecordFacts(ctx, "ENG-1"),
      pins = await assurancePins(ctx, "ENG-1");
    // Exactly the records a report pins.
    expect([...facts.keys()].sort()).toEqual(pins.map((p) => p.id).sort());
    expect(facts.get("AS-p01")).toEqual({
      kind: "sample",
      createdAt: at(4),
      procedureId: "PROC-1",
    });
    for (const pin of pins) expect(facts.get(pin.id)?.kind).toBe(pin.kind);
    expect(facts.has("AS-x01")).toBe(false);
  });
});

describe("assurance record pages", () => {
  // 450 records at four instants, so pages break inside runs of records
  // that share a timestamp; another engagement's records interleave.
  async function many() {
    await insert(
      Array.from({ length: 450 }, (_, i) => ({
        id: "AS-" + ((i * 7919) % 450).toString(36).padStart(3, "0"),
        kind: i % 3 ? "location" : "sample",
        body: { n: i },
        at: at(i % 4),
      })),
    );
    await insert(
      Array.from({ length: 30 }, (_, i) => ({
        id: "AS-" + i.toString(36).padStart(3, "0"),
        kind: "location",
        body: { other: i },
        at: at(i % 4),
        engagement: "ENG-2",
      })),
    );
  }
  async function pages(options: { kind?: string; limit?: number }) {
    const result: AssuranceRecord[][] = [];
    let cursor: string | undefined;
    do {
      const page = await recordPage(ctx, "ENG-1", { ...options, cursor });
      result.push(page.records);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return result;
  }

  it.each([1, 7, 200, 449, 450, 451])(
    "pages through records that share timestamps without repeating or skipping one (limit %i)",
    async (limit) => {
      await many();
      const all = everyRecord(),
        result = await pages({ limit });
      expect(result.flat()).toEqual(all);
      expect(result).toHaveLength(Math.ceil(450 / limit));
      expect(result.every((page) => page.length <= limit)).toBe(true);
    },
  );

  it("breaks pages inside a run of equal timestamps", async () => {
    await many();
    const result = await pages({ limit: 7 });
    expect(
      result.some(
        (page, i) =>
          i > 0 && page[0].createdAt === result[i - 1].at(-1)!.createdAt,
      ),
    ).toBe(true);
  });

  it("pages through one kind", async () => {
    await many();
    const result = await pages({ kind: "sample", limit: 7 });
    expect(result.flat()).toEqual(
      everyRecord().filter((r) => r.kind === "sample"),
    );
    expect(await recordPage(ctx, "ENG-1", { kind: "dossier" })).toEqual({
      records: [],
      nextCursor: null,
    });
  });

  it("serves the default page size and counts every record", async () => {
    await many();
    const first = await recordPage(ctx, "ENG-1");
    expect(first.records).toHaveLength(assurancePageSize);
    expect(first.records).toEqual(everyRecord().slice(0, assurancePageSize));
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(await recordCount(ctx, "ENG-1")).toBe(450);
    expect(await recordCount(ctx, "ENG-2")).toBe(30);
  });

  it("counts records by kind within the engagement", async () => {
    await many();
    expect(await recordKindCounts(ctx, "ENG-1")).toEqual({
      location: 300,
      sample: 150,
    });
    expect(await recordKindCounts(ctx, "ENG-2")).toEqual({ location: 30 });
    expect(await recordKindCounts(ctx, "ENG-3")).toEqual({});
  });

  it.each([
    "not a cursor",
    btoa("{}"),
    btoa(JSON.stringify([1, 2])),
    btoa(JSON.stringify(["2026-11-05T09:00:00.000Z"])),
    "A".repeat(1001),
  ])("rejects the cursor %s", async (cursor) => {
    await many();
    const outcome = await recordPage(ctx, "ENG-1", { cursor }).catch(
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ApiError);
    expect(outcome).toMatchObject({
      status: 400,
      message: "Invalid page cursor",
    });
  });
});

describe("external queue telemetry", () => {
  function job(
    id: string,
    state: string,
    leaseUntil: string | null = null,
    engagement = "ENG-1",
  ) {
    sqlite
      .prepare(
        "INSERT INTO execution_jobs(id,tenant_id,engagement_id,state,request,request_sha256,created_by,created_at,lease_until) VALUES(?,?,?,?,'{}','x','user-lead',?,?)",
      )
      .run(
        id,
        "tenant-1",
        engagement,
        state,
        at(Number(id.slice(4)) % 60),
        leaseUntil,
      );
  }

  it("counts every job, not only the 100 most recent", async () => {
    const past = new Date(Date.now() - 60_000).toISOString(),
      future = new Date(Date.now() + 60_000).toISOString();
    // 150 queued jobs, older than the 100 most recent ones below.
    for (let i = 0; i < 150; i++) job("JOB-" + i, "queued");
    for (let i = 150; i < 250; i++) job("JOB-" + i, "succeeded");
    job("JOB-250", "running", past);
    job("JOB-251", "running", future);
    job("JOB-252", "running", null);
    job("JOB-253", "queued", null, "ENG-2");
    expect(await jobTelemetry(ctx, "ENG-1")).toEqual({
      total: 253,
      queued: 150,
      running: 3,
      stalled: 1,
    });
    expect(await jobTelemetry(ctx, "ENG-3")).toEqual({
      total: 0,
      queued: 0,
      running: 0,
      stalled: 0,
    });
  });

  it("counts pending jobs beyond the 100 most recent ones", async () => {
    // One running job older than 120 finished ones: jobs() does not list it.
    job("JOB-0", "running");
    for (let i = 1; i <= 120; i++) job("JOB-" + i, "succeeded");
    job("JOB-121", "cancelled");
    job("JOB-122", "queued", null, "ENG-2");
    expect((await jobs(ctx, "ENG-1")).some((j) => j.id === "JOB-0")).toBe(
      false,
    );
    expect(await pendingJobCount(ctx, "ENG-1")).toBe(1);
    expect(await pendingJobCount(ctx, "ENG-2")).toBe(1);
    expect(await pendingJobCount(ctx, "ENG-3")).toBe(0);
  });

  it("lists what a GenAI ingest job's plan label is made of (#221)", async () => {
    const insertJob = sqlite.prepare(
      "INSERT INTO execution_jobs(id,tenant_id,engagement_id,state,request,request_sha256,created_by,created_at) VALUES(?,?,?,?,?,'x','user-lead',?)",
    );
    insertJob.run(
      "JOB-genai",
      "tenant-1",
      "ENG-1",
      "queued",
      JSON.stringify({
        executionMode: "genai_ingest",
        procedure: { id: "PRC-1", revision: 2 },
        plan: { criteria: [{ id: "a" }, { id: "b" }, { id: "c" }] },
        records: { bundle: "AS-bundle", plan: "AS-plan" },
      }),
      at(10),
    );
    insertJob.run(
      "JOB-tabular",
      "tenant-1",
      "ENG-1",
      "queued",
      JSON.stringify({
        executionMode: "classification",
        system: { name: "Credit model" },
      }),
      at(9),
    );
    // Records with the same id in another engagement and another tenant,
    // inserted first, with earlier times and keys that sort first, so a
    // subquery that dropped either scoping clause would read one of them.
    sqlite
      .prepare("INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)")
      .run("tenant-0", "Practice", at(0));
    sqlite
      .prepare(
        "INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES('CL-1','tenant-0','Client','Finance',?)",
      )
      .run(at(0));
    for (const [tenant, engagement] of [
      ["tenant-1", "ENG-0"],
      ["tenant-0", "ENG-1"],
    ])
      sqlite
        .prepare(
          "INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES(?,?,'CL-1','Audit',1,'{}','init')",
        )
        .run(engagement, tenant);
    await insert([
      {
        id: "AS-plan",
        kind: "genai_plan",
        body: {},
        at: at(1),
        engagement: "ENG-0",
      },
      {
        id: "AS-plan",
        kind: "genai_plan",
        body: {},
        at: at(2),
        tenant: "tenant-0",
      },
    ]);
    // The plan record itself.
    await insert([{ id: "AS-plan", kind: "genai_plan", body: {}, at: at(5) }]);
    const listed = await jobs(ctx, "ENG-1");
    expect(listed.map((j) => j.id)).toEqual(["JOB-genai", "JOB-tabular"]);
    expect(listed[0]).toMatchObject({
      mode: "genai_ingest",
      system_name: null,
      procedure_id: "PRC-1",
      plan_criteria: 3,
      plan_created_at: at(5),
    });
    expect(listed[1]).toMatchObject({
      mode: "classification",
      system_name: "Credit model",
      procedure_id: null,
      plan_criteria: null,
      plan_created_at: null,
    });
  });

  it("names the jobs already compiled into a draft paper", async () => {
    await insert([
      {
        id: "AS-1",
        kind: "execution_compilation",
        body: { jobId: "JOB-1" },
        at: at(1),
      },
      {
        id: "AS-2",
        kind: "execution_compilation",
        body: { jobId: "JOB-1" },
        at: at(2),
      },
      {
        id: "AS-3",
        kind: "execution_compilation",
        body: { jobId: "JOB-2" },
        at: at(2),
        engagement: "ENG-2",
      },
    ]);
    expect(await compiledJobIds(ctx, "ENG-1")).toEqual(["JOB-1"]);
  });
});

describe("current obligation records for coverage", () => {
  it("lists current records with whether their latest review confirms them", async () => {
    const t = (n: number) => "2026-01-01T00:00:0" + n + ".000Z";
    await insert([
      {
        id: "OB-1",
        kind: "obligation",
        at: t(1),
        body: {
          code: "AIA-9-1",
          applicability: "readiness",
          outcome: "supported",
        },
      },
      {
        id: "OR-1",
        kind: "obligation_review",
        at: t(2),
        actor: "user-reviewer",
        body: { obligationId: "OB-1", decision: "confirmed" },
      },
      {
        id: "OB-2",
        kind: "obligation",
        at: t(3),
        body: {
          code: "AIA-10-1",
          applicability: "applicable",
          outcome: "supported",
        },
      },
      {
        id: "OR-2",
        kind: "obligation_review",
        at: t(4),
        actor: "user-reviewer",
        body: { obligationId: "OB-2", decision: "returned" },
      },
      {
        id: "OB-3",
        kind: "obligation",
        at: t(5),
        body: {
          code: "AIA-9-2-a",
          applicability: "applicable",
          outcome: "qualified",
        },
      },
      {
        id: "OR-3",
        kind: "obligation_review",
        at: t(6),
        actor: "user-reviewer",
        body: { obligationId: "OB-3", decision: "confirmed" },
      },
      {
        id: "OB-4",
        kind: "obligation",
        at: t(7),
        body: {
          code: "AIA-9-2-a",
          applicability: "applicable",
          outcome: "supported",
          supersedesId: "OB-3",
        },
      },
      {
        id: "AS-1",
        kind: "assertion",
        at: t(8),
        body: { statement: "A claim", conclusion: "supported" },
      },
    ]);
    expect(await currentObligations(ctx, "ENG-1")).toEqual([
      {
        id: "OB-1",
        code: "AIA-9-1",
        applicability: "readiness",
        outcome: "supported",
        confirmed: true,
      },
      {
        id: "OB-2",
        code: "AIA-10-1",
        applicability: "applicable",
        outcome: "supported",
        confirmed: false,
      },
      {
        id: "OB-4",
        code: "AIA-9-2-a",
        applicability: "applicable",
        outcome: "supported",
        confirmed: false,
      },
    ]);
    expect(await currentObligations(ctx, "ENG-2")).toEqual([]);
  });
});
