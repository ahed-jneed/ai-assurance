import { describe, expect, it } from "vitest";
import catalog from "../catalog.json";
import {
  completionGates,
  finalReportGates,
  paperRequired,
  reportBlockers,
  stageGates,
  type Engagement,
  type Paper,
} from "../domain";
import { seedWorkflow } from "../workflow-seed";
import type { Procedure } from "../workflow-types";
import {
  approvedWorkflow,
  artifact,
  at,
  engagement,
  evidenceRequest,
  finding,
  paper,
  run,
  templatePaper,
} from "../workflow/test-fixtures";

const opinions = [
  "Qualified conclusion",
  "Adverse conclusion",
  "Unable to conclude",
];
const kinds = (e: Engagement, target: string) =>
  stageGates(e, target).map((g) => g.kind);

// The fixtures of scripts/workflow-ux-check.mjs, whose lifecycle-gate and
// final-issuance assertions the first two suites took over.
const evidence = artifact();
const base = paper({
  id: "paper",
  title: "Assessment",
  templateId: "WP-1",
  revision: 2,
  authorId: "author",
  contributors: ["contributor"],
  body: {
    results: "Recorded tests",
    conclusion: "Supported by evidence",
    conclusionStatus: "supported",
    criteria: "Assessment criteria",
  },
  evidenceIds: ["evidence"],
});
const planning = { ...base, id: "planning", stage: "Planning" };
const fieldwork = { ...base, id: "fieldwork", stage: "Fieldwork" };
const evaluation = { ...base, id: "evaluation", stage: "Evidence Evaluation" };
const monitoring = {
  ...base,
  id: "monitoring",
  stage: "Remediation and Monitoring",
};
const audit = engagement({
  workflow: approvedWorkflow(),
  id: "engagement",
  papers: [evaluation, fieldwork, planning, monitoring],
  artifacts: [evidence],
});
const activeRun = run({ id: "run", modelId: "model", state: "running" });
const complete = engagement({
  ...audit,
  stage: "Sign-off",
  papers: [{ ...planning, status: "signed" }],
  findings: [
    finding({
      id: "high",
      title: "High finding",
      severity: "High",
      status: "open",
    }),
  ],
});

describe("lifecycle stage gates", () => {
  it("lets only required Planning papers and classification gate Fieldwork", () => {
    expect(stageGates(audit, "Fieldwork")).toHaveLength(1);
    expect(
      stageGates(
        { ...audit, papers: [{ ...planning, status: "signed" }, fieldwork] },
        "Fieldwork",
      ),
    ).toHaveLength(0);
    expect(
      stageGates(
        {
          ...audit,
          classification: { ...audit.classification, status: "provisional" },
          papers: [],
        },
        "Fieldwork",
      )[0].kind,
    ).toBe("classification");
  });

  it("blocks skipped stages", () => {
    expect(stageGates(audit, "Reporting")[0].kind).toBe("stage");
  });

  it("gates Evidence evaluation on runs only, not paper signatures", () => {
    expect(
      stageGates(
        { ...audit, stage: "Fieldwork", runs: [activeRun] },
        "Evidence evaluation",
      )[0].kind,
    ).toBe("run");
    expect(
      stageGates({ ...audit, stage: "Fieldwork" }, "Evidence evaluation"),
    ).toHaveLength(0);
  });

  it("needs signed applicability exclusions before Reporting", () => {
    const excluded = {
      ...base,
      id: "excluded",
      stage: "Reporting",
      required: false,
      body: { ...base.body, conclusionStatus: "not_applicable" },
    };
    expect(
      stageGates(
        { ...audit, stage: "Evidence evaluation", papers: [excluded] },
        "Reporting",
      )[0].recordId,
    ).toBe("excluded");
  });
});

