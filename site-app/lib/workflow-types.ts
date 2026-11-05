export type Approval = {
  userId: string;
  at: string;
  revision: number;
  hash: string;
  reason: string;
};
export type BriefFields = {
  systemName: string;
  intendedUse: string;
  boundary: string;
  periodStart: string;
  periodEnd: string;
  actorResponsibilities: string;
  audience: string;
  deliverables: string;
  basis: string;
  constraints: string;
  independence: string;
  changeImpact: string;
};
export type Brief = BriefFields & {
  revision: number;
  status: "draft" | "submitted" | "approved";
  contributors: string[];
  updatedBy: string;
  updatedAt: string;
  approval?: Approval;
  // The reviewer's open request for changes, kept apart from the preparer's
  // fields: set when a submitted brief is returned, cleared when it is
  // submitted again. The history keeps the returned revision with it.
  returnReason?: string;
  returnedBy?: string;
  returnedAt?: string;
  /**
   * Submitted revisions: each returned revision, with its return reason, and
   * each approved revision once a Lead revises it. A draft that was never
   * submitted is superseded without an entry. Engagements saved before
   * November 2026 also hold one entry per earlier draft save, and returned
   * revisions without a return reason.
   */
  history: Omit<Brief, "history">[];
};
export type ProcedurePlan = {
  selected: boolean;
  applicability: "pending" | "applicable" | "readiness" | "not_applicable";
  rationale: string;
  criterion: string;
  sourceVersion: string;
  periodAnalysis: string;
  population: string;
  sampling: string;
  ownerId: string;
  reviewerId: string;
  dueDate: string;
  method: "manual" | "automated" | "mixed";
  modelId: string;
  datasetId: string;
  profileId: string;
};
/**
 * What replaced a procedure's state: a plan change, a new execution, an
 * evaluation, an independent impact review or a reviewer's return.
 */
export type ProcedureChange =
  "plan" | "execute" | "evaluate" | "reaffirm" | "return";
