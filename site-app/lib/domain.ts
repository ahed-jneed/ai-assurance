// The engagement domain, imported as "@/lib/domain": the record types and
// roles (domain/types.ts), the regulatory classification
// (domain/classification.ts), finding risk (domain/risk.ts) and the
// lifecycle and issuance gates (domain/gates.ts).
export type {
  Artifact,
  Engagement,
  EvaluationConfig,
  EvaluationProfile,
  EvidenceRequest,
  Finding,
  Metric,
  Model,
  ModelCard,
  Outcome,
  Paper,
  PlanConfig,
  Report,
  Result,
  Role,
  RulePackStamp,
  Run,
} from "./domain/types";
export { canWrite, legacyConfig, roles } from "./domain/types";
export type { Classification } from "./domain/classification";
export { articleNames, classify } from "./domain/classification";
export { risk } from "./domain/risk";
export type { AuditGate } from "./domain/gates";
export {
  completionGates,
  finalReportGates,
  gatesStage,
  isReleaseTimeRecord,
  paperCurrent,
  paperRequired,
  releaseRequirements,
  releaseTimeMessage,
  releaseTimeTemplates,
  reportBlockers,
  stageGates,
  stages,
  workStage,
} from "./domain/gates";