describe("opinion-aware final issuance", () => {
  it("keeps open high findings from a readiness opinion only", () => {
    expect(finalReportGates(complete, "Readiness assessment")[0].kind).toBe(
      "finding",
    );
    for (const opinion of opinions)
      expect(finalReportGates(complete, opinion)).toHaveLength(0);
  });

  it("requires Sign-off and completed runs for every opinion", () => {
    expect(
      finalReportGates(
        { ...complete, stage: "Reporting" },
        "Adverse conclusion",
      )[0].kind,
    ).toBe("stage");
    expect(
      finalReportGates(
        { ...complete, runs: [activeRun] },
        "Adverse conclusion",
      )[0].kind,
    ).toBe("run");
  });

  it("needs an approved classification for every opinion", () => {
    const provisional = {
      ...complete,
      findings: [],
      classification: {
        ...complete.classification,
        status: "provisional" as const,
      },
    };
    for (const opinion of ["Readiness assessment", ...opinions])
      expect(finalReportGates(provisional, opinion)).toEqual([
        {
          id: "classification",
          kind: "classification",
          title: "Approve regulatory classification",
          message: "Regulatory classification needs independent approval",
        },
      ]);
    expect(
      kinds({ ...provisional, stage: "Evidence evaluation" }, "Reporting"),
    ).toEqual(["classification"]);
    expect(kinds({ ...provisional, stage: "Reporting" }, "Sign-off")).toEqual([
      "classification",
    ]);
    const unassessed = {
      ...provisional,
      classification: { ...provisional.classification, intendedPurpose: "" },
    };
    expect(completionGates(unassessed).map((g) => g.title)).toEqual([
      "Assess and approve classification",
    ]);
  });

  it("reports the completion gate messages as blockers", () => {
    expect(completionGates(audit).map((g) => g.message)).toEqual(
      reportBlockers(audit),
    );
  });

  it("lets an approved prohibited practice support only a scoped adverse conclusion", () => {
    const prohibited = {
      ...complete,
      findings: [],
      classification: { ...complete.classification, prohibited: true },
    };
    expect(
      finalReportGates(prohibited, "Readiness assessment").some(
        (g) => g.id === "prohibited",
      ),
    ).toBe(true);
    expect(finalReportGates(prohibited, "Adverse conclusion")).toHaveLength(0);
  });

  it("needs supported conclusions for a readiness opinion only", () => {
    const qualified = {
      ...planning,
      status: "signed" as const,
      body: { ...planning.body, conclusionStatus: "qualified" },
    };
    const e = { ...audit, papers: [qualified] };
    expect(
      completionGates(e, "Readiness assessment").some(
        (g) => g.kind === "conclusion",
      ),
    ).toBe(true);
    expect(
      completionGates(e, "Qualified conclusion").some(
        (g) => g.kind === "conclusion",
      ),
    ).toBe(false);
  });
});

