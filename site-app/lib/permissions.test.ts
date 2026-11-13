import { describe, expect, it } from "vitest";
import { commandModules, dispatch } from "@/lib/commands";
import { assuranceModules } from "@/lib/commands/assurance";
import { managementModules } from "@/lib/commands/management";
import { caller, stored } from "@/lib/commands/test-fixtures";
import { roles, type Engagement, type Finding, type Paper } from "@/lib/domain";
import { ApiError } from "@/lib/http";
import {
  assuranceActions,
  can,
  canAssignEngagementAccess,
  decisionState,
  manageState,
  managementReferrals,
  roleReason,
  workspaceActions,
  type Action,
} from "@/lib/permissions";
import {
  approvedWorkflow,
  context as workflowContext,
} from "@/lib/workflow/test-fixtures";
import {
  WorkflowError,
  workflowCommand,
  workflowOps,
} from "@/lib/workflow-service";

// The role refusals the server's guards answer with. Any other 403 is a
// check this test does not know: add its message here once it is a role
// check, so the probe keeps telling role refusals from other refusals.
const roleRefusals = new Set([
  "Your role cannot perform this action",
  "An Engagement Quality Reviewer reviews the engagement but cannot change its audit work",
  "An Auditor or Lead Auditor must record this audit work",
  "A Lead Auditor must authorize this decision",
  "An independent Reviewer or Lead Auditor must approve",
  "Only Auditors, Lead Auditors and Reviewers declare independence",
  "Only an Auditor or Lead Auditor can manage evidence requests",
  "A Lead Auditor must approve evidence limitations and scope changes",
  "A Lead Auditor must reopen a completed evidence request",
]);

/**
 * An engagement with an approved scope and program, so each workflow command
 * reaches its role check before it asks for missing state.
 */
function probed(): Engagement {
  const e = stored();
  e.workflow = approvedWorkflow();
  return e;
}

/** Whether the server refuses `role` the op for its role, given no data. */
async function refusedForRole(op: string, role: (typeof roles)[number]) {
  const outcome = await dispatch(probed(), op, {}, caller(role)).then(
    () => undefined,
    (error: unknown) => error,
  );
  if (outcome instanceof ApiError && outcome.status === 403) {
    expect(roleRefusals, `${op} as ${role}: ${outcome.message}`).toContain(
      outcome.message,
    );
    return true;
  }
  return false;
}

describe("client permissions match the server's role checks", () => {
  const workspaceOps = commandModules.flatMap((m) => m.ops);

  it("names every POST /api/workspace op once", () => {
    expect(
      new Set([...Object.keys(workspaceActions), ...managementReferrals]),
    ).toEqual(new Set(workspaceOps));
  });

  it("names every POST /api/assurance op once", () => {
    expect(new Set(Object.keys(assuranceActions))).toEqual(
      new Set(assuranceModules.flatMap((m) => m.ops)),
    );
  });

  it("matches each workspace op's declared roles", () => {
    for (const m of commandModules)
      for (const [op, declared] of Object.entries(m.roles ?? {})) {
        if ((managementReferrals as readonly string[]).includes(op)) continue;
        expect(
          [...workspaceActions[op as keyof typeof workspaceActions]].sort(),
          op,
        ).toEqual([...declared].sort());
      }
  });

  it("matches each assurance op's declared roles", () => {
    for (const m of assuranceModules)
      for (const [op, declared] of Object.entries(m.roles ?? {}))
        expect(
          [...assuranceActions[op as keyof typeof assuranceActions]].sort(),
          op,
        ).toEqual([...declared].sort());
  });

  // The workflow and evidence-request services check roles inside each
  // command, so the probe issues every op as every role and compares the
  // refusals with can().
  it("matches the role checks the workflow and evidence requests make themselves", async () => {
    const probed = commandModules.filter((m) => !m.roles).flatMap((m) => m.ops);
    expect(probed.length).toBeGreaterThan(40);
    const admitted: Record<string, string[]> = {},
      expected: Record<string, string[]> = {};
    for (const op of probed) {
      admitted[op] = [];
      for (const role of roles)
        if (!(await refusedForRole(op, role))) admitted[op].push(role);
      expected[op] = roles.filter((role) => can(role, op as Action));
    }
    expect(admitted).toEqual(expected);
  });

  // The route checks workflow roles from this map first (workflowRoleRefusal),
  // so the commands' own guards are probed without it: the map may refuse
  // nobody the guards admit, and may admit nobody they refuse. A few
  // commands validate their data before their guard, so a probe without data
  // cannot see their guard; the route's check covers them.
  it("agrees with the workflow commands' own guards", async () => {
    const dataFirst = new Set([
      "reaffirmExecution",
      "reviewProcedure",
      "returnProcedure",
      "closeMonitoringCase",
    ]);
    const asUser: Record<string, string> = {
      Auditor: "auditor",
      "Lead Auditor": "lead",
      Reviewer: "reviewer",
      "Engagement Quality Reviewer": "quality-reviewer",
      "Client Viewer": "viewer",
      "Client Contributor": "contributor",
    };
    const mismatches: string[] = [];
    for (const op of workflowOps)
      for (const role of roles) {
        const e = probed();
        const outcome = await workflowCommand(
          e,
          op,
          {},
          workflowContext(asUser[role]),
        ).then(
          () => undefined,
          (error: unknown) => error,
        );
        const refused =
          outcome instanceof WorkflowError &&
          outcome.status === 403 &&
          roleRefusals.has(outcome.message);
        const permitted = can(role, op as Action);
        if (refused && permitted)
          mismatches.push(`${op}: guard refuses ${role}`);
        // The workspace route refuses an Engagement Quality Reviewer every
        // op outside the quality review before the command runs.
        const routeRefuses = role === "Engagement Quality Reviewer";
        if (!refused && !permitted && !dataFirst.has(op) && !routeRefuses)
          mismatches.push(`${op}: guard admits ${role}`);
      }
    expect(mismatches).toEqual([]);
  });

  it("refuses the ops referred to management for every role that writes", async () => {
    for (const op of managementReferrals)
      for (const role of ["Auditor", "Lead Auditor", "Reviewer"] as const)
        await expect(
          dispatch(stored(), op, {}, caller(role)),
          `${op} as ${role}`,
        ).rejects.toMatchObject({
          status: 400,
          message: "Use client and user management for this action",
        });
  });

  // Client Viewers only read: POST /api/workspace and /api/assurance refuse
  // them every op before dispatching.
  it("gives a Client Viewer no action", () => {
    for (const op of [
      ...Object.keys(workspaceActions),
      ...Object.keys(assuranceActions),
    ] as Action[]) {
      expect(can("Client Viewer", op), op).toBe(false);
      expect(roleReason("Client Viewer", op)).toBe(
        "Client Viewers have read-only access",
      );
    }
  });

  it("leaves management to practice administration, with two Lead Auditor rules", () => {
    for (const m of managementModules)
      for (const [op, declared] of Object.entries(m.roles ?? {}))
        expect([...declared].sort(), op).toEqual([...roles].sort());
    expect(manageState({ role: "Lead Auditor" })).toEqual({
      allowed: false,
      reason: "Practice administration permission is required",
      refusal: "role",
    });
    expect(manageState({ role: "Reviewer", practiceAdmin: true })).toEqual({
      allowed: true,
    });
    expect(
      manageState(
        { role: "Auditor", practiceAdmin: true },
        "setQualityReviewPolicy",
      ).allowed,
    ).toBe(false);
    expect(
      canAssignEngagementAccess({ role: "Auditor", practiceAdmin: true }),
    ).toBe(false);
    expect(
      canAssignEngagementAccess({ role: "Lead Auditor", practiceAdmin: true }),
    ).toBe(true);
  });
});

