// What an internal export carries: the captured contract documents and, for
// a released final package, the completion memo citing the quality review.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { releaseChecklist, type Engagement, type Report } from "../domain";
import {
  approvedWorkflow,
  at,
  completedQualityReview,
  structuredEngagement,
  templatePaper,
} from "../workflow/test-fixtures";
import { completionMemo } from "./completion";
import { exportedPapers } from "./export";
import { paperContext, paperRevisions } from "./revision";

const internalHash = "1".repeat(64),
  clientHash = "2".repeat(64),
  released = "2026-11-05T15:00:00.000Z";
const completion = {
  templateIds: ["WP-RP-02", "MEM-SO-01"],
  internalHash,
  clientHash,
  approvedBy: "reviewer",
  approvedAt: "2026-11-05T14:00:00.000Z",
  releasedBy: "lead",
  releasedAt: released,
};
const signOff = {
  reportId: "REPORT-1",
  internalHash,
  clientHash,
  checklistRevision: 2,
  conclusion: "No significant matter remains unresolved",
  userId: "quality-reviewer",
  at: "2026-11-05T13:00:00.000Z",
};

async function releasedReport() {
  const e: Engagement = structuredEngagement({
    workflow: approvedWorkflow(),
    qualityReview: completedQualityReview({
      signOffs: [signOff, { ...signOff, reportId: "REPORT-0" }],
    }),
  });
  const memo = templatePaper("MEM-AC-01", "lead");
  e.papers.push(memo);
  const r: Report = {
    id: "REPORT-1",
    kind: "final",
    createdAt: at,
    actor: "lead",
    sha256: internalHash,
    clientSha256: clientHash,
    // What capture freezes (lib/commands/reports.ts).
    snapshot: {
      workflow: structuredClone(e.workflow),
      engagement: {
        id: e.id,
        title: e.title,
        stage: e.stage,
        classification: structuredClone(e.classification),
      },
      workingPapers: await paperRevisions(
        e.papers,
        paperContext(e, "tenant-1"),
      ),
    },
    release: {
      state: "released",
      completion,
      history: [],
    },
  };
  e.reports.push(r);
  return { e, r };
}

const directory = mkdtempSync(path.join(tmpdir(), "working-paper-export-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
function validate(documents: unknown[]) {
  const file = path.join(directory, "documents.json");
  writeFileSync(file, JSON.stringify(documents));
  return spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "../../../schemas/validate-working-paper-schema.mjs",
          import.meta.url,
        ),
      ),
      "--documents",
      file,
    ],
    { encoding: "utf8" },
  );
}

