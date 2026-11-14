import { describe, expect, it } from "vitest";
import { completionGates, paperRequired } from "./domain/gates";
import type { Engagement } from "./domain/types";
import { evidenceRequestCommand } from "./evidence-requests";
import {
  approvedWorkflow,
  artifact,
  at,
  engagement,
  paper,
  templatePaper,
} from "./workflow/test-fixtures";

let sequence = 0;
const run = (e: Engagement, op: string, data: unknown) =>
  evidenceRequestCommand(e, op, data, {
    role: "Lead Auditor",
    userId: "lead",
    at,
    id: () => "REQ-" + ++sequence,
    makeLimitationPaper: () => templatePaper("MEM-EX-01", "lead"),
  });

async function closedWithLimitation() {
  const e = engagement({
    workflow: approvedWorkflow(),
    stage: "Sign-off",
    artifacts: [artifact()],
    papers: [paper({ id: "WP-target" })],
  });
  const { requestId } = run(e, "createEvidenceRequest", {
    subject: "Training data lineage",
    description: "Lineage records for every training dataset",
    responsibleParty: "Data owner",
    periodVersion: "2026 model",
    handling: "Internal",
    dueDate: "2026-12-01",
    paperIds: ["WP-target"],
  });
  run(e, "closeEvidenceRequest", {
    requestId,
    disposition: "unobtainable",
    assessment: "The provider holds no lineage records for 2025",
  });
  const request = e.evidenceRequests!.find((r) => r.id === requestId)!;
  const memo = e.papers.find((p) => p.id === request.limitationPaperId)!;
  return { e, requestId, request, memo };
}
const memoGates = (e: Engagement, memoId: string) =>
  completionGates(e, "Adverse conclusion").filter((g) => g.recordId === memoId);

describe("evidence request limitation memos", () => {
  it("retires the memo when the request is reopened", async () => {
    const { e, requestId, memo } = await closedWithLimitation();
    expect(paperRequired(e, memo)).toBe(true);
    expect(memoGates(e, memo.id)).toHaveLength(1);
    run(e, "reopenEvidenceRequest", {
      requestId,
      reason: "The provider found the records",
    });
    expect(memo.retired).toEqual({
      requestId,
      actor: "lead",
      at,
      reason: "The provider found the records",
    });
    expect(paperRequired(e, memo)).toBe(false);
    expect(memoGates(e, memo.id)).toEqual([]);
  });

  it("revises the same memo when the request is closed again", async () => {
    const { e, requestId, request, memo } = await closedWithLimitation();
    memo.status = "signed";
    run(e, "reopenEvidenceRequest", { requestId, reason: "Records found" });
    const papers = e.papers.length;
    const { paperId } = run(e, "closeEvidenceRequest", {
      requestId,
      disposition: "no_longer_required",
      assessment: "The records are no longer needed after the scope change",
    });
    expect(paperId).toBe(memo.id);
    expect(e.papers).toHaveLength(papers);
    expect(request.limitationPaperId).toBe(memo.id);
    expect(memo).toMatchObject({
      revision: 2,
      status: "draft",
      required: true,
      title: "Evidence scope change",
      signatures: [],
    });
    expect(memo.retired).toBeUndefined();
    expect(memo.history).toHaveLength(1);
    expect(memo.history[0]).toMatchObject({ revision: 1 });
    expect(memo.body.limitations).toBe(
      "The records are no longer needed after the scope change",
    );
    expect(memoGates(e, memo.id)).toHaveLength(1);
  });
});
