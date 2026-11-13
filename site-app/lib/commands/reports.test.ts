import { describe, expect, it, vi } from "vitest";
import { sanitize } from "../client-projection";
import type { Engagement, Paper, Report } from "../domain";
import { ApiError } from "../http";
import {
  artifact,
  command,
  completedQualityReview,
  finding,
  paper,
  procedureId,
  procedureOf,
  recordAcceptance,
  submittedProcedure,
} from "../workflow/test-fixtures";
import { draftCaveat, qualityStatement } from "../domain/report-model";
import {
  computeClassificationAudits,
  incompleteLl144Runs,
  ll144InputSchema,
} from "../ll144-audit";
import { practiceReportSettings } from "../report-settings";
import { pendingJobCount } from "../assurance-store";
import { assertReleasable, reports } from "./reports";
import { caller } from "./test-fixtures";

// Report capture reads assurance records and jobs from D1; none exist here.
vi.mock("../assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assurance-store")>()),
  assurancePins: vi.fn(async () => []),
  pendingJobCount: vi.fn(async () => 0),
  assuranceGates: vi.fn(async () => []),
}));

// The reviewer's recorded team work is read from D1 too; none exists here.
vi.mock("../quality-review-records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../quality-review-records")>()),
  assertReviewerIndependent: vi.fn(async () => {}),
  assertSignerActive: vi.fn(async () => {}),
}));

// The practice's report settings are read from D1; none are set by default.
vi.mock("../report-settings", () => ({
  practiceReportSettings: vi.fn(async () => ({
    signatory: "",
    location: "",
    qualityStatement: "",
  })),
}));

