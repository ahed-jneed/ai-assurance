import { describe, expect, it } from "vitest";
import { finalReportGates, type Engagement } from "../domain";
import {
  approvedWorkflow,
  command,
  engagement,
  evidenceRequest,
  finding,
  procedureId,
  procedureOf,
  submittedProcedure,
} from "../workflow/test-fixtures";
import { criterionRollup, reportElements } from "./report-gates";
import type {
  AssuranceLevel,
  ReportParticulars,
  ReportTerms,
} from "./report-model";

const particulars: ReportParticulars = {
  addressee: "The board of Fixture Bank AG",
  location: "Vienna, Austria",
  signatory: "Fixture Assurance GmbH",
  basisForModification: "",
};
const terms = (
  conclusion: ReportTerms["conclusion"],
  assuranceLevel: AssuranceLevel | null = "limited",
  engagementType: ReportTerms["engagementType"] = "attestation",
): ReportTerms => ({ engagementType, assuranceLevel, conclusion });
const withBasis = {
  ...particulars,
  basisForModification:
    "Two of nine criteria show material deviations that are not pervasive.",
};

/** An engagement in Sign-off whose one procedure is reviewed and signed. */
async function issuable() {
  const e = await submittedProcedure();
  await command(
    e,
    "reviewProcedure",
    { procedureId, reason: "The work supports the conclusion" },
    "reviewer",
  );
  const paperId = procedureOf(e, procedureId).paperId;
  e.papers.find((p) => p.id === paperId)!.status = "signed";
  e.stage = "Sign-off";
  return e;
}
const kinds = (e: Engagement, t: ReportTerms, p = particulars) =>
  finalReportGates(e, { ...t, particulars: p }).map((g) => g.id);

describe("conclusion types and assurance levels at final issuance", () => {
  it("issues every conclusion type at both levels on complete work", async () => {
    const e = await issuable();
    for (const level of ["limited", "reasonable"] as const) {
      expect(kinds(e, terms("unmodified", level))).toEqual([]);
      for (const c of ["qualified", "adverse", "disclaimer"] as const)
        expect(kinds(e, terms(c, level), withBasis)).toEqual([]);
    }
    expect(kinds(e, terms("readiness", null, "readiness"))).toEqual([]);
    expect(
      kinds(e, terms("factual_findings", null, "agreed_upon_procedures")),
    ).toEqual([]);
  });

  it("blocks an unmodified conclusion with an open High or Critical finding", async () => {
    const e = await issuable();
    e.findings.push(finding({ id: "F-1", severity: "Critical" }));
    for (const level of ["limited", "reasonable"] as const) {
      expect(kinds(e, terms("unmodified", level))).toEqual(["F-1"]);
      for (const c of ["qualified", "adverse", "disclaimer"] as const)
        expect(kinds(e, terms(c, level), withBasis)).toEqual([]);
    }
    expect(kinds(e, terms("readiness", null, "readiness"))).toEqual(["F-1"]);
    e.findings[0].status = "closed";
    expect(kinds(e, terms("unmodified", "reasonable"))).toEqual([]);
  });

  it("keeps a scope limitation from an unmodified conclusion, not from a disclaimer", async () => {
    const e = await issuable();
    e.evidenceRequests = [
      evidenceRequest({
        id: "REQ-9",
        required: false,
        disposition: "unobtainable",
      }),
    ];
    expect(kinds(e, terms("unmodified", "reasonable"))).toEqual(["REQ-9"]);
    expect(kinds(e, terms("disclaimer", "reasonable"), withBasis)).toEqual([]);
    expect(kinds(e, terms("qualified", "limited"), withBasis)).toEqual([]);
  });

  it("keeps a prohibited practice from an unmodified conclusion only", async () => {
    const e = await issuable();
    e.classification.prohibited = true;
    expect(kinds(e, terms("unmodified", "limited"))).toEqual(["prohibited"]);
    expect(kinds(e, terms("adverse", "limited"), withBasis)).toEqual([]);
  });

  it("requires a basis for every modified conclusion", async () => {
    const e = await issuable();
    for (const c of ["qualified", "adverse", "disclaimer"] as const) {
      const gates = finalReportGates(e, {
        ...terms(c, "reasonable"),
        particulars,
      });
      expect(gates.map((g) => g.id)).toEqual(["report:conclusion"]);
      expect(gates[0]).toMatchObject({ kind: "report" });
      expect(gates[0].message).toMatch(/^State the basis for the /);
    }
  });

  it("refuses terms the engagement type cannot express", async () => {
    const e = await issuable();
    expect(kinds(e, terms("unmodified", null))).toEqual(["report:title"]);
    expect(kinds(e, terms("qualified", null, "readiness"), withBasis)).toEqual([
      "report:title",
    ]);
  });
});