describe("roleReason", () => {
  it("names the roles that may act", () => {
    expect(roleReason("Auditor", "signPaper")).toBe(
      "Only Lead Auditors can do this",
    );
    expect(roleReason("Auditor", "closeFinding")).toBe(
      "Only Reviewers or Lead Auditors can do this",
    );
    expect(roleReason("Engagement Quality Reviewer", "signPaper")).toBe(
      "An Engagement Quality Reviewer reviews the engagement but cannot change its audit work",
    );
    expect(roleReason("Reviewer", "comment")).toBeNull();
  });
});

describe("decisionState", () => {
  const paper = {
    authorId: "author",
    contributors: ["helper"],
    revision: 2,
    reviews: [{ userId: "reviewer", revision: 2, at: "" }],
  } as unknown as Paper;

  it("keeps the author and contributors from reviewing their paper", () => {
    for (const userId of ["author", "helper"])
      expect(
        decisionState("Lead Auditor", userId, { action: "reviewPaper", paper }),
      ).toEqual({
        allowed: false,
        reason: "The author cannot review their own paper",
        refusal: "independence",
      });
    expect(
      decisionState("Reviewer", "other", { action: "reviewPaper", paper }),
    ).toEqual({ allowed: true });
  });

  it("signs only on an independent review of the current revision", () => {
    expect(
      decisionState("Lead Auditor", "lead", { action: "signPaper", paper })
        .allowed,
    ).toBe(true);
    // The only review is the signer's own.
    expect(
      decisionState("Lead Auditor", "reviewer", { action: "signPaper", paper })
        .allowed,
    ).toBe(false);
    // The review is of an earlier revision.
    expect(
      decisionState("Lead Auditor", "lead", {
        action: "signPaper",
        paper: { ...paper, revision: 3 },
      }).allowed,
    ).toBe(false);
    expect(
      decisionState("Auditor", "lead", { action: "signPaper", paper }),
    ).toEqual({
      allowed: false,
      reason: "Only Lead Auditors can do this",
      refusal: "role",
    });
  });

  it("closes a finding only for someone who did not raise or remediate it", () => {
    const finding = {
      createdBy: "a",
      remediationBy: "b",
    } as unknown as Finding;
    for (const userId of ["a", "b"])
      expect(
        decisionState("Reviewer", userId, { action: "closeFinding", finding })
          .allowed,
      ).toBe(false);
    expect(
      decisionState("Reviewer", "c", { action: "closeFinding", finding })
        .allowed,
    ).toBe(true);
  });

  it("approves a classification only for someone other than its classifier", () => {
    const engagement = {
      classification: {
        history: [
          { action: "classified", by: "old", label: "", legalVersion: "" },
          { action: "classified", by: "me", label: "", legalVersion: "" },
        ],
      },
    } as unknown as Engagement;
    expect(
      decisionState("Reviewer", "me", {
        action: "approveClassification",
        engagement,
      }).allowed,
    ).toBe(false);
    expect(
      decisionState("Reviewer", "old", {
        action: "approveClassification",
        engagement,
      }).allowed,
    ).toBe(true);
  });
});