const particulars = {
  addressee: "The board of Fixture Bank AG",
  location: "Vienna, Austria",
  signatory: "Fixture Assurance GmbH",
};
const qualified = {
  kind: "final",
  engagementType: "attestation",
  assuranceLevel: "limited",
  conclusion: "qualified",
  summary: "Two criteria show material deviations.",
  basisForModification:
    "Representativeness testing found deviations that are material but not pervasive.",
  ...particulars,
};
// Internal user ids that must never reach a client.
const internalIds = ["user-approver-7", "user-uploader-7", "user-finder-7"];

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
  e.classification.approvedBy = "user-approver-7";
  e.artifacts.push(
    artifact({
      id: "shared",
      visibility: "client",
      uploadedBy: "user-uploader-7",
    }),
  );
  e.findings.push(
    finding({
      id: "F-1",
      severity: "Medium",
      visibility: "client",
      createdBy: "user-finder-7",
      closedBy: "user-finder-7",
    }),
  );
  // A signed internal memo outside the program: never published.
  e.papers.push(
    paper({
      id: "memo",
      templateId: "MEM-SJ-01",
      title: "Significant judgement memo",
      kind: "memo",
      required: false,
      status: "signed",
      stage: "Reporting",
      body: { conclusion: "Internal judgement", conclusionStatus: "supported" },
    }),
  );
  return e;
}
async function capture(e: Engagement, data: Record<string, unknown>) {
  await reports.run(e, "createReport", data, caller());
  return e.reports.at(-1) as Report;
}
async function refusal(e: Engagement, data: Record<string, unknown>) {
  try {
    await capture(e, data);
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("Expected the capture to be refused");
}

describe("report capture terms", () => {
  it("refuses combinations the engagement type cannot express", async () => {
    const e = await issuable();
    expect(
      (await refusal(e, { ...qualified, assuranceLevel: null })).message,
    ).toBe(
      "Attestation engagement requires a limited or reasonable assurance level",
    );
    expect(
      (
        await refusal(e, {
          ...qualified,
          engagementType: "agreed_upon_procedures",
          conclusion: "factual_findings",
        })
      ).message,
    ).toBe(
      "Agreed-upon procedures provides no assurance; leave the level unset",
    );
    expect(
      (
        await refusal(e, {
          ...qualified,
          kind: "draft",
          conclusion: "readiness",
        })
      ).message,
    ).toMatch(/cannot express/);
    // A legacy opinion is no longer accepted for new reports.
    await expect(
      capture(e, {
        kind: "draft",
        opinion: "Qualified conclusion",
        summary: "Legacy",
      }),
    ).rejects.toThrow();
  });

  it("refuses a final report missing report elements", async () => {
    const e = await issuable();
    const error = await refusal(e, {
      ...qualified,
      addressee: "",
      signatory: "",
      location: "",
      basisForModification: "",
    });
    expect(error.status).toBe(400);
    expect(error.message).toBe(
      [
        "Name the report's addressee",
        "State the basis for the qualified conclusion, distinguishing material from pervasive effects",
        "Name the practitioner or firm signing the report",
        "State the location where the practitioner practises",
      ].join("; "),
    );
    // A draft may still capture the engagement.
    await capture(e, { ...qualified, kind: "draft", addressee: "" });
  });
});

describe("report model v2 snapshots", () => {
  it("records the terms, report elements, conclusion and results by criterion", async () => {
    const e = await issuable();
    const r = await capture(e, qualified);
    const s = r.snapshot as Record<string, unknown> & {
      elements: { id: string; value: string }[];
      conclusionStatement: Record<string, unknown>;
    };
    expect(s.contractVersion).toBe("2.0");
    expect(s.opinion).toBe("Qualified conclusion · limited assurance");
    expect(s.terms).toEqual({
      engagementType: "attestation",
      assuranceLevel: "limited",
      conclusion: "qualified",
    });
    expect(s.particulars).toEqual({
      ...particulars,
      basisForModification: qualified.basisForModification,
      qualityStatement,
    });
    expect(s.reportTitle).toBe("Independent limited assurance report");
    expect(s.conclusionStatement).toMatchObject({
      heading: "Qualified conclusion",
      basisHeading: "Basis for qualified conclusion",
      notAssurance: false,
    });
    expect(String(s.conclusionStatement.text)).toContain(
      "nothing has come to our attention",
    );
    expect(s.elements.find((el) => el.id === "date")!.value).toBe(r.createdAt);
    expect(s.criteria).toHaveLength(1);
    expect(
      (s.papers as { id: string; audience: string }[]).map((p) => [
        p.id,
        p.audience,
      ]),
    ).toContainEqual(["memo", "internal"]);
    await assertReleasable(e, { reportId: r.id }, caller());
  });

  it("refuses release while any external job is pending, counted over every job", async () => {
    const e = await issuable();
    const r = await capture(e, qualified);
    // An older job beyond the 100 most recent ones still counts (#151).
    vi.mocked(pendingJobCount).mockResolvedValueOnce(1);
    await expect(
      assertReleasable(e, { reportId: r.id }, caller()),
    ).rejects.toThrow("Complete or cancel external execution before release");
    await assertReleasable(e, { reportId: r.id }, caller());
  });

  it("keeps internal memos and internal user ids out of the client snapshot", async () => {
    const e = await issuable();
    const r = await capture(e, qualified);
    const client = r.clientSnapshot!;
    const papers = (client.papers as { id: string }[]).map((p) => p.id);
    expect(papers).toContain(procedureOf(e, procedureId).paperId);
    expect(papers).not.toContain("memo");
    const json = JSON.stringify(client);
    for (const id of internalIds) expect(json).not.toContain(id);
    expect(json).not.toContain("approvedBy");
    expect(client).toMatchObject({
      contractVersion: "2.0",
      opinion: "Qualified conclusion · limited assurance",
      terms: { conclusion: "qualified" },
      reportTitle: "Independent limited assurance report",
    });
    expect(client.engagement).toMatchObject({
      classification: { rationale: "", intendedPurpose: "" },
    });
  });

  it("publishes the client view the live projection shows (F-57 parity)", async () => {
    const e = await issuable();
    const r = await capture(e, qualified);
    r.release = {
      state: "released",
      releasedAt: r.createdAt,
      history: [],
    };
    const live = sanitize(e, caller("Client Viewer", false));
    const snapshot = live.reports[0].snapshot as {
      engagement: { classification: unknown };
      findings: unknown[];
      evidence: unknown[];
    };
    expect(snapshot.engagement.classification).toEqual(live.classification);
    expect(snapshot.findings).toEqual(live.findings);
    expect(snapshot.evidence).toEqual(live.artifacts.map(({ key, ...a }) => a));
    const json = JSON.stringify(live);
    for (const id of internalIds) expect(json).not.toContain(id);
  });

  it("publishes a memo once a Lead Auditor shares it with the client", async () => {
    const e = await issuable();
    await reports.run(
      e,
      "setPaperAudience",
      { paperId: "memo", audience: "client" },
      caller(),
    );
    const workingPaper = procedureOf(e, procedureId).paperId!;
    await reports.run(
      e,
      "setPaperAudience",
      { paperId: workingPaper, audience: "internal" },
      caller(),
    );
    const r = await capture(e, qualified);
    expect(
      (r.clientSnapshot!.papers as { id: string }[]).map((p) => p.id),
    ).toEqual(["memo"]);
    // Changing an audience after capture makes the package stale.
    await reports.run(
      e,
      "setPaperAudience",
      { paperId: "memo", audience: "internal" },
      caller(),
    );
    await expect(
      assertReleasable(e, { reportId: r.id }, caller()),
    ).rejects.toThrow("Audit source records changed after report capture");
    // Only a Lead Auditor decides what a client reads.
    expect(() =>
      reports.run(
        e,
        "setPaperAudience",
        { paperId: "memo", audience: "client" },
        caller("Auditor"),
      ),
    ).toThrow("Your role cannot perform this action");
  });

  it("refuses to release a package captured before report model v2", async () => {
    const e = await issuable();
    const r = await capture(e, qualified);
    // A report captured before v2: an opinion string, no paper audience and
    // the old client snapshot with internal memos and user ids.
    const legacy = structuredClone(r);
    legacy.id = "REPORT-LEGACY";
    const s = legacy.snapshot as Record<string, unknown>;
    for (const key of [
      "terms",
      "particulars",
      "elements",
      "conclusionStatement",
      "criteria",
      "reportTitle",
    ])
      delete s[key];
    s.opinion = "Qualified conclusion";
    s.contractVersion = "1.1";
    for (const p of s.papers as Record<string, unknown>[]) delete p.audience;
    legacy.clientSnapshot = {
      opinion: "Qualified conclusion",
      engagement: { classification: { approvedBy: "user-approver-7" } },
      papers: s.papers,
    };
    e.reports.push(legacy);
    await expect(
      assertReleasable(e, { reportId: legacy.id }, caller()),
    ).rejects.toThrow("Prepare a new report package");
    // A v2 internal snapshot paired with an old client snapshot is refused too.
    const mixed = structuredClone(r);
    mixed.id = "REPORT-MIXED";
    delete mixed.clientSnapshot!.contractVersion;
    e.reports.push(mixed);
    await expect(
      assertReleasable(e, { reportId: mixed.id }, caller()),
    ).rejects.toThrow("Prepare a new report package");
    await assertReleasable(e, { reportId: r.id }, caller());
  });

  it("counts only client-visible findings in the client's results by criterion", async () => {
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
        id: "F-INT",
        severity: "Medium",
        visibility: "internal",
        support: support("F-INT"),
      }),
      finding({
        id: "F-CLI",
        severity: "Medium",
        visibility: "client",
        support: support("F-CLI"),
      }),
    );
    const r = await capture(e, { ...qualified, kind: "draft" });
    const counts = (s: Record<string, unknown>) =>
      (s.criteria as { openFindings: number }[]).map((c) => c.openFindings);
    expect(counts(r.snapshot)).toEqual([2]);
    expect(counts(r.clientSnapshot!)).toEqual([1]);
  });

  it("references retired limitation memos and superseded papers, not as current papers (#94)", async () => {
    const e = await issuable();
    const retired = {
      requestId: "REQ-1",
      actor: "lead",
      at: "2026-11-04T10:00:00.000Z",
      reason: "The client sent a new extract",
    };
    const signature = {
      userId: "lead",
      at: "2026-11-03T10:00:00.000Z",
      revision: 2,
    } as unknown as Paper["signatures"][number];
    e.papers.push(
      paper({
        id: "memo-retired",
        templateId: "MEM-LS-01",
        kind: "memo",
        required: false,
        revision: 2,
        status: "signed",
        retired,
        signatures: [signature],
      }),
      paper({
        id: "paper-old",
        templateId: "WP-A10-01",
        status: "signed",
        supersededBy: "paper-new",
        supersededAt: "2026-11-02T10:00:00.000Z",
      }),
      // Retired, then superseded: listed once, as superseded.
      paper({
        id: "memo-both",
        templateId: "MEM-LS-01",
        kind: "memo",
        required: false,
        retired,
        supersededBy: "memo-retired",
      }),
    );
    e.evidenceRequests = [
      {
        ...(e.evidenceRequests?.[0] ?? {}),
        id: "REQ-1",
        limitationPaperId: "memo-retired",
      } as NonNullable<Engagement["evidenceRequests"]>[number],
    ];
    const r = await capture(e, qualified);
    const s = r.snapshot as {
      papers: { id: string }[];
      workingPapers: { documents: { id: string }[] };
      retiredPapers: Record<string, unknown>[];
      supersededPapers: { id: string }[];
      evidenceRequests: { limitationPaperId?: string }[];
    };
    expect(s.retiredPapers).toEqual([
      {
        id: "memo-retired",
        templateId: "MEM-LS-01",
        revision: 2,
        retired,
        signatures: [signature],
      },
    ]);
    expect(s.supersededPapers.map((p) => p.id)).toEqual([
      "paper-old",
      "memo-both",
    ]);
    for (const id of ["memo-retired", "paper-old", "memo-both"]) {
      expect(s.papers.map((p) => p.id)).not.toContain(id);
      expect(s.workingPapers.documents.map((p) => p.id)).not.toContain(id);
    }
    // The request's limitation memo resolves in the snapshot.
    const limitation = s.evidenceRequests.find(
      (q) => q.limitationPaperId,
    )!.limitationPaperId;
    expect(s.retiredPapers.map((p) => p.id)).toContain(limitation);
    // Neither list reaches the client.
    expect(r.clientSnapshot).not.toHaveProperty("retiredPapers");
    expect(JSON.stringify(r.clientSnapshot)).not.toContain("memo-retired");
  });

  it("states the firm's independence statement, not the internal planning note", async () => {
    const e = await issuable();
    e.workflow!.brief!.independence = "Internal: partner X declared a conflict";
    // Positive control: the internal strings checked below are really in
    // the engagement's workflow before capture.
    const internalWorkflow = JSON.stringify(e.workflow);
    expect(e.workflow!.acceptance!.engagementLetter).toContain("EL-2026-014");
    for (const internal of ["DEC-reviewer", "EL-2026-014", "competence"])
      expect(internalWorkflow).toContain(internal);
    const r = await capture(e, qualified);
    expect(JSON.stringify(r.clientSnapshot)).not.toContain("partner X");
    // The acceptance record and the declarations are internal (#23).
    for (const internal of ["DEC-reviewer", "EL-2026-014", "competence"])
      expect(JSON.stringify(r.clientSnapshot)).not.toContain(internal);
  });
});

