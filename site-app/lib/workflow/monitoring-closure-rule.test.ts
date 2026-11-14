// closeMonitoringCase applies the shared closure rule (#216): it refuses with
// whatever monitoringClosureRefusal answers, as releaseReport does with
// releaseRefusal, so the workspace and the server cannot drift apart. The
// "already closed" refusal (#209) still comes first.
import { describe, expect, it, vi } from "vitest";
import type { MonitoringCase } from "../workflow-types";
import {
  approvedWorkflow,
  artifact,
  at,
  command,
  engagement,
  expectFailure,
} from "./test-fixtures";

const rule = vi.hoisted(() => ({
  refusal: vi.fn((): { status: 400 | 409; message: string } | null => ({
    status: 409,
    message: "Refused by the shared closure rule",
  })),
}));
vi.mock("../preconditions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../preconditions")>()),
  monitoringClosureRefusal: rule.refusal,
}));

function withCase(overrides: Partial<MonitoringCase> = {}) {
  const e = engagement({
    workflow: approvedWorkflow(),
    artifacts: [artifact()],
  });
  e.workflow!.monitoring = [
    {
      id: "CASE-1",
      kind: "monitoring",
      title: "Quarterly drift review",
      description: "Compare live error rates with the audited baseline",
      ownerId: "auditor",
      dueDate: "2026-12-31",
      cadence: "quarterly",
      findingId: "",
      reportId: "",
      state: "in_progress",
      decision: "no_reassessment",
      assessment: "No drift",
      evidenceIds: ["evidence"],
      contributors: ["auditor"],
      createdBy: "auditor",
      createdAt: at,
      updatedAt: at,
      history: [],
      ...overrides,
    } as MonitoringCase,
  ];
  return e;
}
const close = (e: ReturnType<typeof withCase>) =>
  command(
    e,
    "closeMonitoringCase",
    { caseId: "CASE-1", closure: "Independently reviewed closure" },
    "reviewer",
  );

describe("closeMonitoringCase and the shared closure rule", () => {
  it("refuses with the shared rule's status and message", async () => {
    rule.refusal.mockClear();
    const e = withCase();
    await expectFailure(close(e), 409, "Refused by the shared closure rule");
    expect(rule.refusal).toHaveBeenCalledWith(e, e.workflow!.monitoring[0]);
    expect(e.workflow!.monitoring[0].state).toBe("in_progress");
  });

  it("closes the case when the shared rule allows it", async () => {
    rule.refusal.mockReturnValueOnce(null);
    const e = withCase();
    await close(e);
    expect(e.workflow!.monitoring[0].state).toBe("closed");
  });

  it("refuses a closed case as already closed before the rule runs", async () => {
    rule.refusal.mockClear();
    const e = withCase({ state: "closed" });
    await expectFailure(
      close(e),
      409,
      "This case is already closed. Create a new case for subsequent work",
    );
    expect(rule.refusal).not.toHaveBeenCalled();
  });
});