describe("legacy engagements (no structured workflow)", () => {
  const fresh = () =>
    engagement({
      classification: {
        ...engagement().classification,
        annexRoute: "Unassessed",
        intendedPurpose: "",
        status: "provisional",
      },
      papers: catalog.items
        .filter((t) => t.kind === "working_paper")
        .map((t) => templatePaper(t.id)),
    });
  const signedEverything = () =>
    engagement({
      stage: "Sign-off",
      papers: [
        paper({
          id: "signed",
          status: "signed",
          body: { conclusionStatus: "supported" },
        }),
      ],
    });

  it("gates Fieldwork on the classification and every Planning paper", () => {
    const gates = stageGates(fresh(), "Fieldwork");
    const planningPapers = catalog.items.filter(
      (t) => t.kind === "working_paper" && t.stage === "Planning",
    ).length;
    expect(gates.map((g) => g.kind)).toEqual([
      "classification",
      ...Array(planningPapers).fill("paper"),
    ]);
    expect(gates[0].title).toBe("Assess and approve classification");
    expect(new Set(gates.map((g) => g.message))).toEqual(
      new Set(["Planning papers and classification must be approved"]),
    );
  });

  it("names the approval still needed once a purpose is assessed", () => {
    const e = fresh();
    e.classification.intendedPurpose = "Credit scoring";
    expect(stageGates(e, "Fieldwork")[0].title).toBe(
      "Approve regulatory classification",
    );
  });

  it("does not ask for scope or program approval before Fieldwork", () => {
    expect(
      stageGates({ ...signedEverything(), stage: "Planning" }, "Fieldwork"),
    ).toEqual([]);
  });

  it("cannot be issued before the workflow is adopted", () => {
    for (const opinion of ["Readiness assessment", ...opinions])
      expect(finalReportGates(signedEverything(), opinion)).toEqual([
        {
          id: "workflow",
          kind: "workflow",
          title: "Adopt the engagement workflow",
          message:
            "Review the engagement brief and audit program before final issuance",
        },
      ]);
  });

  it("treats the paper's own flag as its requirement", () => {
    const e = engagement();
    expect(paperRequired(e, paper({ required: true }))).toBe(true);
    expect(paperRequired(e, paper({ required: false }))).toBe(false);
  });

  it("moves forward one stage at a time and never backwards", () => {
    const e = signedEverything();
    for (const [stage, target] of [
      ["Planning", "Evidence evaluation"],
      ["Fieldwork", "Planning"],
      ["Sign-off", "Sign-off"],
      ["Reporting", "Closed"],
    ])
      expect(stageGates({ ...e, stage }, target)).toEqual([
        {
          id: "stage",
          kind: "stage",
          title: "Advance one stage at a time",
          message: "Progress one lifecycle stage at a time",
        },
      ]);
  });

  it("gates Reporting and Sign-off on opinion-neutral completion", () => {
    const e = {
      ...signedEverything(),
      stage: "Evidence evaluation",
      findings: complete.findings,
    };
    expect(kinds(e, "Reporting")).toEqual(["workflow"]);
    expect(kinds({ ...e, stage: "Reporting" }, "Sign-off")).toEqual([
      "workflow",
    ]);
  });
});

describe("evidence request gates", () => {
  const withRequest = (
    overrides: Parameters<typeof evidenceRequest>[0],
    artifacts = [evidence],
  ) =>
    engagement({
      ...complete,
      findings: [],
      evidenceRequests: [evidenceRequest(overrides)],
      artifacts,
    });
  const requestGates = (e: Engagement, opinion?: string) =>
    completionGates(e, opinion)
      .filter((g) => g.kind === "request")
      .map((g) => g.message);
  const undisposed =
    "REQ-1: required evidence request needs a documented disposition";

  it("closes a required request with accepted evidence or a waiver", () => {
    expect(requestGates(withRequest({}))).toEqual([]);
    expect(
      requestGates(withRequest({ status: "waived", evidenceIds: [] })),
    ).toEqual([]);
    expect(
      requestGates(withRequest({ required: false, status: "open" })),
    ).toEqual([]);
  });

  it("needs a documented disposition for open or unverified evidence", () => {
    expect(requestGates(withRequest({ status: "open" }))).toEqual([undisposed]);
    expect(requestGates(withRequest({ evidenceIds: [] }))).toEqual([
      undisposed,
    ]);
    expect(
      requestGates(withRequest({}, [artifact({ status: "quarantined" })])),
    ).toEqual([undisposed]);
  });

  it("keeps unobtainable evidence from a readiness opinion only", () => {
    const e = withRequest({ status: "waived", disposition: "unobtainable" });
    expect(requestGates(e, "Readiness assessment")).toEqual([
      "REQ-1: unavailable evidence prevents a readiness opinion",
    ]);
    for (const opinion of opinions)
      expect(requestGates(e, opinion)).toEqual([]);
  });
});