describe("practice report settings (#111)", () => {
  const settings = {
    signatory: "Fixture Assurance GmbH, M. Muster",
    location: "Graz, Austria",
    qualityStatement:
      "We complied with the Austrian professional code and our firm applies ISQM 1.",
  };
  const independence = (s: Record<string, unknown>) =>
    (s.elements as { id: string; value: string }[]).find(
      (el) => el.id === "independence",
    )!.value;

  it("fills a blank signatory, location and quality statement from the practice", async () => {
    vi.mocked(practiceReportSettings).mockResolvedValueOnce(settings);
    const e = await issuable();
    const r = await capture(e, { ...qualified, signatory: "", location: "" });
    expect(r.snapshot.particulars).toMatchObject(settings);
    expect(independence(r.snapshot)).toBe(settings.qualityStatement);
    expect(independence(r.clientSnapshot!)).toBe(settings.qualityStatement);
    // The release gates recheck what the snapshot recorded.
    await assertReleasable(e, { reportId: r.id }, caller());
  });

  it("lets a report override each setting", async () => {
    vi.mocked(practiceReportSettings).mockResolvedValueOnce(settings);
    const e = await issuable();
    const own = "Our own statement for this engagement.";
    const r = await capture(e, { ...qualified, qualityStatement: own });
    expect(r.snapshot.particulars).toMatchObject({
      signatory: particulars.signatory,
      location: particulars.location,
      qualityStatement: own,
    });
    expect(independence(r.snapshot)).toBe(own);
  });

  it("still requires a signatory and location when the practice sets none", async () => {
    const e = await issuable();
    const error = await refusal(e, {
      ...qualified,
      signatory: "",
      location: "",
    });
    expect(error.message).toContain(
      "Name the practitioner or firm signing the report",
    );
  });
});

