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
export type Execution = {
  id: string;
  revision: number;
  briefRevision: number;
  programRevision: number;
  procedureRevision: number;
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
  revision: number;
  contributors: string[];
  updatedBy: string;
  updatedAt: string;
  paperId?: string;
  paperRevision?: number;
  state: "planned" | "executed" | "evaluated" | "submitted" | "reviewed";
  execution?: Execution;
  review?: Approval;
  history: {
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
  revision: number;
  briefRevision: number;
  status: "draft" | "submitted" | "approved";
  contributors: string[];
  updatedBy: string;
  updatedAt: string;
  approval?: Approval;
  history: {
    revision: number;
    briefRevision: number;
    status: string;
    approval?: Approval;
    procedureRevisions: {
      id: string;
      revision: number;
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
