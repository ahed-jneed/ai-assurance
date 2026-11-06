// The criteria documents of templates/criteria (schemas/criteria-pack.schema.json,
// docs/design/criteria-model.md section 5) and the pin an engagement stores.
// Types only, so client code can use them; the loader is server-only.
import type { ResearchProcedure } from "../catalog-criteria";

export type Relationship =
  "equal" | "subset_of" | "superset_of" | "intersects_with" | "no_relationship";
export type Rationale = "syntactic" | "semantic" | "functional";
export type Provenance = {
  source: string;
  sourceKind: string;
  verification: "verified" | "secondary_only" | "unverified";
  checkedAt?: string;
  legalReview?: "required" | "completed" | "not_required";
  note?: string;
};
export type ApplicabilityRow = {
  from: string;
  until?: string | null;
  condition: string;
  legalRef?: string;
  provenance: Provenance;
};
export type RequirementNode = {
  id: string;
  ref: string;
  title?: string;
  type: "group" | "requirement" | "informative";
  parent?: string;
  exhaustive?: boolean;
  aliases?: string[];
  actors?: string[];
  trigger?: unknown;
  applicability?: ApplicabilityRow[];
  evidenceCategories?: string[];
  text?: string;
  reviewNote?: string;
  deprecated?: boolean;
  replacedBy?: string[];
  provenance?: Provenance;
  extensions?: Record<string, unknown>;
};
export type FrameworkKind =
  | "legislation"
  | "implementing_act"
  | "harmonised_standard"
  | "international_standard"
  | "national_standard"
  | "framework"
  | "profile"
  | "certification_scheme"
  | "local_law"
  | "guidance";
export type Licence = {
  holder: string;
  textPolicy: "full_text" | "paraphrased_titles" | "identifiers_only";
  status: "confirmed" | "unconfirmed";
  basis: string;
  url?: string;
  attribution?: string;
};
export type FrameworkDocument = {
  documentType: "framework";
  schemaVersion: string;
  id: string;
  edition: string;
  version: string;
  title: string;
  shortTitle: string;
  kind: FrameworkKind;
  publisher: string;
  jurisdiction: string;
  status?: string;
  consolidatedAsOf?: string;
  researchedAsOf?: string;
  sources: { role: string; url: string; title?: string }[];
  licence: Licence;
  defaultProvenance?: Provenance;
  triggerProfiles?: Record<string, unknown>;
  factTypes?: Record<string, string>;
  requirements: RequirementNode[];
  compat?: {
    obligations?: { order: string[] } & Record<string, unknown>;
  };
};
export type Link = {
  /** "<framework-id>:<requirement-id>" */
  requirement: string;
  relationship: Relationship;
  rationale: Rationale;
  justification: string;
  origin: "authored" | "migrated";
};
export type ControlObjective = {
  id: string;
  statement: string;
  addresses: Link[];
};
/** A catalogue item: the fields of templates/catalog.json items. */
export type CatalogItem = {
  id: string;
  title: string;
  kind: string;
  stage: string;
  folder: string;
  templatePath: string;
  regulatoryRefs: string[];
  automationMode: string;
  objective: string;
  procedures: { id: string; text: string }[];
  evidenceRequired: string[];
  signOffGate: string;
  researchProcedures?: {
    data: string;
    procedures: ResearchProcedure[];
  };
};
export type PackItem = CatalogItem & {
  objectiveIds: string[];
  phase?: string;
  derivedFrom?: { packId: string; version: string; itemId: string };
};
export type PackFeatures = {
  /** The Annex IV evidence index in report snapshots. */
  annexIvIndex: boolean;
  /** The AI Act risk classification, its commands, gates and report sections. */
  aiActClassification: boolean;
  /** AI Act obligation-subitem assessments. */
  obligationAssessments: boolean;
  /** The organisation's Statement of Applicability over `soaControls` (#28). */
  statementOfApplicability: boolean;
  /** Major, minor and opportunity grades and corrective action plans (#28). */
  nonconformityGrading: boolean;
  /** Reports may state an audit recommendation to a certification decision (#28). */
  certificationRecommendation: boolean;
};
export type CriteriaSet = {
  framework: string;
  edition: string;
  version: string;
  role: "primary" | "supporting";
  include?: string[];
};
export type PackRoles = {
  limitationMemo?: string;
  diagnosticPaperByResultArticle?: Record<string, string>;
  externalExecutionPaper?: string;
};
export type PackDocument = {
  documentType: "pack";
  schemaVersion: string;
  id: string;
  version: string;
  title: string;
  summary?: string;
  kind: "audit_programme" | "crosswalk_only";
  methodologyVersion: string;
  supersedes?: string;
  engagementTypes?: string[];
  criteria: CriteriaSet[];
  crosswalks?: { id: string; version: string }[];
  phases?: { id: string; title: string }[];
  defaults: Record<string, unknown>;
  roles?: PackRoles;
  features?: Partial<PackFeatures>;
  /** "<framework-id>:<group-id>": the controls of the Statement of Applicability. */
  soaControls?: string;
  reporting?: { regulatorySource?: string; limitations: string };
  controlObjectives: ControlObjective[];
  items: PackItem[];
  compat?: {
    catalog?: {
      schemaVersion: string;
      regulatorySnapshot: Record<string, unknown>;
    };
  };
};
export type LegalEffect = {
  kind: "presumption_of_conformity";
  basis: string;
  conditions: string;
  provenance: Provenance;
};
export type CrosswalkEntry = {
  id?: string;
  sources: string[];
  target: string;
  relationship: Relationship;
  rationale: Rationale;
  justification: string;
  confidence?: "high" | "medium" | "low";
  legalEffect?: LegalEffect;
};
export type CrosswalkDocument = {
  documentType: "crosswalk";
  schemaVersion: string;
  id: string;
  version: string;
  title: string;
  source: { framework: string; edition: string };
  target: { framework: string; edition: string };
  method: string;
  entries: CrosswalkEntry[];
};
export type CriteriaDocument =
  FrameworkDocument | PackDocument | CrosswalkDocument;
