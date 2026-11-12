import { describe, expect, it } from "vitest";
import type { Procedure } from "./workflow-types";
import { engagementWork, procedureWork } from "./work-items";
import { seedWorkflow } from "./workflow-seed";
import { approvedWorkflow, at, engagement } from "./workflow/test-fixtures";
import catalog from "./catalog.json";
import { classificationRules } from "./classification-rules";
import { migrateClassification } from "./domain/classification";
import type { Engagement, Role } from "./domain";
import { freshEngagement } from "./factories";
import { asRulePack } from "./rule-pack";
import { workKindLabels } from "./work-inbox";
import { resolveNew } from "./criteria/pin";

const today = "2026-11-05";
/** A selected, applicable, assigned and overdue procedure from the catalog. */
function planned(templateId: string, overrides: Partial<Procedure> = {}) {
  const p = seedWorkflow(resolveNew(), "lead", at).procedures.find(
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

describe("classification work (#104)", () => {
  const rules = classificationRules(asRulePack(catalog.regulatorySnapshot)!);
  const classificationTasks = (
    e: Engagement,
    role: Role,
    userId: string,
    on = today,
    r: typeof rules | null = rules,
  ) =>
    engagementWork(e, role, userId, "", on, { rules: r ?? undefined }).filter(
      (i) => i.kind === "classification" || i.kind === "report",
    );
  const migrated = () =>
    engagement({
      classification: migrateClassification(engagement().classification),
    });
  /** An approved classification under the rule pack served, for a provider. */
  function approved(overrides: Partial<Engagement["classification"]> = {}) {
    const c = freshEngagement(
      resolveNew(),
      "client",
      "E",
      "auditor",
    ).classification;
    return engagement({
      classification: {
        ...c,
        operatorRole: "Provider",
        annexRoute: "Outside high-risk scope",
        status: "approved",
        approvedBy: "reviewer",
        rulePackVersion: rules.rulePackVersion,
        guidance: rules.guidance,
        ...overrides,
      },
    });
  }

  it("gives no classification work on a pack without the AI Act classification", () => {
    const off = { features: { aiActClassification: false } };
    expect(
      engagementWork(migrated(), "Auditor", "auditor", "", today, off).filter(
        (i) => i.kind === "classification",
      ),
    ).toEqual([]);
    expect(
      engagementWork(
        approved({ rulePackVersion: "2000.1.1" }),
        "Auditor",
        "auditor",
        "",
        today,
        { rules, ...off },
      ).filter((i) => i.kind === "classification"),
    ).toEqual([]);
  });

  it("asks a migrated pre-#19 approval to be reclassified", () => {
    const e = migrated();
    const [task] = classificationTasks(e, "Auditor", "auditor");
    expect(task).toMatchObject({
      id: "ENG-1:classification:classification",
      action: "Reclassify the system",
      module: "Regulatory mapping",
      state: "ready",
      personal: true,
    });
    expect(task.reason).toContain("no longer stands");
    // A reviewer sees it waiting on the auditors; a client sees nothing.
    expect(classificationTasks(e, "Reviewer", "reviewer")[0]).toMatchObject({
      state: "waiting",
      personal: false,
    });
    expect(classificationTasks(e, "Client Viewer", "viewer")).toEqual([]);
  });

  it("drops the migration notice once the system is classified again", () => {
    const e = migrated();
    e.classification.history = [
      ...(e.classification.history ?? []),
      { action: "classified", label: "Minimal risk", legalVersion: "x" },
    ];
    expect(classificationTasks(e, "Auditor", "auditor")).toEqual([]);
  });

  it("asks for a final package captured before the migration to be captured again", () => {
    const e = migrated();
    e.reports = [
      {
        id: "R-1",
        kind: "final",
        createdAt: at,
        actor: "lead",
        sha256: "0".repeat(64),
        snapshot: {
          workflow: null,
          engagement: { id: e.id, classification: engagement().classification },
        },
      },
    ];
    const report = classificationTasks(e, "Lead Auditor", "lead").find(
      (i) => i.kind === "report",
    );
    expect(report).toMatchObject({
      recordId: "R-1",
      action: "Capture the package again",
      personal: true,
    });
    expect(
      classificationTasks(e, "Reviewer", "reviewer").find(
        (i) => i.kind === "report",
      ),
    ).toMatchObject({ action: "View package dependency", personal: false });
  });

  it("drops the recapture item once a new final package is captured", () => {
    const e = migrated();
    const pkg = (id: string, createdAt: string, classification: unknown) => ({
      id,
      kind: "final" as const,
      createdAt,
      actor: "lead",
      sha256: "0".repeat(64),
      snapshot: {
        workflow: null,
        engagement: { id: e.id, classification },
      },
    });
    e.reports = [
      pkg("R-1", at, engagement().classification),
      pkg(
        "R-2",
        "2026-11-06T10:00:00.000Z",
        freshEngagement(resolveNew(), "client", "E", "auditor").classification,
      ),
    ];
    const reports = classificationTasks(e, "Lead Auditor", "lead").filter(
      (i) => i.kind === "report",
    );
    // R-1 is retired by R-2; only R-2 is open for approval.
    expect(reports.map((i) => i.recordId)).toEqual(["R-2"]);
    expect(reports[0].action).not.toBe("Capture the package again");
  });

  it("turns a due re-review trigger into a work item", () => {
    // A new rule pack is due at once.
    const stale = approved({ rulePackVersion: "2026.10.1" });
    const [task] = classificationTasks(stale, "Lead Auditor", "lead");
    expect(task).toMatchObject({
      action: "Re-review classification",
      module: "Regulatory mapping",
      dueDate: "",
      state: "ready",
      personal: true,
    });
    expect(task.reason).toContain("New rule pack " + rules.rulePackVersion);
    // Scheduled and watched triggers are not work yet.
    expect(classificationTasks(approved(), "Lead Auditor", "lead")).toEqual([]);
    // The Code review date makes it due for a provider.
    expect(
      classificationTasks(approved(), "Lead Auditor", "lead", "2028-06-10")[0]
        ?.reason,
    ).toContain("Code of Practice");
    // Re-approving after the date clears it; the next date brings it back.
    const reapproved = approved({ approvedAt: "2028-06-11T09:00:00.000Z" });
    expect(
      classificationTasks(reapproved, "Lead Auditor", "lead", "2028-06-12"),
    ).toEqual([]);
    // Without the rules (no catalog) no trigger is evaluated.
    expect(
      classificationTasks(stale, "Lead Auditor", "lead", today, null),
    ).toEqual([]);
    // A provisional classification has nothing to re-review.
    expect(
      classificationTasks(
        approved({ rulePackVersion: "2026.10.1", status: "provisional" }),
        "Lead Auditor",
        "lead",
      ),
    ).toEqual([]);
  });

  it("clears the interoperability re-review once the classification is approved again", () => {
    const before = approved({ approvedAt: "2027-01-15T09:00:00.000Z" });
    const [task] = classificationTasks(
      before,
      "Lead Auditor",
      "lead",
      "2027-03-02",
    );
    expect(task?.reason).toContain("Interoperable watermark detection");
    // Re-approved on 1 March 2027, after the 2 February milestone.
    const after = approved({
      approvedAt: "2027-03-01T09:00:00.000Z",
      history: [
        {
          action: "approved",
          at: "2027-03-01T09:00:00.000Z",
          by: "reviewer",
          label: "Minimal risk",
          legalVersion: "x",
        },
      ],
    });
    expect(
      classificationTasks(after, "Lead Auditor", "lead", "2027-03-02"),
    ).toEqual([]);
  });

  it("labels the new kind for the inbox filter", () => {
    expect(workKindLabels.classification).toBe("Classification");
  });
});
