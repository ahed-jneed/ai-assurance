import { describe, expect, it } from "vitest";
import type { Report } from "./domain";
import { procedureReadiness } from "./procedure-readiness";
import { seedWorkflow } from "./workflow-seed";
import { approvedWorkflow, at, engagement } from "./workflow/test-fixtures";
import { resolveNew } from "./criteria/pin";

const seeded = (templateId: string) => ({
  ...seedWorkflow(resolveNew(), "lead", at).procedures.find(
    (p) => p.templateId === templateId,
  )!,
  selected: true,
  applicability: "applicable" as const,
});
function released(id: string, state: "released" | "superseded"): Report {
  return {
    id,
    kind: "final",
    createdAt: at,
    actor: "auditor",
    sha256: id,
    snapshot: {},
    release: {
      state,
      history: [],
      completion: {
        templateIds: ["WP-RP-02", "MEM-SO-01"],
        internalHash: id + "-internal",
        clientHash: id + "-client",
        approvedBy: "reviewer",
        approvedAt: at,
        releasedBy: "lead",
        releasedAt: id === "REPORT-2" ? "2026-11-07T10:00:00.000Z" : at,
      },
    },
  };
}

describe("procedure readiness in the drawer (#94)", () => {
  it("shows the generic checklist for ordinary work", () => {
    const p = seeded("WP-RP-01");
    const r = procedureReadiness(
      engagement({ workflow: approvedWorkflow([p]) }),
      p,
    );
    expect(r.kind).toBe("checks");
    expect(r.kind === "checks" && r.checks.map(([text]) => text)).toContain(
      "Working paper signed",
    );
  });

  it("replaces it with the release record on WP-RP-02", () => {
    const p = seeded("WP-RP-02");
    const e = engagement({ workflow: approvedWorkflow([p]) });
    expect(procedureReadiness(e, p)).toEqual({
      kind: "release_time",
      recorded: false,
      text: "Not recorded yet: approving and releasing the final package records it.",
    });
    e.reports = [
      released("REPORT-1", "superseded"),
      released("REPORT-2", "released"),
    ];
    expect(procedureReadiness(e, p)).toEqual({
      kind: "release_time",
      recorded: true,
      text: "Recorded with the release of REPORT-2 on 2026-11-07, against both approved package hashes.",
    });
  });

  it("does not count a withdrawn release as the record", () => {
    const p = seeded("WP-RP-02");
    const e = engagement({ workflow: approvedWorkflow([p]) });
    const withdrawn = released("REPORT-1", "released");
    withdrawn.release!.state = "withdrawn";
    e.reports = [withdrawn];
    expect(procedureReadiness(e, p)).toMatchObject({ recorded: false });
  });
});