describe("readiness assessment with gaps (#111)", () => {
  const gaps = {
    kind: "final",
    engagementType: "readiness",
    assuranceLevel: null,
    conclusion: "readiness_gaps",
    summary: "Readiness against the AI Act obligations.",
    basisForModification:
      "F-9: no post-market monitoring plan; the logging obligation is not met.",
    ...particulars,
  };

  it("captures and releases with an open High finding, labelled not assurance", async () => {
    const e = await issuable();
    e.findings.push(
      finding({ id: "F-9", severity: "High", visibility: "client" }),
    );
    // Strict readiness is refused while the High finding is open.
    expect(
      (
        await refusal(e, {
          ...gaps,
          conclusion: "readiness",
          basisForModification: "",
        })
      ).message,
    ).toContain("F-9: unresolved high finding");
    const r = await capture(e, gaps);
    expect(r.snapshot).toMatchObject({
      opinion: "Readiness assessment, gaps identified (not assurance)",
      reportTitle: "AI readiness assessment report (not an assurance report)",
      conclusionStatement: {
        heading:
          "Readiness assessment, gaps identified — not an assurance engagement",
        basisHeading: "Gaps identified",
        notAssurance: true,
      },
    });
    expect(r.clientSnapshot).toMatchObject({
      opinion: "Readiness assessment, gaps identified (not assurance)",
      conclusionStatement: { notAssurance: true },
    });
    await assertReleasable(e, { reportId: r.id }, caller());
  });

  it("requires the gaps to be described", async () => {
    const e = await issuable();
    expect(
      (await refusal(e, { ...gaps, basisForModification: "" })).message,
    ).toBe(
      "Describe the gaps identified against the criteria and what remains to be addressed",
    );
  });
});