describe("internal paper exports", () => {
  it("adds the completion memo of a released package, citing its quality review", async () => {
    const { e, r } = await releasedReport();
    const documents = await exportedPapers({ tenantId: "tenant-1" }, e, r);
    expect(documents.map((d) => d.catalogId)).toEqual([
      "MEM-AC-01",
      "MEM-SO-01",
    ]);
    const memo = documents[1];
    expect(memo).toMatchObject({
      id: "REPORT-1-MEM-SO-01",
      kind: "memo",
      status: "sealed",
      audience: "internal",
      records: {
        qualityReview: {
          reviewerId: "quality-reviewer",
          checklistRevision: 2,
          // Only the sign-off of this exact package.
          signOffs: [signOff],
        },
        releaseCompletion: { reportId: "REPORT-1", ...completion },
      },
    });
    expect(
      memo.approvals.map((a) => [a.role, a.actorId, a.contentDigest]),
    ).toEqual([
      ["reviewer", "reviewer", internalHash],
      ["engagement_quality_reviewer", "quality-reviewer", internalHash],
      ["lead_auditor", "lead", internalHash],
    ]);
    expect(memo.evidence.map((d) => d.sha256)).toEqual([
      internalHash,
      clientHash,
    ]);
    expect(memo.narrative.results).toContain(
      "Engagement quality review sign-off: quality-reviewer",
    );
    const result = validate(documents);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("keeps an earlier release's memo when the engagement moves on", async () => {
    const { e, r } = await releasedReport();
    const before = await completionMemo(e, r, "tenant-1");
    expect(before?.scope).toMatchObject({
      systemId: e.workflow!.brief!.systemName,
      periodStart: e.workflow!.brief!.periodStart,
    });
    // The reviewer is replaced and the checklist saved again ...
    const q = e.qualityReview!;
    q.reviewerId = "replacement-reviewer";
    q.revision += 3;
    // ... and the brief is revised for a successor report.
    const brief = e.workflow!.brief!;
    brief.systemName = "Successor system";
    brief.periodStart = "2027-01-01";
    brief.periodEnd = "2027-06-30";
    brief.boundary = "The successor's boundary";
    e.title = "Renamed engagement";
    e.classification = {
      ...e.classification,
      operatorRole: "Importer / distributor",
    };
    const after = await completionMemo(e, r, "tenant-1");
    expect(after).toEqual(before);
    expect(after!.records!.qualityReview).toMatchObject({
      reviewerId: signOff.userId,
      checklistRevision: signOff.checklistRevision,
    });
  });

  it("names the reviewer and checklist of the sign-off, not of the live review", async () => {
    const { e, r } = await releasedReport();
    e.qualityReview!.reviewerId = "replacement-reviewer";
    e.qualityReview!.revision = 7;
    const memo = (await completionMemo(e, r, "tenant-1"))!;
    expect(memo.records!.qualityReview).toEqual({
      reviewerId: "quality-reviewer",
      checklistRevision: 2,
      signOffs: [signOff],
    });
  });

  it("has no completion memo before release", async () => {
    const { e, r } = await releasedReport();
    delete r.release!.completion;
    expect(await completionMemo(e, r, "tenant-1")).toBeNull();
    expect(
      (await exportedPapers({ tenantId: "tenant-1" }, e, r)).map(
        (d) => d.catalogId,
      ),
    ).toEqual(["MEM-AC-01"]);
  });

  it("carries the approver's completion checklist answers (#94)", async () => {
    const { e, r } = await releasedReport();
    const checklist = {
      items: releaseChecklist.map((i) => ({
        id: i.id,
        answer:
          i.id === "representations"
            ? ("not_applicable" as const)
            : ("confirmed" as const),
      })),
      note: "The engaging party is the responsible party.",
    };
    r.release!.completion = { ...completion, checklist };
    const memo = (await completionMemo(e, r, "tenant-1"))!;
    expect(memo.records!.releaseCompletion).toEqual({
      reportId: "REPORT-1",
      ...completion,
      checklist,
    });
    expect(memo.narrative.results).toContain(
      "Completion checklist: Written representations from the responsible party were obtained: not applicable",
    );
    expect(memo.narrative.results).toContain(
      "Completion checklist: Basis for not-applicable answers: The engaging party is the responsible party.",
    );
    const result = validate([memo]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("says when the approval recorded no completion checklist", async () => {
    const { e, r } = await releasedReport();
    const memo = (await completionMemo(e, r, "tenant-1"))!;
    expect(memo.narrative.results).toContain(
      "Completion checklist: not recorded with this approval",
    );
  });

  it("states a missing quality review sign-off instead of inventing one", async () => {
    const { e, r } = await releasedReport();
    e.qualityReview = undefined;
    const memo = (await completionMemo(e, r, "tenant-1"))!;
    expect(memo.records).toEqual({
      releaseCompletion: { reportId: "REPORT-1", ...completion },
    });
    expect(memo.approvals.map((a) => a.role)).toEqual([
      "reviewer",
      "lead_auditor",
    ]);
    expect(memo.narrative.results).toContain(
      "Engagement quality review: no sign-off of this package",
    );
    expect(validate([memo]).status).toBe(0);
  });

  it("exports nothing for a package captured before the contract", async () => {
    const { e, r } = await releasedReport();
    r.snapshot = { papers: [] };
    expect(await exportedPapers({ tenantId: "tenant-1" }, e, r)).toEqual([]);
  });
});
