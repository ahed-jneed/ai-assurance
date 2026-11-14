// Who may do what (F-74): the roles each engagement and assurance action
// admits, in one place for the workspace's affordances. The server keeps its
// guards with each command (defineCommands roles, and the workflow and
// evidence-request services' own checks); lib/permissions.test.ts compares
// this map with every one of them, so a button is shown exactly to the roles
// the server lets through, and hidden or disabled with the server's reason
// for everyone else.
import type { Engagement, Finding, Paper, Role } from "./domain";
import { qualityReviewerOps } from "./domain/quality-review";

const writers: readonly Role[] = ["Auditor", "Lead Auditor"],
  reviewers: readonly Role[] = ["Reviewer", "Lead Auditor"],
  lead: readonly Role[] = ["Lead Auditor"],
  internal: readonly Role[] = ["Auditor", "Lead Auditor", "Reviewer"],
  qualityReviewer: readonly Role[] = ["Engagement Quality Reviewer"],
  clientContributor: readonly Role[] = ["Client Contributor"],
  clientViewer: readonly Role[] = ["Client Viewer"],
  clientRoles: readonly Role[] = ["Client Viewer", "Client Contributor"],
  staff: readonly Role[] = [
    "Auditor",
    "Lead Auditor",
    "Reviewer",
    "Engagement Quality Reviewer",
  ];

/** POST /api/workspace: the roles each op admits. */
export const workspaceActions = {
  // Workflow (lib/workflow/**): scope, program and acceptance.
  adoptWorkflow: lead,
  saveBrief: writers,
  submitBrief: writers,
  approveBrief: reviewers,
  returnBrief: reviewers,
  saveProcedurePlan: writers,
  bulkPlanProcedures: writers,
  publishClientClarification: writers,
  acknowledgeClientSubmission: writers,
  scopeProgramCandidates: writers,
  submitProgram: writers,
  approveProgram: reviewers,
  returnProgram: reviewers,
  ensureProcedurePaper: writers,
  recordProcedureExecution: writers,
  evaluateProcedure: writers,
  reaffirmExecution: reviewers,
  submitProcedure: writers,
  reviewProcedure: reviewers,
  returnProcedure: reviewers,
  grantClientRequest: lead,
  updateClientRequest: lead,
  revokeClientRequest: lead,
  approveReportPackage: reviewers,
  releaseReport: lead,
  withdrawReport: lead,
  createMonitoringCase: writers,
  assessMonitoringCase: writers,
  closeMonitoringCase: reviewers,
  linkFindingSupport: writers,
  recordFindingRetest: reviewers,
  reopenFinding: lead,
  saveAcceptance: writers,
  approveAcceptance: lead,
  saveDeclaration: internal,
  resolveDeclaredThreat: reviewers,
  withdrawDeclaredExclusion: reviewers,
  // Evidence requests (lib/evidence-requests.ts).
  createEvidenceRequest: writers,
  updateEvidenceRequest: writers,
  recordEvidenceResponse: writers,
  assessEvidenceRequest: writers,
  closeEvidenceRequest: lead,
  reopenEvidenceRequest: lead,
  // Engagement, papers, classification and findings.
  renameEngagement: writers,
  setStage: lead,
  acceptEvidence: writers,
  openFollowup: lead,
  pinCriteria: writers,
  unpinCriteria: writers,
  createPaper: writers,
  editPaper: writers,
  reopenPaper: lead,
  submitPaper: writers,
  reviewPaper: reviewers,
  signPaper: lead,
  comment: internal,
  respondComment: writers,
  resolveComment: internal,
  classify: writers,
  approveClassification: reviewers,
  createFinding: writers,
  updateFinding: writers,
  setFindingCriteria: writers,
  closeFinding: reviewers,
  // Management system (ISO/IEC 42001 packs).
  recordSoaEntry: writers,
  reviewSoa: reviewers,
  gradeNonconformity: writers,
  recordCorrectiveAction: writers,
  acceptCorrectiveAction: reviewers,
  // Testing lab and statistics.
  createModel: writers,
  createEvaluationProfile: writers,
  queueRun: writers,
  retryRun: writers,
  executeRun: writers,
  recoverRun: lead,
  cancelRun: writers,
  computeLl144Audit: writers,
  approveLl144Audit: reviewers,
  recordSpecialCategoryBasis: writers,
  pinClientDataset: writers,
  // Reports and the engagement quality review.
  createReport: lead,
  setPaperAudience: lead,
  appointQualityReviewer: lead,
  saveQualityReview: qualityReviewer,
  signOffQualityReview: qualityReviewer,
} as const satisfies Record<string, readonly Role[]>;

