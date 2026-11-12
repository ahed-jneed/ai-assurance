import { describe, expect, it } from "vitest";
import { finalReportGates, type Engagement } from "../domain";
import {
  approvedWorkflow,
  command,
  completedQualityReview,
  engagement,
  evidenceRequest,
  finding,
  procedureId,
  procedureOf,
  recordAcceptance,
  submittedProcedure,
} from "../workflow/test-fixtures";
import {
  criterionRollup,
  independenceProblem,
  legacyIndependenceProblem,
  reportElements,
} from "./report-gates";
import {
  qualityStatement,
  type AssuranceLevel,
  ReportParticulars,
  ReportTerms,
} from "./report-model";

const particulars: ReportParticulars = {
  addressee: "The board of Fixture Bank AG",
  location: "Vienna, Austria",
  signatory: "Fixture Assurance GmbH",
  basisForModification: "",
  qualityStatement,
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
  e.qualityReview = completedQualityReview();
  recordAcceptance(e);
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

  it("issues a readiness assessment with gaps where strict readiness is blocked (#111)", async () => {
    const e = await issuable();
    e.findings.push(finding({ id: "F-1", severity: "High" }));
    e.evidenceRequests = [
      evidenceRequest({
        id: "REQ-9",
        required: false,
        disposition: "unobtainable",
      }),
    ];
    e.classification.prohibited = true;
    const gaps = terms("readiness_gaps", null, "readiness");
    expect(kinds(e, terms("readiness", null, "readiness"))).toEqual([
      "prohibited",
      "F-1",
      "REQ-9",
    ]);
    // The gaps must be described; then nothing blocks the output.
    const gates = finalReportGates(e, { ...gaps, particulars });
    expect(gates.map((g) => g.id)).toEqual(["report:conclusion"]);
    expect(gates[0].message).toBe(
      "Describe the gaps identified against the criteria and what remains to be addressed",
    );
    expect(
      kinds(e, gaps, {
        ...particulars,
        basisForModification: "F-1: logging is not in place for the scorer.",
      }),
    ).toEqual([]);
    // The output is labelled as not assurance and never states readiness.
    const conclusion = reportElements(e, gaps, particulars).find(
      (el) => el.id === "conclusion",
    )!;
    expect(conclusion.label).toBe(
      "Readiness assessment, gaps identified — not an assurance engagement",
    );
    expect(conclusion.value).toContain("It is not an assurance engagement");
    expect(conclusion.value).toContain(
      "does not state that the subject matter is ready",
    );
    // Assurance engagements cannot express it.
    expect(kinds(e, terms("readiness_gaps"))[0]).toBe("report:title");
  });

  it("prints the report's quality statement, else the default", async () => {
    const e = await issuable();
    const independence = (p?: ReportParticulars) =>
      reportElements(e, terms("unmodified"), p).find(
        (el) => el.id === "independence",
      )!.value;
    const own =
      "We complied with the Austrian professional code and apply ISQM 1.";
    expect(independence({ ...particulars, qualityStatement: own })).toBe(own);
    expect(independence({ ...particulars, qualityStatement: " " })).toBe(
      qualityStatement,
    );
    expect(independence()).toBe(qualityStatement);
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
    expect(value("independence")).toBe(qualityStatement);
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

  it("counts only the findings a client report lists, keeping the result", async () => {
    const e = await issuable();
    const support = (findingId: string) => ({
      findingId,
      procedureId,
      paperIds: [],
      evidenceIds: [],
      runIds: [],
      actor: "auditor",
      at: "2026-11-05T10:00:00.000Z",
    });
    e.findings.push(
      finding({
        id: "F-INTERNAL",
        severity: "High",
        visibility: "internal",
        support: support("F-INTERNAL"),
      }),
      finding({
        id: "F-CLIENT",
        severity: "Medium",
        visibility: "client",
        support: support("F-CLIENT"),
      }),
    );
    expect(criterionRollup(e)[0]).toMatchObject({
      openFindings: 2,
      openHighFindings: 1,
      result: "exceptions",
    });
    expect(
      criterionRollup(e, (f) => f.visibility === "client")[0],
    ).toMatchObject({
      openFindings: 1,
      openHighFindings: 0,
      result: "exceptions",
    });
  });
});

describe("independence element", () => {
  const element = (e: Engagement) =>
    reportElements(e, terms("unmodified"), particulars).find(
      (x) => x.id === "independence",
    )!;
  it("prints the firm's statement, never the internal planning note", async () => {
    const e = await issuable();
    e.workflow!.brief!.independence = "Internal conflicts note: partner X";
    expect(element(e).value).toBe(qualityStatement);
    expect(element(e).problem).toBe("");
  });
  it("comes from the acceptance record and declarations where the gate applies", async () => {
    const e = await issuable();
    // Briefs no longer ask for the free-text note (#23).
    e.workflow!.brief!.independence = "";
    expect(element(e).problem).toBe("");
    e.workflow!.declarations = e.workflow!.declarations!.filter(
      (d) => d.userId !== "reviewer",
    );
    expect(element(e).problem).toBe(independenceProblem);
    const gate = finalReportGates(e, {
      ...terms("unmodified"),
      particulars,
    }).find((g) => g.id === "report:independence");
    // The gate opens the acceptance panel.
    expect(gate).toMatchObject({ kind: "acceptance" });
  });
  it("keeps the brief's note for a workflow adopted before acceptance records", async () => {
    const e = await issuable();
    delete e.workflow!.acceptance;
    delete e.workflow!.acceptanceRequired;
    e.workflow!.declarations = [];
    expect(element(e).problem).toBe("");
    // A brief first saved after #23 has no note, since the form no longer
    // asks for one: the gate points to the acceptance record, the only
    // place left to record the assessment, and opens the acceptance panel.
    e.workflow!.brief!.independence = " ";
    expect(element(e).problem).toBe(legacyIndependenceProblem);
    expect(
      finalReportGates(e, { ...terms("unmodified"), particulars }).find(
        (g) => g.id === "report:independence",
      ),
    ).toMatchObject({ kind: "acceptance" });
    // Starting the acceptance record makes the gate apply, and an approved
    // record with every declaration clears the element without a note.
    const approved = await issuable();
    e.workflow!.acceptance = approved.workflow!.acceptance;
    e.workflow!.declarations = approved.workflow!.declarations;
    expect(element(e).problem).toBe("");
  });
});
