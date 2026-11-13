import { describe, expect, it } from "vitest";
import {
  describeScope,
  dossierScopeRequest,
  inScope,
  scopeDefinition,
} from "./dossier-scope";

const parse = (v: unknown) => dossierScopeRequest.safeParse(v);

describe("dossier scope requests", () => {
  it("accept procedures, record types, a period or withheld evidence", () => {
    for (const scope of [
      { procedureIds: ["P-1"] },
      { recordKinds: ["location", "assertion"] },
      { period: { from: "2026-10-01", to: "2026-10-31" } },
      { period: { from: "2026-10-01", to: "2026-10-01" } },
      { evidence: "withheld" },
    ])
      expect(parse(scope).success, JSON.stringify(scope)).toBe(true);
  });

  it("refuse a scope that selects everything and malformed parts", () => {
    for (const scope of [
      {},
      { evidence: "included" },
      { procedureIds: [] },
      { recordKinds: ["Location"] },
      { recordKinds: ["a b"] },
      { period: { from: "2026-10-31", to: "2026-10-01" } },
      { period: { from: "2026-02-30", to: "2026-03-01" } },
      { period: { from: "2026-13-01", to: "2026-13-02" } },
      { period: { from: "2026-10-01T00:00:00Z", to: "2026-10-31" } },
      { period: { from: "2026-10-01" } },
      { procedureIds: ["P-1"], extra: true },
      { procedureIds: ["P-1"], evidence: "partial" },
    ])
      expect(parse(scope).success, JSON.stringify(scope)).toBe(false);
  });

  it("canonicalise into a sorted, deduplicated definition", () => {
    const request = dossierScopeRequest.parse({
      procedureIds: ["P-2", "P-1", "P-2"],
      recordKinds: ["sample", "assertion", "sample"],
    });
    expect(scopeDefinition(request, ["P-1", "P-2", "P-3"])).toEqual({
      procedureIds: ["P-1", "P-2"],
      recordKinds: ["assertion", "sample"],
      period: null,
      evidence: "included",
    });
    expect(() =>
      scopeDefinition(dossierScopeRequest.parse({ procedureIds: ["P-9"] }), [
        "P-1",
      ]),
    ).toThrow("Unknown procedure for this engagement: P-9");
  });
});

describe("dossier scope selection", () => {
  const scope = {
    procedureIds: ["P-1"],
    recordKinds: ["assertion", "sample"],
    period: { from: "2026-10-01", to: "2026-10-31" },
    evidence: "included" as const,
  };
  const facts = {
    kind: "sample",
    createdAt: "2026-10-31T23:59:59.999Z",
    procedureId: "P-1",
  };

  it("combines its parts: every stated part must hold", () => {
    expect(inScope(scope, facts)).toBe(true);
    expect(inScope(scope, { ...facts, kind: "location" })).toBe(false);
    expect(inScope(scope, { ...facts, procedureId: "P-2" })).toBe(false);
    expect(inScope(scope, { ...facts, procedureId: null })).toBe(false);
    // The period holds whole UTC days at both ends.
    expect(
      inScope(scope, { ...facts, createdAt: "2026-10-01T00:00:00.000Z" }),
    ).toBe(true);
    expect(
      inScope(scope, { ...facts, createdAt: "2026-11-01T00:00:00.000Z" }),
    ).toBe(false);
    expect(
      inScope(scope, { ...facts, createdAt: "2026-09-30T23:59:59.999Z" }),
    ).toBe(false);
    // Unstated parts select everything.
    expect(
      inScope(
        { ...scope, procedureIds: null, recordKinds: null, period: null },
        { kind: "worker_note", createdAt: "2020-01-01", procedureId: null },
      ),
    ).toBe(true);
  });

  it("states the scope and its counts", () => {
    expect(
      describeScope({ ...scope, pinnedRecords: 1200, includedRecords: 40 }),
    ).toBe(
      "Scoped export: procedures P-1; record types assertion, sample; created 2026-10-01 to 2026-10-31 (UTC); evidence bytes included. Includes 40 of 1200 pinned assurance records; report.json lists them all.",
    );
    expect(
      describeScope({
        procedureIds: null,
        recordKinds: null,
        period: null,
        evidence: "withheld",
        pinnedRecords: 3,
        includedRecords: 3,
      }),
    ).toBe(
      "Scoped export: all procedures; all record types; any date; evidence bytes withheld. Includes 3 of 3 pinned assurance records; report.json lists them all.",
    );
  });
});
