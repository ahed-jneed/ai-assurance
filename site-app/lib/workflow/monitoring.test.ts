import { describe, expect, it } from "vitest";
import type { Engagement } from "../domain/types";
import {
  approvedWorkflow,
  artifact,
  command,
  engagement,
  expectFailure,
} from "./test-fixtures";

async function openCase() {
  const e = engagement({
    workflow: approvedWorkflow(),
    artifacts: [artifact()],
  });
  const { caseId } = await command(
    e,
    "createMonitoringCase",
    {
      kind: "change",
      title: "Model version change",
      description: "A new model version needs an impact decision",
      ownerId: "auditor",
      dueDate: "2026-12-31",
      cadence: "one_off",
      findingId: "",
      reportId: "",
    },
    "auditor",
  );
  return { e, caseId };
}
const assess = (
  e: Engagement,
  caseId: string,
  decision: string,
  evidenceIds: string[],
) =>
  command(
    e,
    "assessMonitoringCase",
    {
      caseId,
      decision,
      assessment: "Impact assessed against the baseline scope",
      evidenceIds,
      dueDate: "2026-12-31",
    },
    "auditor",
  );
const close = (e: Engagement, caseId: string) =>
  command(
    e,
    "closeMonitoringCase",
    { caseId, closure: "Independently reviewed closure" },
    "reviewer",
  );
const stateOf = (e: Engagement, caseId: string) =>
  e.workflow!.monitoring.find((m) => m.id === caseId)!.state;

describe("follow-up case evidence", () => {
  it("needs evidence to decide that no reassessment is needed", async () => {
    const { e, caseId } = await openCase();
    await expectFailure(
      assess(e, caseId, "no_reassessment", []),
      400,
      "Link the accepted evidence that shows no reassessment is needed",
    );
    await assess(e, caseId, "no_reassessment", ["evidence"]);
    await close(e, caseId);
    expect(stateOf(e, caseId)).toBe("closed");
  });

  it("closes a follow-up once a later assessment links its evidence", async () => {
    const { e, caseId } = await openCase();
    await assess(e, caseId, "follow_up", []);
    await expectFailure(
      close(e, caseId),
      400,
      "Record an assessment with the accepted evidence before independent closure",
    );
    await assess(e, caseId, "follow_up", ["evidence"]);
    await close(e, caseId);
    expect(stateOf(e, caseId)).toBe("closed");
  });

  it("closes a reassessment without evidence once its successor is open", async () => {
    const { e, caseId } = await openCase();
    await assess(e, caseId, "reassessment_required", []);
    await expectFailure(
      close(e, caseId),
      400,
      "Open a successor engagement before closing the reassessment case",
    );
    e.workflow!.monitoring[0].successorEngagementId = "ENG-successor";
    await close(e, caseId);
    expect(stateOf(e, caseId)).toBe("closed");
  });

  it("still needs linked evidence to be accepted", async () => {
    const { e, caseId } = await openCase();
    await assess(e, caseId, "follow_up", ["evidence"]);
    e.artifacts[0].status = "quarantined";
    await expectFailure(
      close(e, caseId),
      400,
      "Link accepted evidence from this engagement",
    );
  });
});