/** POST /api/assurance: the roles each op admits. */
export const assuranceActions = {
  setAccess: lead,
  enrollWorker: lead,
  revokeWorker: lead,
  registerSystem: writers,
  registerDataset: writers,
  registerPrediction: writers,
  addLocation: writers,
  importPacket: writers,
  sample: writers,
  addAssertion: writers,
  reviewAssertion: reviewers,
  obligationDecision: writers,
  reviewObligation: reviewers,
  impact: writers,
  reviewImpact: reviewers,
  exportBriefing: writers,
  importBriefing: writers,
  assist: writers,
  acceptAssistant: writers,
  queueExternal: writers,
  cancelJob: writers,
  importJob: writers,
  freezeGenaiPlan: writers,
  declareGenaiBundle: writers,
  queueGenaiIngest: writers,
  compileGenaiResult: writers,
  importGenaiEnvelope: writers,
  acknowledgeGenaiFlag: reviewers,
  attestGenaiRerun: writers,
} as const satisfies Record<string, readonly Role[]>;

/** Actions of routes outside the command buses, which guard with rolesFor(). */
export const routeActions = {
  /** POST /api/dossier: seal a portable audit dossier. */
  sealDossier: lead,
} as const satisfies Record<string, readonly Role[]>;

/**
 * Workspace ops every role is referred elsewhere for: POST /api/workspace
 * answers them with "Use client and user management for this action".
 */
export const managementReferrals = [
  "createClient",
  "createEngagement",
  "grantMember",
] as const;

export type WorkspaceAction = keyof typeof workspaceActions;
export type AssuranceAction = keyof typeof assuranceActions;
export type RouteAction = keyof typeof routeActions;
export type Action = WorkspaceAction | AssuranceAction | RouteAction;

const actions: Record<Action, readonly Role[]> = {
  ...workspaceActions,
  ...assuranceActions,
  ...routeActions,
};

/**
 * Views and parts of views each role may see, beside the actions above. They
 * decide what the workspace offers and which links and saved queries it
 * keeps (app/workspace/use-url-state.ts, app/work-inbox.tsx): the server
 * still decides what each read returns.
 */
export const viewAccess = {
  /** The team scope of My work: every assignment of the engagement team. */
  teamWork: lead,
  /**
   * The evidence requests tab of the Evidence vault, its review queue and
   * its links.
   */
  evidenceRequests: staff,
  /**
   * The client portal (evidence requests granted to the client) on the
   * Overview and the Evidence vault.
   */
  clientPortal: clientContributor,
  /**
   * The shared findings of the client portal (#36): the server's client
   * projection gives a Client Contributor none (lib/client-projection.ts).
   */
  clientFindings: clientViewer,
} as const satisfies Record<string, readonly Role[]>;

export type View = keyof typeof viewAccess;

/** Whether `role` may see `view`. */
export function canSee(role: Role | string, view: View) {
  return (viewAccess[view] as readonly string[]).includes(role);
}

/**
 * The role the workspace assumes before it knows the caller's: the one that
 * may see and do the least.
 */
export const fallbackRole: Role = "Client Viewer";

/**
 * Whether `role` is a client's (Client Viewer or Client Contributor): the
 * workspace shows them the client summary of an engagement instead of its
 * audit work, and the server answers their reads with the client projection
 * (lib/client-projection.ts).
 */
export function isClientRole(role: Role | string) {
  return (clientRoles as readonly string[]).includes(role);
}

/** Whether `role` is one of the practice's engagement staff. */
export function isInternalRole(role: Role | string) {
  return (staff as readonly string[]).includes(role);
}

/**
 * Who may be assigned to work or given access, as the server checks each
 * assignee (lib/workflow/brief-program.ts, monitoring.ts,
 * acceptance-commands.ts, client-grants.ts and
 * lib/commands/assurance/access.ts): the member
 * pickers offer exactly these members.
 */
export const assignableRoles = {
  /** A procedure's preparer, or the owner of a follow-up case. */
  preparer: writers,
  /** A procedure's independent reviewer. */
  reviewer: reviewers,
  /** A member of the engagement team in the acceptance record. */
  team: internal,
  /** An internal member a Lead Auditor grants engagement access (setAccess). */
  engagementAccess: internal,
  /** A client member granted one evidence request (grantClientRequest). */
  clientRequest: clientContributor,
} as const satisfies Record<string, readonly Role[]>;

export type Assignment = keyof typeof assignableRoles;

