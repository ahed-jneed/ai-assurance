// The GenAI gate at procedure submission (#33, docs/design/genai-evidence.md
// section 12.3): a positive conclusion is refused while a linked GenAI result
// has blockers; not_supported is accepted with the blockers in the paper's
// limitations; a clear result puts its claim-scope statements in the results.
import { describe, expect, it } from "vitest";
import type { GenaiReadiness } from "../genai/readiness";
import { workflowCommand } from "./dispatch";
import {
  approveProgram,
  artifact,
  assessmentInput,
  context,
  executionInput,
  expectFailure,
  procedureId,
  structuredEngagement,
} from "./test-fixtures";

const readiness = (blockers: GenaiReadiness["blockers"]): GenaiReadiness => ({
  recordId: "AS-1",
  effectiveLevel: blockers.length ? "L1" : "L2",
  runs: [],
  blockers,
  pendingAcknowledgements: [],
  claimScope: [
    "accuracy 0.9 (95% interval 0.7438-0.9654; n = 30 items of judged_qa_30@1.0.0). This is accuracy on this benchmark, not accuracy on the population of real inputs (NIST AI 800-3).",
  ],
});
const judge = {
  code: "genai_judge_not_validated" as const,
  message: "The judge is not validated",
  criterionId: "acc",
  detail: "J1: kappa_lower_bound_below_floor",
};

async function evaluated(outcome: string, linked: GenaiReadiness[]) {
  const e = structuredEngagement({ artifacts: [artifact()] });
  await approveProgram(e);
  const seen: string[][] = [];
  const ctx = {
    ...context("auditor"),
    genaiReadiness: async (ids: string[]) => {
      seen.push(ids);
      return linked;
    },
  };
  await workflowCommand(e, "recordProcedureExecution", executionInput(e), ctx);
  await workflowCommand(
    e,
    "evaluateProcedure",
    { ...assessmentInput, outcome },
    ctx,
  );
  return { e, ctx, seen };
}

describe("submitProcedure with linked GenAI evidence", () => {
  it("refuses a supported or qualified conclusion while a result has blockers", async () => {
    for (const outcome of ["supported", "qualified"]) {
      const { e, ctx, seen } = await evaluated(outcome, [readiness([judge])]);
      await expectFailure(
        workflowCommand(e, "submitProcedure", { procedureId }, ctx),
        400,
        "The linked GenAI evidence cannot support this conclusion yet (genai_judge_not_validated); resolve the blockers or conclude not supported",
      );
      expect(seen).toEqual([["evidence"]]);
    }
  });

  it("accepts not_supported and lists the blockers as limitations", async () => {
    const { e, ctx } = await evaluated("not_supported", [readiness([judge])]);
    await workflowCommand(e, "submitProcedure", { procedureId }, ctx);
    const paper = e.papers.at(-1)!;
    expect(paper.body.conclusionStatus).toBe("not_supported");
    expect(paper.body.limitations).toBe(
      "GenAI gate (genai_judge_not_validated): The judge is not validated [criterion acc] (J1: kappa_lower_bound_below_floor)",
    );
    expect(paper.body.results).not.toContain("GenAI claim scope");
  });

  it("inserts the claim scope once the gate is clear", async () => {
    const { e, ctx } = await evaluated("supported", [readiness([])]);
    await workflowCommand(e, "submitProcedure", { procedureId }, ctx);
    const paper = e.papers.at(-1)!;
    expect(paper.body.conclusionStatus).toBe("supported");
    expect(paper.body.results).toContain(
      "GenAI claim scope:\naccuracy 0.9 (95% interval 0.7438-0.9654",
    );
    expect(paper.body.limitations).toBe("");
  });

  it("leaves procedures without GenAI results as they were", async () => {
    const { e, ctx } = await evaluated("supported", []);
    await workflowCommand(e, "submitProcedure", { procedureId }, ctx);
    expect(e.papers.at(-1)!.body.results).not.toContain("GenAI");
  });
});
