import { describe, expect, it } from "vitest";
import * as domain from "./domain";
import {
  articleNames,
  canWrite,
  classify,
  risk,
  roles,
  stages,
  type Classification,
} from "./domain";

describe("domain entry point", () => {
  it("exports the same runtime API", () => {
    // Type-only exports are checked by `tsc` through their importers.
    expect(Object.keys(domain).sort()).toEqual([
      "articleNames",
      "canWrite",
      "classify",
      "completionGates",
      "finalReportGates",
      "paperRequired",
      "reportBlockers",
      "risk",
      "roles",
      "stageGates",
      "stages",
    ]);
  });

  it("names the roles, lifecycle stages and high-risk requirement articles", () => {
    expect(roles).toEqual([
      "Auditor",
      "Lead Auditor",
      "Client Viewer",
      "Client Contributor",
      "Reviewer",
    ]);
    expect(stages).toEqual([
      "Planning",
      "Fieldwork",
      "Evidence evaluation",
      "Reporting",
      "Sign-off",
    ]);
    expect(Object.keys(articleNames)).toEqual([
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
    ]);
  });

  it("lets only Auditors and Lead Auditors record audit work", () => {
    expect(roles.filter(canWrite)).toEqual(["Auditor", "Lead Auditor"]);
  });
});

describe("classify", () => {
  const assessed: Classification = {
    prohibited: false,
    highRisk: false,
    transparency: false,
    profiling: false,
    annexRoute: "Annex III point 5(b)",
    operatorRole: "Provider",
    intendedPurpose: "Credit scoring",
    rationale: "",
    status: "provisional",
    version: "02024R1689-20260727",
    asOf: "2026-10-05",
  };

  it("keeps an unassessed system without a purpose unassessed", () => {
    expect(
      classify({
        ...assessed,
        annexRoute: "Unassessed",
        intendedPurpose: "",
        prohibited: true,
      }),
    ).toBe("Unassessed");
    expect(classify({ ...assessed, annexRoute: "Unassessed" })).toBe(
      "Minimal risk",
    );
  });

  it("ranks prohibited above high risk above transparency", () => {
    const all = { prohibited: true, highRisk: true, transparency: true };
    expect(classify({ ...assessed, ...all })).toBe("Prohibited");
    expect(classify({ ...assessed, ...all, prohibited: false })).toBe(
      "High risk",
    );
    expect(classify({ ...assessed, transparency: true })).toBe(
      "Specific transparency",
    );
    expect(classify(assessed)).toBe("Minimal risk");
  });
});

describe("risk", () => {
  it("scores likelihood times impact into severity bands", () => {
    expect(
      [
        [5, 5],
        [4, 5],
        [4, 4],
        [3, 4],
        [5, 2],
        [2, 3],
        [1, 5],
        [1, 1],
      ].map(([likelihood, impact]) => risk(likelihood, impact)),
    ).toEqual([
      { riskScore: 25, severity: "Critical" },
      { riskScore: 20, severity: "Critical" },
      { riskScore: 16, severity: "High" },
      { riskScore: 12, severity: "High" },
      { riskScore: 10, severity: "Medium" },
      { riskScore: 6, severity: "Medium" },
      { riskScore: 5, severity: "Low" },
      { riskScore: 1, severity: "Low" },
    ]);
  });
});
