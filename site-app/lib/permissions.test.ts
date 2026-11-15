import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commandModules, dispatch } from "@/lib/commands";
import { assuranceModules } from "@/lib/commands/assurance";
import { managementModules } from "@/lib/commands/management";
import { caller, stored } from "@/lib/commands/test-fixtures";
import {
  roles,
  type Engagement,
  type Finding,
  type Paper,
  type Report,
} from "@/lib/domain/types";
import { qualityReviewerRole } from "@/lib/domain/quality-review";
import { ApiError } from "@/lib/http";
import {
  assignableRoles,
  assuranceActions,
  can,
  canAssignEngagementAccess,
  canBeAssigned,
  canQueueAuditorModel,
  canSee,
  canSeeAccessLog,
  decisionState,
  duties,
  fallbackRole,
  isClientRole,
  isInternalRole,
  manageState,
  managementReferrals,
  narrowedActions,
  roleReason,
  viewAccess,
  workspaceActions,
  type Action,
  type Assignment,
  type NarrowedAction,
} from "@/lib/permissions";
import {
  acceptanceInput,
  approvedWorkflow,
  briefInput,
  planSave,
  structuredEngagement,
  workflowOf,
  context as workflowContext,
} from "@/lib/workflow/test-fixtures";
import { WorkflowError } from "@/lib/workflow/command";
import { workflowCommand, workflowOps } from "@/lib/workflow/dispatch";

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
 * An engagement with an approved scope, so each workflow command reaches its
 * role check before it asks for missing state. Its program is a draft:
 * planning a draft program is the engagement team's, while changing a
 * submitted or approved one needs a Lead Auditor (see the narrowing test).
 */