describe("ISAE 3000 report elements", () => {
  it("needs the addressee, signature and location stated at capture", async () => {
    const e = await issuable();
    const empty = {
      ...particulars,
      addressee: " ",
      signatory: "",
      location: "",
    };
    expect(kinds(e, terms("unmodified", "limited"), empty)).toEqual([
      "report:addressee",
      "report:signature",
      "report:location",
    ]);
    // The completion checklist, before a report is prepared, does not.
    expect(
      finalReportGates(e, terms("unmodified", "limited")).map((g) => g.id),
    ).toEqual([]);
  });

  it("lists every required element with its value", async () => {
    const e = await issuable();
    const elements = reportElements(
      e,
      terms("qualified", "reasonable"),
      withBasis,
      "2026-11-06T09:00:00.000Z",
    );
    expect(elements.map((el) => el.id)).toEqual([
      "title",
      "addressee",
      "subject",
      "criteria",
      "responsibilities",
      "standard",
      "independence",
      "work",
      "conclusion",
      "signature",
      "date",
      "location",
    ]);
    const value = (id: string) => elements.find((el) => el.id === id)!.value;
    expect(value("title")).toBe("Independent reasonable assurance report");
    expect(value("addressee")).toBe(withBasis.addressee);
    expect(value("standard")).toBe(
      "ISAE 3000 (Revised), attestation engagement",
    );
    expect(value("independence")).toContain("ISQM 1");
    expect(value("work")).toMatch(/^1 procedures under audit program revision/);
    expect(value("conclusion")).toMatch(/^In our opinion, except for/);
    expect(value("date")).toBe("2026-11-06T09:00:00.000Z");
    expect(elements.every((el) => el.problem === "")).toBe(true);
  });

  it("needs a summary of work from the audit program", () => {
    const e = engagement({ workflow: approvedWorkflow([]) });
    const work = reportElements(e, terms("unmodified"), particulars).find(
      (el) => el.id === "work",
    )!;
    expect(work.problem).toBe(
      "Select the procedures performed in the audit program",
    );
  });
});

describe("results by criterion", () => {
  it("rolls procedure outcomes and open findings up by criterion", async () => {
    const e = await issuable();
    const p = procedureOf(e, procedureId);
    expect(criterionRollup(e)).toEqual([
      {
        criterion: p.criterion.trim() || p.templateId,
        procedures: 1,
        supported: 1,
        exceptions: 0,
        notEvaluated: 0,
        openFindings: 0,
        openHighFindings: 0,
        result: "no_exceptions",
      },
    ]);
    e.findings.push(
      finding({
        id: "F-2",
        severity: "High",
        support: {
          findingId: "F-2",
          procedureId,
          paperIds: [],
          evidenceIds: [],
          runIds: [],
          actor: "auditor",
          at: "2026-11-05T10:00:00.000Z",
        },
      }),
    );
    expect(criterionRollup(e)[0]).toMatchObject({
      openFindings: 1,
      openHighFindings: 1,
      result: "exceptions",
    });
  });
});