/** Whether a member in `role` may be assigned as `assignment`. */
export function canBeAssigned(role: Role | string, assignment: Assignment) {
  return (assignableRoles[assignment] as readonly string[]).includes(role);
}

/**
 * The base duties the action map is built from, for code that groups work by
 * who does it (lib/work-items.ts): preparing audit work, reviewing it
 * independently, authorizing it as Lead Auditor, and the engagement quality
 * review, which is an Engagement Quality Reviewer's only work.
 */
export function duties(role: Role | string) {
  const has = (roles: readonly Role[]) =>
    (roles as readonly string[]).includes(role);
  return {
    prepare: has(writers),
    review: has(reviewers),
    authorize: has(lead),
    qualityReview: has(qualityReviewer),
  };
}

/**
 * Whether `role` may queue an external job in the auditor_model mode:
 * queueExternal admits writers, and lib/commands/assurance/execution.ts
 * narrows that mode to a Lead Auditor.
 */
export function canQueueAuditorModel(role: Role | string) {
  return (lead as readonly string[]).includes(role);
}

/** The roles that may take `action`. */
export function rolesFor(action: Action): readonly Role[] {
  return actions[action];
}

/** Whether `role` may take `action`, as the server's role checks decide. */
export function can(role: Role, action: Action) {
  return actions[action].includes(role);
}

// The refusals of the workflow's own guards (lib/workflow/command.ts and
// saveDeclaration), by the roles a command admits.
const workflowRefusals = new Map<readonly Role[], string>([
  [writers, "An Auditor or Lead Auditor must record this audit work"],
  [lead, "A Lead Auditor must authorize this decision"],
  [reviewers, "An independent Reviewer or Lead Auditor must approve"],
  [internal, "Only Auditors, Lead Auditors and Reviewers declare independence"],
]);

/**
 * The role refusal of workflow command `op` for `role`, or null when it may
 * issue it. POST /api/workspace checks it before the command validates its
 * data; the command's own guard then repeats the check with the same
 * message.
 */
export function workflowRoleRefusal(role: Role, op: string): string | null {
  if (!Object.hasOwn(workspaceActions, op)) return null;
  const admitted = workspaceActions[op as WorkspaceAction];
  if (admitted.includes(role)) return null;
  return workflowRefusals.get(admitted) ?? null;
}

function list(roles: readonly Role[]) {
  const names = roles.map((r) => r + "s");
  return names.length > 1
    ? names.slice(0, -1).join(", ") + " or " + names.at(-1)
    : names[0];
}

/**
 * Why `role` may not take `action`, or null when it may: the sentence a
 * disabled control shows. It names the roles that can, so the person knows
 * whom to ask.
 */
export function roleReason(role: Role, action: Action): string | null {
  if (can(role, action)) return null;
  if (role === "Client Viewer") return "Client Viewers have read-only access";
  if (
    role === "Engagement Quality Reviewer" &&
    !qualityReviewerOps.includes(action)
  )
    return "An Engagement Quality Reviewer reviews the engagement but cannot change its audit work";
  return "Only " + list(actions[action]) + " can do this";
}

/** Whether a decision is open to this person, and if not, why. */
export type ActionState = {
  allowed: boolean;
  reason?: string;
  /**
   * Why it is refused: the person's role never may (the control is hidden),
   * this record's independence rule bars them, or the record's state narrows
   * the action to fewer roles (both are shown disabled with the reason, so
   * they know whom to ask).
   */
  refusal?: "role" | "independence" | "state";
};
const allowed: ActionState = { allowed: true };
function refused(
  reason: string,
  refusal: ActionState["refusal"] = "independence",
): ActionState {
  return { allowed: false, reason, refusal };
}

/** The role check alone, for an action without an independence rule. */
export function actionState(role: Role, action: Action): ActionState {
  const reason = roleReason(role, action);
  return reason ? refused(reason, "role") : allowed;
}

/**
 * Workflow ops whose command narrows the base roles by the record's state
 * (lib/workflow/brief-program.ts, acceptance-commands.ts): once the scope,
 * the program or the acceptance record is approved (the program: submitted
 * or approved), only a Lead Auditor may change it. Each entry says when the
 * narrowing applies and why, as the disabled control explains it.
 */
