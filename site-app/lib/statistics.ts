// Audit statistics core: statistics specification 1.0.0
// (docs/design/audit-statistics.md), the hosted runner's port of
// engine/statistics.py.
//
// The interval decides, never the point estimate: a criterion passes only
// when its interval lies inside the pre-registered band, fails only when it
// lies outside, and is inconclusive otherwise (section 4). Confirmatory
// criteria are adjusted with Bonferroni and exploratory criteria with
// Benjamini-Hochberg (section 6). schemas/fixtures/statistics-golden.json is
// the arbiter: lib/statistics.test.ts runs every case through this module,
// and the engine runs the same cases, so both runners decide alike.
//
// Every function mirrors its Python namesake line for line, including the
// order of members, reasons and keys, so a difference between the runners
// is a bug in one of them. Functions work on counts; lib/diagnostics.ts
// turns rows into counts and results.

export {
  StatisticsError,
  SPEC_VERSION,
  FLOORS,
  EPS,
  BINARY_METRICS,
  MULTICLASS_METRICS,
  REGRESSION_METRICS,
  PERFORMANCE_KINDS,
  HEADLINE_NAMES,
} from "./statistics/core";
export {
  erfc,
  normalQuantile,
  zcrit,
  pFromZ,
  codePointCompare,
  phi,
  fsum,
} from "./statistics/numerics";
export {
  wilson,
  newcombe,
  katz,
  koopman,
  ratioMethod,
} from "./statistics/intervals";
export { invert, wilsonZstar } from "./statistics/pvalues";
export type { Band } from "./statistics/pvalues";
export {
  fisherTwoSided,
  fisherGreater,
  bonferroni,
  benjaminiHochberg,
} from "./statistics/exact-tests";
export { jcs, sha256Hex, planSha256 } from "./statistics/plan-hash";
export {
  THRESHOLD_LIBRARY,
  LIBRARY,
  normalizeCriterion,
  normalizePlan,
} from "./statistics/plan";
export type {
  LibraryEntry,
  LibraryRecord,
  PlanMember,
  PlanCriterion,
  Plan,
} from "./statistics/plan";
export {
  ID_PATTERN,
  bandProblem,
  criterionBandProblem,
  validatePlan,
} from "./statistics/plan-validation";
export {
  chanceLevel,
  deriveHosted,
  deriveEngine,
  planFor,
} from "./statistics/plan-legacy";
export { memberId } from "./statistics/members";
export type { CriterionInterval, Member } from "./statistics/members";
export type {
  Confusion,
  MulticlassData,
  RegressionData,
} from "./statistics/metric-stats";
export type {
  GroupData,
  RateEntry,
  Coverage,
  GroupView,
  CriterionData,
} from "./statistics/group-comparisons";
export { evaluateCriterion } from "./statistics/criteria";
export type {
  Headline,
  LibraryView,
  Decision,
  CriterionResult,
} from "./statistics/criteria";
export { MAX_DECISION_DRAWS, clusterKey } from "./statistics/cluster-bootstrap";
export type { Clustered } from "./statistics/cluster-bootstrap";
export {
  aggregate,
  evaluatePlan,
  evaluateCriteria,
} from "./statistics/evaluation";
export type { PlanEvaluation, ClusteredData } from "./statistics/evaluation";
export { criterionPower, evaluatePower } from "./statistics/power";
export type { PowerMember, CriterionPower } from "./statistics/power";
export { LL144_RATE_KEYS, evaluateLl144 } from "./statistics/ll144-reporting";
export type { Ll144Row } from "./statistics/ll144-reporting";