function probed(): Engagement {
  const e = stored();
  e.workflow = approvedWorkflow();
  e.workflow.program.status = "draft";
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

  // The map holds each op's base role check. Some commands narrow it by
  // state: changing the plans of a submitted or approved program, like
  // saving an approved scope, needs a Lead Auditor. decisionState explains
  // the narrowing (#178); the commands still enforce it.
  it("narrows by state exactly where the commands do", async () => {
    const payloads: Record<NarrowedAction, (e: Engagement) => unknown> = {
      saveBrief: () => ({ ...briefInput, changeImpact: "Period extended" }),
      saveAcceptance: () => ({
        ...acceptanceInput,
        changeReason: "Engagement letter renewed",
      }),
      saveProcedurePlan: (e) => planSave(e),
      bulkPlanProcedures: () => ({}),
      scopeProgramCandidates: () => ({}),
    };
    expect(Object.keys(payloads).sort()).toEqual([...narrowedActions].sort());
    const asUser = { Auditor: "auditor", "Lead Auditor": "lead" } as const;
    const outcomes: string[] = [],
      expected: string[] = [];
    // A draft engagement; one whose scope and acceptance are approved and
    // whose program is submitted; and one whose program is approved too.
    for (const program of ["draft", "submitted", "approved"] as const)
      for (const action of narrowedActions)
        for (const role of ["Auditor", "Lead Auditor"] as const) {
          const e = structuredEngagement();
          if (program !== "draft") {
            e.workflow = approvedWorkflow(workflowOf(e).procedures);
            e.workflow.program.status = program;
          }
          const state = decisionState(role, asUser[role], {
            action,
            engagement: e,
          });
          const outcome = await workflowCommand(
            e,
            action,
            payloads[action](e),
            workflowContext(asUser[role]),
          ).then(
            () => undefined,
            (error: unknown) => error,
          );
          const narrowed =
            outcome instanceof WorkflowError &&
            outcome.status === 403 &&
            outcome.message === "A Lead Auditor must authorize this decision";
          const label = `${action} as ${role} (${program} program)`;
          outcomes.push(label + (narrowed ? ": Lead required" : ": open"));
          expected.push(
            label + (state.refusal === "state" ? ": Lead required" : ": open"),
          );
          if (state.refusal === "state") expect(state.reason).toMatch(/Lead/);
        }
    expect(outcomes).toEqual(expected);
    // An Auditor meets the narrowing on each approved record, and on the
    // plans and scope of a program once it is submitted.
    expect(outcomes.filter((o) => o.endsWith("Lead required")).sort()).toEqual(
      ["submitted", "approved"]
        .flatMap((program) =>
          narrowedActions.map(
            (action) =>
              `${action} as Auditor (${program} program): Lead required`,
          ),
        )
        .sort(),
    );
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

describe("canSee", () => {
  it("shows the team's work to a Lead Auditor only", () => {
    expect(roles.filter((role) => canSee(role, "teamWork"))).toEqual([
      "Lead Auditor",
    ]);
  });

  it("shows evidence requests to the practice's staff, never to client roles", () => {
    for (const role of roles)
      expect(canSee(role, "evidenceRequests"), role).toBe(!isClientRole(role));
  });

  it("shows the client portal to a Client Contributor only", () => {
    expect(roles.filter((role) => canSee(role, "clientPortal"))).toEqual([
      "Client Contributor",
    ]);
  });

  it("shows shared findings in the client portal to a Client Viewer only", () => {
    expect(roles.filter((role) => canSee(role, "clientFindings"))).toEqual([
      "Client Viewer",
    ]);
  });

  it("shows the Access log to practice administrators of a staff role only", () => {
    // The role/admin matrix (#181): a role alone, a Lead Auditor's included,
    // never admits it; administration admits every staff role and no client.
    for (const role of roles) {
      expect(canSeeAccessLog({ role }), role).toBe(false);
      expect(canSeeAccessLog({ role, practiceAdmin: false }), role).toBe(false);
      expect(canSeeAccessLog({ role, practiceAdmin: true }), role).toBe(
        !isClientRole(role),
      );
    }
  });

  it("names only known roles", () => {
    for (const [view, admitted] of Object.entries(viewAccess))
      for (const role of admitted) expect(roles, view).toContain(role);
  });
});

describe("role groups", () => {
  it("splits every role into the practice's staff or a client", () => {
    for (const role of roles)
      expect(isClientRole(role), role).toBe(!isInternalRole(role));
    expect(roles.filter(isClientRole)).toEqual([
      "Client Viewer",
      "Client Contributor",
    ]);
  });

  it("assumes the least privileged role before the identity loads", () => {
    expect(isClientRole(fallbackRole)).toBe(true);
    for (const op of Object.keys(workspaceActions) as Action[])
      expect(can(fallbackRole, op), op).toBe(false);
  });

  it("groups duties by the action map's base roles", () => {
    for (const role of roles) {
      const duty = duties(role);
      expect(duty.prepare, role).toBe(can(role, "submitProcedure"));
      expect(duty.review, role).toBe(can(role, "reviewProcedure"));
      expect(duty.authorize, role).toBe(can(role, "releaseReport"));
      expect(duty.qualityReview, role).toBe(can(role, "signOffQualityReview"));
    }
  });
});

describe("assignments and mode narrowings match the server's checks", () => {
  const server = (path: string) =>
    readFileSync(new URL("./" + path, import.meta.url), "utf8");
  const sorted = (list: readonly string[]) => [...list].sort();
  /** The role lists each `authorized(<assignee>, [...])` call checks. */
  function assigneeChecks(path: string) {
    return [
      ...server(path).matchAll(/authorized\(\s*([^,]+),\s*\[([^\]]+)\]/g),
    ].map(([, assignee, list]) => ({
      assignee,
      roles: sorted(list.split(",").map((r) => JSON.parse(r.trim()))),
    }));
  }

  it("offers each picker exactly the members the commands accept", () => {
    const found: Record<string, string[][]> = {};
    const add = (assignment: Assignment, roles: string[]) =>
      (found[assignment] ??= []).push(roles);
    for (const { assignee, roles } of [
      ...assigneeChecks("workflow/brief-program.ts"),
      ...assigneeChecks("workflow/monitoring.ts"),
    ])
      add(/review/i.test(assignee) ? "reviewer" : "preparer", roles);
    for (const { roles } of assigneeChecks("workflow/acceptance-commands.ts"))
      add("team", roles);
    for (const { roles } of assigneeChecks("workflow/client-grants.ts"))
      add("clientRequest", roles);
    const access = server("commands/assurance/access.ts").match(
      /role IN \(([^)]+)\)/,
    );
    add(
      "engagementAccess",
      sorted(access![1].split(",").map((r) => r.trim().slice(1, -1))),
    );
    // appointQualityReviewer asks the permission map itself, the rule the
    // browser's picker uses (behavioural parity in quality-review.test.ts).
    expect(server("commands/quality-review.ts")).toMatch(
      /!canBeAssigned\(member\.role, "qualityReviewer"\)/,
    );
    add("qualityReviewer", [qualityReviewerRole]);
    expect(Object.keys(found).sort()).toEqual(
      Object.keys(assignableRoles).sort(),
    );
    for (const [assignment, checks] of Object.entries(found))
      for (const roles of checks)
        expect(roles, assignment).toEqual(
          sorted(assignableRoles[assignment as Assignment]),
        );
    for (const role of roles)
      expect(canBeAssigned(role, "preparer"), role).toBe(
        assignableRoles.preparer.includes(role),
      );
  });

  it("narrows the auditor_model mode as queueExternal does", () => {
    const narrowed = server("commands/assurance/execution.ts").match(
      /v\.mode === "auditor_model"\) \{\s*requireRole\(ctx, \[([^\]]+)\]\)/,
    );
    expect(narrowed, "the auditor_model role check").not.toBeNull();
    const admitted = narrowed![1].split(",").map((r) => JSON.parse(r.trim()));
    expect(roles.filter(canQueueAuditorModel)).toEqual(
      roles.filter(
        (role) => admitted.includes(role) && can(role, "queueExternal"),
      ),
    );
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

  it("names the closer's independence once the retest is effective (#241)", () => {
    const finding = { createdBy: "a", remediationBy: "b" } as Finding;
    const reason = (f: Finding) =>
      decisionState("Reviewer", "b", { action: "closeFinding", finding: f })
        .reason;
    expect(reason(finding)).toBe("Independent retest confirmation is required");
    expect(
      reason({ ...finding, retest: { conclusion: "effective" } } as Finding),
    ).toBe("The finding's creator or remediator cannot close it");
  });

  it("approves a report package only for someone other than its creator (#226)", () => {
    const report = { actor: "creator" } as unknown as Report;
    expect(
      decisionState("Reviewer", "creator", {
        action: "approveReportPackage",
        report,
      }),
    ).toEqual({
      allowed: false,
      reason: "The report creator cannot approve its package",
      refusal: "independence",
    });
    expect(
      decisionState("Lead Auditor", "other", {
        action: "approveReportPackage",
        report,
      }),
    ).toEqual({ allowed: true });
    expect(
      decisionState("Auditor", "other", {
        action: "approveReportPackage",
        report,
      }).refusal,
    ).toBe("role");
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