export type Execution = {
  id: string;
  revision: number;
  briefRevision: number;
  /** The program revision in force when the work was recorded. */
  programRevision: number;
  /** The procedure's plan revision the work was performed against. */
  procedureRevision: number;
  /**
   * The `Procedure.planHash` the work was performed against: with the brief
   * revision, what keeps the execution current. Executions recorded before
   * plan hashes bind `procedureRevision` instead.
   */
  planHash?: string;
  performed: string;
  steps: {
    id: string;
    state: "performed" | "not_performed";
    notes: string;
  }[];
  sampling: string;
  results: string;
  limitations: string;
  evidenceIds: string[];
  runIds: string[];
  actor: string;
  at: string;
  assessment?: {
    relevance: string;
    reliability: string;
    coverage: string;
    contradictions: string;
    conclusion: string;
    outcome: "supported" | "qualified" | "not_supported";
    actor: string;
    at: string;
  };
  impactReview?: {
    briefRevision: number;
    programRevision: number;
    actor: string;
    at: string;
    reason: string;
  };
};
export type Procedure = ProcedurePlan & {
  id: string;
  templateId: string;
  title: string;
  stage: string;
  objective: string;
  instructions: {
    id: string;
    text: string;
  }[];
  expectedEvidence: string[];
  candidateRefs: string[];
  /**
   * The substantive plan revision: it changes with what the procedure tests
   * and how, never with its preparer, reviewer or due date.
   */
  revision: number;
  /**
   * SHA-256 of the substantive plan (`substantivePlan` in
   * lib/workflow/command.ts). Absent until a command first needs it on a
   * procedure planned before plan hashes.
   */
  planHash?: string;
  /** Counts changes to the preparer, reviewer and due date; absent is 1. */
  assignmentRevision?: number;
  /**
   * Set once the plan changes after it was last submitted for program
   * approval: the submitted plan is then in the history, and further changes
   * before the next submission amend this one without new history entries.
   */
  planAmended?: boolean;
  contributors: string[];
  updatedBy: string;
  updatedAt: string;
  paperId?: string;
  paperRevision?: number;
  state: "planned" | "executed" | "evaluated" | "submitted" | "reviewed";
  execution?: Execution;
  review?: Approval;
  history: {
    /**
     * The change this entry kept the state before. Entries recorded before
     * November 2026 have none.
     */
    action?: ProcedureChange;
    plan: ProcedurePlan;
    revision: number;
    execution?: Execution;
    review?: Approval;
    paperId?: string;
    paperRevision?: number;
    at: string;
    actor: string;
  }[];
};
export type Program = {
  /**
   * Drafting amends the current revision; changing a submitted or approved
   * program starts the next one.
   */
  revision: number;
  briefRevision: number;
  status: "draft" | "submitted" | "approved";
  contributors: string[];
  updatedBy: string;
  updatedAt: string;
  approval?: Approval;
  /**
   * Each submission ("submitted") and its outcome, with the procedure plans
   * it bound: "approved", "returned" with the reviewer's reason, or
   * "withdrawn" when a Lead's plan or scope change took it back to draft.
   * Engagements saved before November 2026 also hold one entry per earlier
   * plan save, with the status the program had before that save.
   */
  history: {
    revision: number;
    briefRevision: number;
    status: string;
    approval?: Approval;
    reason?: string;
    procedureRevisions: {
      id: string;
      revision: number;
      planHash?: string;
    }[];
    at: string;
    actor: string;
  }[];
};
export type ClientGrant = {
  requestedItems?: string[];
  communications?: {
    id: string;
    actor: string;
    at: string;
    kind: "clarification" | "reply";
    text: string;
  }[];
  id: string;
  userId: string;
  requestId: string;
  prompt: string;
  instructions: string;
  category: string;
  handlingBasis: "synthetic" | "anonymized";
  expiresAt: string;
  active: boolean;
  actor: string;
  at: string;
  revokedBy?: string;
  revokedAt?: string;
  history?: {
    requestedItems?: string[];
    actor: string;
    at: string;
    prompt: string;
    instructions: string;
  }[];
};
export type Submission = {
  deliveredItems?: string[];
  receipt?: { actor: string; at: string; note: string };
  id: string;
  requestId: string;
  grantId: string;
  actor: string;
  at: string;
  evidenceIds: string[];
  note: string;
  delivery: "partial" | "complete";
  remaining: string;
};
export type PortalRequest = {
  requestedItems?: string[];
  communications?: ClientGrant["communications"];
  id: string;
  subject: string;
  prompt: string;
  instructions: string;
  periodVersion: string;
  dueDate: string;
  status: string;
  grantId: string;
  submissions: Submission[];
};
export type MonitoringCase = {
  id: string;
  kind: "monitoring" | "change" | "incident" | "remediation";
  title: string;
  description: string;
  ownerId: string;
  dueDate: string;
  cadence: "one_off" | "monthly" | "quarterly" | "annual";
  findingId: string;
  reportId: string;
  state: "open" | "in_progress" | "closed";
  decision:
    "not_assessed" | "follow_up" | "no_reassessment" | "reassessment_required";
  assessment: string;
  evidenceIds: string[];
  contributors: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  previousCaseId?: string;
  nextCaseId?: string;
  successorEngagementId?: string;
  closedBy?: string;
  closedAt?: string;
  closure?: string;
  history: {
    at: string;
    actor: string;
    action: string;
    state: string;
    assessment: string;
    evidenceIds: string[];
  }[];
};
export type Workflow = {
  schemaVersion: "1.0";
  adoptedBy: string;
  adoptedAt: string;
  brief?: Brief;
  program: Program;
  procedures: Procedure[];
  clientGrants: ClientGrant[];
  submissions: Submission[];
  monitoring: MonitoringCase[];
  successorOf?: {
    engagementId: string;
    caseId: string;
  };
};
export type Release = {
  state: "internal" | "approved" | "released" | "withdrawn" | "superseded";
  approval?: {
    userId: string;
    at: string;
    internalHash: string;
    clientHash: string;
    reason: string;
  };
  recipientScope?: string;
  releasedBy?: string;
  releasedAt?: string;
  supersedes?: string;
  supersededBy?: string;
  history: {
    actor: string;
    at: string;
    action: string;
    reason: string;
  }[];
};