describe("structured engagements", () => {
  const seeded = (templateId: string): Procedure => {
    const p = seedWorkflow("lead", at).procedures.find(
      (p) => p.templateId === templateId,
    );
    if (!p) throw new Error("Unknown template " + templateId);
    return p;
  };
  // The work-items-check.mjs fixture: brief revision 2, program revision 3
  // bound to it and procedure revision 4 executed against both, reviewed,
  // with its compiled working paper (revision 2) signed.
  const signed = () => {
    const workflow = approvedWorkflow();
    workflow.brief = { ...workflow.brief!, revision: 2 };
    workflow.program = { ...workflow.program, revision: 3, briefRevision: 2 };
    workflow.procedures = [
      {
        ...seeded("WP-A10-01"),
        selected: true,
        applicability: "applicable",
        ownerId: "auditor",
        reviewerId: "reviewer",
        revision: 4,
        state: "reviewed",
        paperId: "compiled",
        paperRevision: 2,
        execution: {
          id: "EXEC-1",
          revision: 1,
          briefRevision: 2,
          programRevision: 3,
          procedureRevision: 4,
          performed: "Inspected lineage",
          steps: [],
          sampling: "All datasets",
          results: "No exceptions",
          limitations: "",
          evidenceIds: ["evidence"],
          runIds: [],
          actor: "auditor",
          at,
          assessment: {
            relevance: "Relevant",
            reliability: "Reliable",
            coverage: "Complete",
            contradictions: "None",
            conclusion: "Supported",
            outcome: "supported",
            actor: "auditor",
            at,
          },
        },
        review: {
          userId: "reviewer",
          at,
          revision: 4,
          hash: "d".repeat(64),
          reason: "Reviewed",
        },
      },
    ];
    return engagement({
      workflow,
      stage: "Sign-off",
      artifacts: [evidence],
      papers: [
        paper({
          id: "compiled",
          templateId: "WP-A10-01",
          revision: 2,
          status: "signed",
          body: { conclusionStatus: "supported" },
        }),
      ],
    });
  };
  const procedureOf = (e: Engagement) => e.workflow!.procedures[0];
  const messages = (e: Engagement, opinion?: string) =>
    completionGates(e, opinion).map((g) => g.message);
  const review = "WP-A10-01: current execution and independent review required";
  const sign = "WP-A10-01: sign the procedure working-paper revision";
  const brief = "The current engagement brief needs independent approval";
  const program = "The audit program must bind the approved scope revision";

  it("issues once every in-scope procedure is current, reviewed and signed", () => {
    for (const opinion of ["Readiness assessment", ...opinions])
      expect(finalReportGates(signed(), opinion)).toEqual([]);
  });

  it("requires the current approved scope and program", () => {
    const submitted = signed();
    submitted.workflow!.brief!.status = "submitted";
    expect(messages(submitted)).toEqual([brief]);
    const draft = signed();
    draft.workflow!.program.status = "draft";
    expect(messages(draft)).toEqual([program]);
    const stale = signed();
    stale.workflow!.program.briefRevision = 1;
    expect(messages(stale)).toEqual([program]);
    const missing = signed();
    missing.workflow!.brief = undefined;
    expect(messages(missing)).toEqual([brief, program, review]);
  });

  it("requires current execution and an independent review", () => {
    for (const invalidate of [
      (p: Procedure) => {
        p.execution!.briefRevision = 1;
      },
      // An execution recorded before plan hashes binds the plan revision.
      (p: Procedure) => {
        p.execution!.procedureRevision = 3;
      },
      (p: Procedure) => {
        p.planHash = "a".repeat(64);
        p.execution!.planHash = "b".repeat(64);
      },
      (p: Procedure) => {
        p.execution = undefined;
      },
      (p: Procedure) => {
        p.review = undefined;
      },
      (p: Procedure) => {
        p.state = "submitted";
      },
    ]) {
      const e = signed();
      invalidate(procedureOf(e));
      expect(messages(e)).toEqual([review]);
    }
  });

  it("binds the plan and scope, not the program revision", () => {
    // Other procedures' changes create program revisions.
    const e = signed();
    procedureOf(e).execution!.programRevision = 1;
    expect(messages(e)).toEqual([]);
    // An execution with a plan hash binds it instead of the plan revision.
    const p = procedureOf(e);
    p.planHash = p.execution!.planHash = "a".repeat(64);
    p.revision = 5;
    expect(messages(e)).toEqual([]);
  });

  it("accepts an independent impact review of an earlier execution", () => {
    const e = signed();
    const x = procedureOf(e).execution!;
    x.briefRevision = 1;
    x.impactReview = {
      briefRevision: 2,
      programRevision: 3,
      actor: "reviewer",
      at,
      reason: "The scope change does not affect this procedure",
    };
    expect(messages(e)).toEqual([]);
    x.procedureRevision = 3;
    expect(messages(e)).toEqual([review]);
  });

  it("requires the compiled working-paper revision to be signed", () => {
    const newer = signed();
    newer.papers[0].revision = 3;
    expect(messages(newer)).toEqual([sign]);
    const unsigned = signed();
    unsigned.papers[0].status = "reviewed";
    expect(messages(unsigned)).toEqual([sign, "WP-A10-01 is not signed"]);
    const missing = signed();
    missing.papers = [];
    expect(messages(missing)).toEqual([sign]);
  });

  it("ignores procedures outside the program and monitoring procedures", () => {
    for (const change of [
      { selected: false, applicability: "not_applicable" as const },
      { applicability: "not_applicable" as const },
      { stage: "Remediation and Monitoring" },
    ]) {
      const e = signed();
      Object.assign(procedureOf(e), change, { state: "planned" });
      e.papers = [];
      expect(messages(e)).toEqual([]);
    }
    const readiness = signed();
    Object.assign(procedureOf(readiness), {
      applicability: "readiness",
      state: "planned",
    });
    expect(messages(readiness)).toEqual([review]);
  });

  it("keeps an applicable procedure outside scope from a readiness opinion", () => {
    const e = signed();
    e.workflow!.procedures.push(
      { ...seeded("WP-A12-01"), selected: false, applicability: "applicable" },
      {
        ...seeded("WP-RM-02"),
        selected: false,
        applicability: "applicable",
      },
    );
    expect(messages(e, "Readiness assessment")).toEqual([
      "WP-A12-01: an applicable procedure outside audit scope prevents a readiness opinion",
    ]);
    for (const opinion of opinions) expect(messages(e, opinion)).toEqual([]);
  });

  it("requires a paper only while an approved program keeps it in scope", () => {
    const e = signed();
    const linked: Paper = { ...e.papers[0], status: "draft" };
    expect(paperRequired(e, linked)).toBe(true);
    expect(paperRequired(e, paper({ id: "unlinked" }))).toBe(true);
    for (const applicability of ["not_applicable", "pending"] as const) {
      procedureOf(e).applicability = applicability;
      expect(paperRequired(e, linked)).toBe(false);
    }
    procedureOf(e).applicability = "readiness";
    expect(paperRequired(e, linked)).toBe(true);
    procedureOf(e).selected = false;
    expect(paperRequired(e, linked)).toBe(false);
    e.workflow!.program.status = "submitted";
    expect(paperRequired(e, linked)).toBe(true);
    expect(paperRequired(e, { ...linked, required: false })).toBe(false);
  });

  it("gates Fieldwork on scope and program approval, not procedure work", () => {
    const e = signed();
    e.stage = "Planning";
    Object.assign(procedureOf(e), { state: "planned", execution: undefined });
    expect(stageGates(e, "Fieldwork")).toEqual([]);
    e.workflow!.brief!.status = "draft";
    e.workflow!.program.status = "draft";
    expect(stageGates(e, "Fieldwork").map((g) => g.id)).toEqual([
      "brief",
      "program",
    ]);
    expect(kinds(e, "Fieldwork")).toEqual(["workflow", "workflow"]);
  });

  it("excludes out-of-scope Planning papers from the Fieldwork gate", () => {
    const e = signed();
    e.stage = "Planning";
    const p = procedureOf(e);
    Object.assign(p, { stage: "Planning", selected: false });
    e.papers = [{ ...e.papers[0], stage: "Planning", status: "draft" }];
    expect(stageGates(e, "Fieldwork")).toEqual([]);
    p.selected = true;
    expect(kinds(e, "Fieldwork")).toEqual(["paper"]);
  });
});