const narrowings = {
  saveBrief: {
    applies: (e: Engagement) => e.workflow?.brief?.status === "approved",
    reason: "Only a Lead Auditor can revise an approved scope",
  },
  saveAcceptance: {
    applies: (e: Engagement) => e.workflow?.acceptance?.status === "approved",
    reason: "Only a Lead Auditor can revise an approved acceptance record",
  },
  saveProcedurePlan: {
    applies: programLocked,
    reason:
      "Only a Lead Auditor can change the plans of a submitted or approved program",
  },
  bulkPlanProcedures: {
    applies: programLocked,
    reason:
      "Only a Lead Auditor can change the plans of a submitted or approved program",
  },
  scopeProgramCandidates: {
    applies: programLocked,
    reason:
      "Only a Lead Auditor can change the scope of a submitted or approved program",
  },
} as const satisfies Partial<
  Record<
    WorkspaceAction,
    { applies: (e: Engagement) => boolean; reason: string }
  >
>;
function programLocked(e: Engagement) {
  const status = e.workflow?.program.status;
  return !!status && status !== "draft";
}

/** The workflow ops whose roles narrow with the record's state. */
export type NarrowedAction = keyof typeof narrowings;
export const narrowedActions = Object.keys(narrowings) as NarrowedAction[];

/**
 * The role check and the independence rule of a decision on one record, the
 * way its command checks them (lib/commands/**): a preparer, contributor or
 * reviewer of the work cannot also approve, close or sign it. For the
 * narrowed actions it also applies the state-dependent narrowing, so an
 * Auditor sees why an approved scope or a submitted program needs a Lead
 * Auditor instead of meeting the server's 403.
 */
export function decisionState(
  role: Role,
  userId: string,
  decision:
    | { action: "reviewPaper"; paper: Paper }
    | { action: "signPaper"; paper: Paper }
    | { action: "closeFinding"; finding: Finding }
    | { action: "approveClassification"; engagement: Engagement }
    | { action: NarrowedAction; engagement: Engagement }
    | {
        action: Exclude<
          Action,
          | "reviewPaper"
          | "signPaper"
          | "closeFinding"
          | "approveClassification"
          | NarrowedAction
        >;
      },
): ActionState {
  const reason = roleReason(role, decision.action);
  if (reason) return refused(reason, "role");
  if (Object.hasOwn(narrowings, decision.action) && "engagement" in decision) {
    const narrowing = narrowings[decision.action as NarrowedAction];
    return narrowing.applies(decision.engagement) && !lead.includes(role)
      ? refused(narrowing.reason, "state")
      : allowed;
  }
  switch (decision.action) {
    case "reviewPaper": {
      const p = decision.paper;
      return p.authorId === userId || (p.contributors ?? []).includes(userId)
        ? refused("The author cannot review their own paper")
        : allowed;
    }
    case "signPaper": {
      const p = decision.paper;
      return p.reviews.some(
        (r) =>
          r.revision === p.revision &&
          r.userId !== p.authorId &&
          r.userId !== userId,
      )
        ? allowed
        : refused(
            "Independent review of the current revision is required: someone other than you and the author must review it",
          );
    }
    case "closeFinding": {
      const f = decision.finding;
      return f.createdBy === userId || f.remediationBy === userId
        ? refused("Independent retest confirmation is required")
        : allowed;
    }
    case "approveClassification": {
      // The server decides from the latest "classify" audit event; the
      // workspace sees only classification.history. They agree for every
      // record classified since history was kept. For a legacy record
      // without history the button stays enabled and the server's 403
      // appears in the attestation dialog instead.
      const classified = decision.engagement.classification?.history
        ?.filter((h) => h.action === "classified")
        .at(-1);
      return classified?.by === userId
        ? refused(
            "An independent reviewer must approve a completed classification",
          )
        : allowed;
    }
    default:
      return allowed;
  }
}

/** The caller's identity as the workspace knows it. */
export type ManagementIdentity = { role: Role; practiceAdmin?: boolean };

/**
 * Practice administration, not the membership role, authorizes every
 * POST /api/management op (lib/commands/management/batch.ts). Two ops narrow
 * it further to a Lead Auditor: the quality review policy, and internal
 * engagement access (see canAssignEngagementAccess).
 */
export function manageState(
  identity: ManagementIdentity,
  op?: "setQualityReviewPolicy",
): ActionState {
  if (!identity.practiceAdmin)
    return refused("Practice administration permission is required", "role");
  if (op === "setQualityReviewPolicy" && identity.role !== "Lead Auditor")
    return refused(
      "Only a Lead Auditor may set the quality review policy",
      "role",
    );
  return allowed;
}

/**
 * Whether the caller may assign internal engagement access when granting,
 * inviting or updating a member (lib/commands/management/engagement-grants.ts).
 */
export function canAssignEngagementAccess(identity: ManagementIdentity) {
  return !!identity.practiceAdmin && identity.role === "Lead Auditor";
}
