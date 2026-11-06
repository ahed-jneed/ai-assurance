import { describe, expect, it, vi } from "vitest";
import { sanitize } from "../client-projection";
import type { Engagement, Report } from "../domain";
import { ApiError } from "../http";
import {
  artifact,
  command,
  completedQualityReview,
  finding,
  paper,
  procedureId,
  procedureOf,
  submittedProcedure,
} from "../workflow/test-fixtures";
import { assertReleasable, reports } from "./reports";
import { caller } from "./test-fixtures";

// Report capture reads assurance records and jobs from D1; none exist here.
vi.mock("../assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assurance-store")>()),
  assurancePins: vi.fn(async () => []),
  jobs: vi.fn(async () => []),
  assuranceGates: vi.fn(async () => []),
}));

// The reviewer's recorded team work is read from D1 too; none exists here.
vi.mock("../quality-review-records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../quality-review-records")>()),
  assertReviewerIndependent: vi.fn(async () => {}),
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

  it("states the firm's independence statement, not the internal planning note", async () => {
    const e = await issuable();
    e.workflow!.brief!.independence = "Internal: partner X declared a conflict";
    const r = await capture(e, qualified);
    expect(JSON.stringify(r.clientSnapshot)).not.toContain("partner X");
  });
});
