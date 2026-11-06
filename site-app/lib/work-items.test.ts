import { describe, expect, it } from "vitest";
import type { Procedure } from "./workflow-types";
import { engagementWork, procedureWork } from "./work-items";
import { seedWorkflow } from "./workflow-seed";
import { approvedWorkflow, at, engagement } from "./workflow/test-fixtures";

const today = "2026-11-05";
/** A selected, applicable, assigned and overdue procedure from the catalog. */
function planned(templateId: string, overrides: Partial<Procedure> = {}) {
  const p = seedWorkflow("lead", at).procedures.find(
    (p) => p.templateId === templateId,
  );
  if (!p) throw new Error("Unknown template " + templateId);
  return {
    ...p,
    selected: true,
    applicability: "applicable" as const,
    ownerId: "auditor",
    reviewerId: "reviewer",
    dueDate: "2026-11-01",
    ...overrides,
  };
}
const withProcedures = (...procedures: Procedure[]) =>
  engagement({ workflow: approvedWorkflow(procedures) });
const procedureTasks = (
  e: ReturnType<typeof withProcedures>,
  role: "Auditor" | "Lead Auditor",
  userId: string,
) =>
  engagementWork(e, role, userId, "", today).filter(
    (i) => i.kind === "procedure",
  );

describe("release-time records in the work inbox", () => {
  // MEM-SO-01 is a memo, so only WP-RP-02 has a procedure.
  it("gives an approved, overdue WP-RP-02 procedure no execution task", () => {
    const e = withProcedures(planned("WP-RP-02"));
    expect(procedureTasks(e, "Auditor", "auditor")).toEqual([]);
    expect(procedureTasks(e, "Lead Auditor", "lead")).toEqual([]);
    const x = procedureWork(e, "PROC-WP-RP-02", today)!;
    expect(x.releaseTime).toBe(true);
    expect(x.overdue).toBe(false);
    expect(x.waiting).toBe(false);
    expect(x.readyToEvaluate).toBe(false);
    expect(x.corrections).toBe(false);
  });

  it("still asks for the assignment program submission requires", () => {
    const e = withProcedures(planned("WP-RP-02", { reviewerId: "" }));
    expect(
      procedureTasks(e, "Lead Auditor", "lead").map((i) => i.action),
    ).toEqual(["Complete procedure plan"]);
  });

  it("keeps the execution task for an ordinary overdue procedure", () => {
    const e = withProcedures(planned("WP-RP-01"));
    const [task] = procedureTasks(e, "Auditor", "auditor");
    expect(task).toMatchObject({
      action: "Record work performed",
      state: "ready",
      priority: 0,
      personal: true,
    });
    expect(procedureWork(e, "PROC-WP-RP-01", today)!.overdue).toBe(true);
  });
});
