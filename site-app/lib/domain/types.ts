// The engagement record model: the records an engagement holds and the
// roles people act in.
import type { PortalRequest, Release, Workflow } from "../workflow-types";
import type { Classification } from "./classification";
import type { EngagementCriteria } from "../criteria/types";
import type { Decision, Plan } from "../statistics";
import type { QualityReview } from "./quality-review";
import type {
  SpecialCategoryAcknowledgement,
  SpecialCategoryBasis,
  SpecialCategoryDeclaration,
} from "../special-category";
export type Role =
  | "Auditor"
  | "Lead Auditor"
  | "Client Viewer"
  | "Client Contributor"
  | "Reviewer"
  | "Engagement Quality Reviewer";
export const roles: Role[] = [
  "Auditor",
  "Lead Auditor",
  "Client Viewer",
  "Client Contributor",
  "Reviewer",
  "Engagement Quality Reviewer",
];
export function canWrite(role: Role) {
  return role === "Auditor" || role === "Lead Auditor";
}
export type Outcome = "pass" | "fail" | "inconclusive" | "not_applicable";
/**
 * A rule-pack stamp (#18): the EU AI Act rule pack of templates/catalog.json
 * (`regulatorySnapshot`) a record was made under. An engagement carries the
 * pack it was created with, written once and never rewritten; engagements
 * created before rule pack 2026.11.1 have none. Captured report snapshots and
 * runs carry the pack the build applied, next to its methodology version.
 */
export type RulePackStamp = {
  /** Rule-pack revision: the catalog's methodology version, e.g. "2026.11.1". */
  version: string;
  /** Consolidated legal text the pack interprets (CELEX), e.g. "02024R1689-20260727". */
  legalVersion: string;
  /** Date the pack's legal research was verified, e.g. "2026-11-05". */
  researchedAsOf: string;
  /** "pending" until qualified legal review approves the pack (D-02). */
  legalReview: "pending" | "approved";
};
export type Paper = {
  id: string;
  templateId: string;
  title: string;
  kind: string;
  stage: string;
  articleRefs: string[];
  required: boolean;
  revision: number;
  authorId: string;
  contributors: string[];
  updatedAt: string;
  status: "draft" | "in_review" | "reviewed" | "signed";
  /**
   * The paper a recompiled procedure revision replaced this signed paper
   * with. A superseded paper keeps its signed content as history: it is
   * immutable, no longer required, and the gates, the Annex IV index and
   * report snapshots leave it out.
   */
  supersededBy?: string;
  supersededAt?: string;
  /** The signed paper this compiled paper replaced. */
  supersedes?: string;
  /**
   * Set on an evidence request's limitation memo while the request is
   * reopened: the memo no longer applies, so it counts towards nothing until
   * closing the request again revises it.
   */
  retired?: { requestId: string; actor: string; at: string; reason: string };
  plannedGuidance?: string;
  /**
   * Who a signed paper is written for. Released client snapshots include
   * only client papers. Absent means the default: internal for memos,
   * client for working papers (`paperAudience` in lib/client-projection.ts).
   */
  audience?: "internal" | "client";
  body: Record<string, string>;
  evidenceIds: string[];
  runIds: string[];
  comments: {
    id: string;
    authorId: string;
    text: string;
    resolved: boolean;
    createdAt: string;
    responses?: { actor: string; at: string; text: string }[];
    resolvedAt?: string;
  }[];
  reviews: { userId: string; revision: number; at: string }[];
  signatures: { userId: string; revision: number; at: string; hash: string }[];
  history: {
    revision: number;
    body: Record<string, string>;
    authorId: string;
    at: string;
    evidenceIds: string[];
    runIds: string[];
    reviews: Paper["reviews"];
    signatures: Paper["signatures"];
    contributors: string[];
  }[];
};
export type Artifact = {
  id: string;
  name: string;
  category: string;
  size: number;
  sha256: string;
  key: string;
  createdAt: string;
  uploadedBy: string;
  visibility: "internal" | "client";
  status: "unverified" | "accepted" | "quarantined";
  mediaType: string;
  /**
   * "client": a client-held dataset pin (#102). The client keeps the file;
   * the platform holds only its name, size and SHA-256, and `key` is empty.
   */
  custody?: "client";
  /** Who at the client confirmed a client-held pin, when, and how it is kept. */
  clientPin?: { confirmedBy: string; confirmedOn: string; custodyNote: string };
};
export type EvidenceRequest = {
  id: string;
  subject: string;
  description: string;
  responsibleParty: string;
  periodVersion: string;
  handling: string;
  dueDate: string;
  paperIds: string[];
  evidenceIds: string[];
  required: boolean;
  status: "open" | "submitted" | "accepted" | "returned" | "waived";
  response: string;
  assessment: string;
  disposition?: "sufficient" | "unobtainable" | "no_longer_required";
  limitationPaperId?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  revision: number;
  deliveryComplete?: boolean;
  remainingItems?: string;
  history: Omit<EvidenceRequest, "history">[];
};
export type ModelCard = {
  schemaVersion: "1.0";
  owner: string;
  framework: string;
  license: string;
  population: string;
  outOfScope: string;
  limitations: string;
  inputSchema: string;
  outputSemantics: string;
  preprocessing: string;
  source: {
    kind: "internal" | "huggingface";
    repoId: string;
    revision: string;
    filename: string;
  };
};
export type Model = {
  id: string;
  name: string;
  version: string;
  format: string;
  task: string;
  intendedPurpose: string;
  artifactId: string;
  status: "registered" | "quarantined";
  familyId?: string;
  card?: ModelCard;
  sourceSha256?: string;
  registeredAt?: string;
  registeredBy?: string;
};
/**
 * The column mappings and declared labels of an evaluation. A profile with a
 * stored statistics plan (schemaVersion 1.1) keeps only these in its config;
 * bands and minimums live in the plan (docs/design/audit-statistics.md 9.1).
 */