describe("the draft caveat (#144)", () => {
  type Statement = { heading: string; text: string; draftCaveat?: string };
  const statementOf = (s: Record<string, unknown>) =>
    s.conclusionStatement as Statement;

  it("marks an ISAE 3000 draft captured while gates are open, in both snapshots", async () => {
    const e = await issuable();
    // Without the engagement quality review a completion requirement is open.
    delete e.qualityReview;
    const r = await capture(e, { ...qualified, kind: "draft" });
    for (const s of [r.snapshot, r.clientSnapshot!]) {
      const c = statementOf(s);
      expect(c.heading).toBe("Qualified conclusion");
      expect(c.draftCaveat).toMatch(
        /^Draft, gates open: \d+ completion requirements? (was|were) open when this draft was captured\. The wording below is the proposed conclusion/,
      );
    }
  });

  it("counts the open gates, singular and plural", () => {
    expect(draftCaveat(1)).toMatch(
      /^Draft, gates open: 1 completion requirement was open/,
    );
    expect(draftCaveat(3)).toMatch(
      /^Draft, gates open: 3 completion requirements were open/,
    );
  });

  it("states no caveat on a draft with every gate closed, nor on a final report", async () => {
    const e = await issuable();
    const draft = await capture(e, { ...qualified, kind: "draft" });
    expect(statementOf(draft.snapshot)).not.toHaveProperty("draftCaveat");
    const final = await capture(e, qualified);
    for (const s of [final.snapshot, final.clientSnapshot!])
      expect(statementOf(s)).not.toHaveProperty("draftCaveat");
  });
});