export type Approval = {
  role: "methodology_owner" | "legal_reviewer";
  by: string;
  at: string;
};
export type IndexEntry = {
  documentType: "framework" | "pack" | "crosswalk";
  id: string;
  edition?: string;
  version: string;
  path: string;
  sha256?: string;
  status: "draft" | "released" | "withdrawn";
  approvals?: Approval[];
  legalReview?: "pending" | "completed";
  releasedAt?: string;
  withdrawnAt?: string;
  withdrawalReason?: string;
  selectable?: boolean;
};
export type IndexDocument = {
  documentType: "index";
  schemaVersion: string;
  documents: IndexEntry[];
  defaults: { pack: { id: string; version: string } };
  legacy: {
    packId: string;
    fallbackVersion: string;
    stamps: Record<string, string>;
  };
};
export type Bundle = {
  documentType: "bundle";
  schemaVersion: string;
  purpose: "fixture" | "generated";
  index: IndexDocument;
  documents: CriteriaDocument[];
};

/** The pin an engagement stores (design section 10): about 300 bytes. */
export type CriteriaPin = {
  packId: string;
  packVersion: string;
  packSha256: string;
};
export type PinOrigin = "created" | "legacy" | "repinned";
export type EngagementCriteria = {
  pin: CriteriaPin;
  pinnedAt: string;
  pinnedBy: string;
  origin: PinOrigin;
  history: {
    pin: CriteriaPin;
    at: string;
    actor: string;
    origin: PinOrigin;
    reason: string;
  }[];
};

/** What GET /api/workspace tells the client about the engagement's pack. */
export type CriteriaView = {
  pin: CriteriaPin;
  origin: PinOrigin;
  title: string;
  kind: PackDocument["kind"];
  methodologyVersion: string;
  features: PackFeatures;
  frameworks: {
    id: string;
    edition: string;
    version: string;
    shortTitle: string;
    role: CriteriaSet["role"];
    kind: FrameworkKind;
    /** A legislation framework whose qualified legal review is outstanding. */
    legalReviewPending: boolean;
    textPolicy: Licence["textPolicy"];
  }[];
  /** The pack version or one of its framework data versions was withdrawn. */
  withdrawn: boolean;
  /** Assertion criteria on packs without obligation assessments. */
  requirements?: { reference: string; citation: string; title: string }[];
  /**
   * The pin is a draft of a local draft preview (CRITERIA_INCLUDE_DRAFTS=1):
   * not released, never in a production build.
   */
  draft: boolean;
  /** Programme phases and Statement of Applicability controls (#28). */
  managementSystem?: ManagementSystemView;
};
/** What the management-system features need on the client (#28). */
export type ManagementSystemView = {
  /** Programme phases in order, with the pack items of each. */
  phases: { id: string; title: string; templateIds: string[] }[];
  /** The Statement of Applicability controls, in framework order. */
  controls: SoaControl[];
  /** The framework the controls belong to, e.g. "ISO/IEC 42001:2023". */
  controlsFramework: string;
};
/** One control of a Statement of Applicability. */
export type SoaControl = {
  id: string;
  ref: string;
  title: string;
  /** The control's own group, e.g. "A.2 AI-related policies". */
  group: string;
};
/** A pack offered at engagement creation. */
export type PackSummary = {
  id: string;
  version: string;
  title: string;
  summary: string;
  isDefault: boolean;
  /** A draft of a local draft preview, never offered by a production build. */
  draft: boolean;
  workingPapers: number;
  memos: number;
  frameworks: { shortTitle: string; edition: string; title: string }[];
  legalReviewPending: boolean;
  /** Frameworks whose text may not be stored: clause numbers only. */
  clauseNumbersOnly: boolean;
  phases: string[];
  crosswalksTo: string[];
};