export type PlanConfig = {
  labelColumn: string;
  predictionColumn: string;
  groupColumn: string;
  /** The favourable outcome fairness tests count as selection. */
  positiveLabel: string;
  /** The class binary recall is measured on; absent or empty: positiveLabel. */
  performancePositiveLabel?: string;
  /** The other declared binary label; with it, data with one observed label is evaluated. */
  negativeLabel?: string;
};
/** The legacy (schemaVersion 1.0) configuration, from which each run derives its plan. */
export type EvaluationConfig = PlanConfig & {
  minimumGroupSize: number;
  maximumParityGap: number;
  minimumImpactRatio: number;
  minimumAccuracy: number;
  minimumSampleSize?: number;
  minimumClassCount?: number;
  maximumOddsGap?: number;
  minimumRecall?: number;
  minimumMacroF1?: number;
  maximumRmse?: number;
};
/** The legacy thresholds of a configuration, or null for a plan configuration. */
export function legacyConfig(
  config: PlanConfig | EvaluationConfig,
): EvaluationConfig | null {
  return "minimumAccuracy" in config ? config : null;
}
export type EvaluationProfile = {
  id: string;
  /** 1.1 stores the pre-registered statistics plan; 1.0 derives it per run. */
  schemaVersion: "1.0" | "1.1";
  name: string;
  version: string;
  task: string;
  suite: string[];
  config: EvaluationConfig | PlanConfig;
  /** The normalised plan, frozen when the profile is saved (schemaVersion 1.1). */
  statistics?: Plan;
  datasetContext: {
    split: "test" | "validation" | "training" | "unknown";
    population: string;
    predictionProvenance: string;
    independence: string;
    sensitiveDataBasis: string;
  };
  rationale: string;
  /** Fairness protocols: whether the group column is special-category data. */
  specialCategory?: SpecialCategoryDeclaration;
  createdAt: string;
  createdBy: string;
};
export type Finding = {
  id: string;
  title: string;
  article: string;
  condition: string;
  criteria: string;
  cause: string;
  effect: string;
  likelihood: number;
  impact: number;
  riskScore: number;
  severity: string;
  status: "open" | "in_progress" | "ready_for_retest" | "closed";
  owner: string;
  dueDate: string;
  response: string;
  remediation: string;
  retestEvidenceIds: string[];
  closedBy?: string;
  createdBy: string;
  remediationBy?: string;
  remediationAt?: string;
  /**
   * The criteria the finding concerns, as requirement references of the
   * pinned pack such as "eu-ai-act:AIA-ART-9" (docs/design/criteria-model.md
   * section 7, phase 2). Defaulted from the item of `support.procedureId`;
   * findings recorded before phase 2 have none. Coverage places an unresolved
   * finding without a procedure or paper link on them, and the report rolls
   * it up by criterion through them.
   */
  criteriaRefs?: string[];
  support?: {
    findingId: string;
    procedureId: string;
    paperIds: string[];
    evidenceIds: string[];
    runIds: string[];
    actor: string;
    at: string;
  };
  retest?: {
    performed: string;
    results: string;
    rationale: string;
    conclusion: "effective" | "not_effective";
    evidenceIds: string[];
    actor: string;
    at: string;
  };
  closureHistory?: {
    at: string;
    actor: string;
    reason: string;
    retest?: Finding["retest"];
    closedBy?: string;
  }[];
  visibility: "internal" | "client";
  /**
   * The grade of a finding on a pack with nonconformity grading (#28): a
   * major or minor nonconformity, or an opportunity for improvement.
   */
  grade?: NonconformityGrade;
  /** Every grading decision, oldest first. */
  gradeHistory?: {
    grade: NonconformityGrade;
    rationale: string;
    actor: string;
    at: string;
  }[];
  /** The organisation's correction and corrective action plan (#28). */
  correctiveAction?: CorrectiveAction;
};
export type NonconformityGrade = "major" | "minor" | "opportunity";
export type CorrectiveAction = {
  /** What was done to remove the nonconformity found. */
  correction: string;
  rootCause: string;
  /** What will remove the cause so it does not recur. */
  action: string;
  owner: string;
  dueDate: string;
  recordedBy: string;
  recordedAt: string;
  /** Acceptance of this plan, by someone other than whoever recorded it. */
  accepted?: { by: string; at: string; note: string };
};
/** One control decision of the organisation's Statement of Applicability. */
export type SoaEntry = {
  /** The control's requirement id, e.g. "A.2.2". */
  control: string;
  included: boolean;
  justification: string;
  /** Only for an included control. */
  implementation?:
    "implemented" | "partially_implemented" | "planned" | "not_implemented";
  actor: string;
  at: string;
};
/** The Statement of Applicability as the auditors recorded and reviewed it. */
export type StatementOfApplicability = {
  /** The organisation's own document, e.g. "SoA v3 of 2026-10-01". */
  documentRef: string;
  entries: SoaEntry[];
  /** Raised by every change. */
  revision: number;
  review?: { by: string; at: string; revision: number; note: string };
};
export type Metric = {
  name: string;
  value: number | null;
  unit: string;
  sampleSize: number;
  details?: unknown;
  /** Statistics 1.0.0 results (hosted 1.4, external 1.5) carry the shared metric shape. */
  numerator?: number | null;
  denominator?: number | null;
  threshold?: unknown;
  confidenceInterval?: {
    lower: number;
    upper: number;
    level: number;
    method: string;
  } | null;
  slices?: unknown[];
  pValue?: number | null;
};
export type Result = {
  testId: string;
  label: string;
  article: string;
  outcome: Outcome;
  metrics: Metric[];
  limitations: string[];
  /** The statistics 1.0.0 decision (hosted 1.4, external 1.5). */
  decision?: Decision;
};
export type Run = {
  externalJobId?: string;
  retryOf?: string;
  procedureBinding?: {
    procedureId: string;
    procedureRevision: number;
    /**
     * The `Procedure.planHash` the run was queued for. Absent on runs queued
     * before runs recorded it and on runs of external jobs queued before jobs
     * recorded it, which bind the plan revision.
     */
    planHash?: string;
    briefRevision: number;
    /** The program revision in force when the run was queued: a record only. */
    programRevision: number;
  };
  contractVersion: "1.0" | "1.1" | "1.2" | "1.4" | "1.5";
  id: string;
  engagementId: string;
  modelId: string;
  datasetId: string;
  suite: string[];
  seed: number;
  thresholds: Record<string, unknown>;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  outcome: Outcome | null;
  overallOutcome?: Outcome;
  /** Exploratory criteria that failed (statistics 1.0.0); they never change the outcome. */
  reviewFlags?: string[];
  results: Result[];
  paperIds: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  provenance: {
    inputHashes: Record<string, string>;
    runnerVersion: string;
    policyVersion: string;
  };
  /** The rule pack and methodology the run was made under; absent on older runs. */
  rulePack?: RulePackStamp;
  methodologyVersion?: string;
  config: EvaluationConfig | PlanConfig;
  task?: string;
  profileId?: string;
  manifest?: {
    schemaVersion: "1.0";
    model: Model;
    dataset: {
      id: string;
      name: string;
      sha256: string;
      size: number;
      rowCount: number;
      columns: string[];
      cardPin?: {
        recordId: string;
        sha256: string;
        card: Record<string, unknown>;
      };
      /** External runs on a client-held pin: the bytes never left the client. */
      custody?: "client";
    };
    profile: EvaluationProfile | null;
    executionMode:
      | "saved_predictions"
      | "provided_predictions"
      | "auditor_model"
      | "client_local";
    lineage:
      "registered_prediction_artifact" | "authenticated_external_attempt";
    testDefinitionVersion: string;
    limitations: string[];
    /** The normalised plan that decides the run, frozen at queueing (1.4, 1.5). */
    statistics?: Plan;
    /**
     * A hosted run on special-category data: who acknowledged it, when, and
     * on a retry the run whose acknowledgement it carries over.
     */
    specialCategoryAcknowledgement?: SpecialCategoryAcknowledgement;
  };
};
export type Report = {
  id: string;
  kind: "draft" | "final";
  createdAt: string;
  actor: string;
  sha256: string;
  snapshot: Record<string, unknown>;
  clientSnapshot?: Record<string, unknown>;
  clientSha256?: string;
  release?: Release;
  /**
   * The earlier released reports this released report replaced, by id. Set
   * on the client projection, which shows no release records, so a client
   * sees why an earlier report is no longer listed.
   */
  replaces?: string[];
  /**
   * The released report that superseded this one. Set on the client
   * projection: a superseded report stays readable to the client, which was
   * issued that opinion, labelled with its successor (or, when the successor
   * was withdrawn and the client cannot read it, without naming it).
   */
  supersededBy?: string;
};
export type Engagement = {
  workflow?: Workflow;
  portalRequests?: PortalRequest[];
  id: string;
  clientId: string;
  title: string;
  stage: string;
  dueDate: string;
  version: number;
  classification: Classification;
  /** Written once at creation; absent on engagements created before stamps. */
  rulePack?: RulePackStamp;
  /**
   * The criteria pack the engagement is pinned to (docs/design/criteria-model.md
   * section 10). Written at creation; absent on engagements created before
   * pins, which resolve to the read-time legacy pin (lib/criteria/registry.ts).
   */
  criteria?: EngagementCriteria;
  papers: Paper[];
  artifacts: Artifact[];
  evidenceRequests?: EvidenceRequest[];
  models: Model[];
  evaluationProfiles?: EvaluationProfile[];
  /** The client's recorded bases for special-category data (#60). */
  specialCategoryBases?: SpecialCategoryBasis[];
  findings: Finding[];
  runs: Run[];
  reports: Report[];
  /**
   * The engagement quality review (ISQM 2): the appointed reviewer, their
   * stand-back checklist and package sign-offs. Internal only.
   */
  qualityReview?: QualityReview;
  /** On packs with features.statementOfApplicability (#28). Internal only. */
  statementOfApplicability?: StatementOfApplicability;
  eventHead: string;
  createdAt: string;
};