describe("per-group LL144 runs in a report (#144)", () => {
  // A small per-group run: two groups, each its own audit.
  function perGroupRun(e: Engagement) {
    const rows = [
      ...Array.from(
        { length: 6 },
        (_, i) => `Female,Asian,${i < 3 ? "A" : "B"}`,
      ),
      ...Array.from({ length: 6 }, (_, i) => `Male,Asian,${i < 2 ? "A" : "B"}`),
    ];
    const input = ll144InputSchema.parse({
      datasetId: "EV-1",
      toolName: "Style classifier",
      distributionDate: "2025-03-01",
      auditDate: "2026-11-01",
      rate: "selection",
      sexColumn: "s",
      raceEthnicityColumn: "e",
      outcomeColumn: "o",
      classificationGroups: ["A", "B"],
      unknownValues: [],
      dataSource: {
        kind: "historical",
        source: "Candidates the tool classified, 2025-03 to 2026-09.",
        explanation:
          "Every candidate the tool assessed; categories self-identified.",
      },
      demographicsNotInferred: true,
      demographicsStatement:
        "Sex and race/ethnicity are the candidates' own answers; none was inferred.",
      acknowledgeHostedProcessing: true,
    });
    let n = 0;
    const audits = computeClassificationAudits(
      e,
      { ...input, classificationGroups: input.classificationGroups! },
      { id: "EV-1", name: "candidates.csv", sha256: "0".repeat(64) },
      ["s,e,o", ...rows, ""].join("\n"),
      {
        id: () => "LL144-" + ++n,
        runId: "LL144RUN-1",
        actor: "user-auditor",
        at: "2026-11-02T10:00:00.000Z",
      },
    );
    e.ll144Audits = audits;
    return audits;
  }
  const approve = (a: { status: string; approvedBy?: string }) => {
    a.status = "approved";
    a.approvedBy = "user-reviewer";
  };

  it("lists the runs with some groups approved and others not", () => {
    const run = (status: string, runId?: string) => ({
      status: status as "draft" | "approved",
      ...(runId
        ? { classification: { runId, group: "g", groups: ["g", "h"] } }
        : {}),
    });
    expect(
      incompleteLl144Runs([
        run("approved", "R1"),
        run("draft", "R1"),
        run("draft", "R2"),
        run("draft", "R2"),
        run("approved", "R3"),
        run("approved", "R3"),
        run("approved"),
      ]),
    ).toEqual([{ runId: "R1", approved: 1, groups: 2 }]);
  });

  it("refuses final capture while a run is partly approved, and counts it in a draft's caveat", async () => {
    const e = await issuable();
    const [first, second] = perGroupRun(e);
    approve(first);
    const error = await refusal(e, qualified);
    expect(error.status).toBe(409);
    expect(error.message).toMatch(
      /^Approve every group of LL144 run LL144RUN-1 before final capture \(1 of 2 approved\)/,
    );
    const draft = await capture(e, { ...qualified, kind: "draft" });
    expect(
      (draft.snapshot.conclusionStatement as { draftCaveat?: string })
        .draftCaveat,
    ).toMatch(/^Draft, gates open: 1 completion requirement was open/);
    approve(second);
    const final = await capture(e, qualified);
    expect(
      (
        final.snapshot.ll144Summaries as { classification: { group: string } }[]
      ).map((x) => x.classification.group),
    ).toEqual(["A", "B"]);
  });

  it("captures a run none of whose groups is approved without its summaries", async () => {
    const e = await issuable();
    perGroupRun(e);
    const final = await capture(e, qualified);
    expect(final.snapshot).not.toHaveProperty("ll144Summaries");
  });
});
