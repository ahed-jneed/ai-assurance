// The engine's rules for a genai-plan/0.1 (engine/genai/plan.py
// normalize_plan), applied by the workspace before it freezes a plan (#248).
// The engine stays the source of truth: every plan it refuses with
// plan_invalid is refused here too, with a readable reason that names the
// criterion, so a frozen plan never fails its ingest job later. The shared
// fixtures in engine/tests/fixtures/genai/plan-contract.json hold both sides
// to that (plan-contract.test.ts and engine/tests/test_genai_plan_contract.py).
// The workspace refuses a little more than the engine: an empty criteria
// list, more than 50 criteria and a plan over 64 KiB. Pure.

export const PLAN_SCHEMA = "genai-plan/0.1";
/** engine/statistics.py SPEC_VERSION. */
export const STATISTICS_VERSION = "1.0.0";
/** The top-level keys of DEFAULT_PLAN. */
export const PLAN_KEYS = [
  "schemaVersion",
  "statisticsVersion",
  "confidenceLevel",
  "minimums",
  "primaryScore",
  "successRule",
  "epochReducer",
  "scorePolicy",
  "clusterKey",
  "techniqueKey",
  "variantKey",
  "taskTypes",
  "categories",
  "maxUnscoredFraction",
  "maxErrorFraction",
  "criteria",
  "judgeValidation",
  "excerpts",
  "detectionKeys",
  "allowUnverifiedFormatVersion",
  "reconciliationTolerance",
] as const;
export const CRITERION_KEYS = [
  "id",
  "kind",
  "role",
  "metric",
  "band",
  "select",
  "primaryScore",
  "groupBy",
  "k",
  "candidate",
  "baseline",
  "epochReducer",
  "successRule",
  "stratum",
  "transformation",
  "requireTrustedSigner",
] as const;
export const CRITERION_KINDS = [
  "genai_mean",
  "genai_attack_success",
  "genai_pass_k",
  "genai_paired_difference",
  "genai_marking",
] as const;
export const MEAN_METRICS = ["accuracy", "score_mean", "task_success"] as const;
export const GROUP_BY = [
  "technique",
  "variant",
  "technique_variant",
  "category",
  "none",
] as const;
export const REDUCERS = ["mean", "any", "all", "majority"] as const;
export const MARKING_METRICS = [
  "marking_presence",
  "detection_rate",
  "false_positive_rate",
  "detection_rate_after_transformation",
  "self_identification_rate",
] as const;
export const ITEM_TYPES = ["qa", "attack", "rag", "agent_task"] as const;
export const EXCERPTS = ["none", "failures", "all"] as const;
/** engine/genai/taxonomy.py CATEGORIES. */
export const CATEGORIES = [
  "prompt_injection_direct",
  "prompt_injection_indirect",
  "jailbreak",
  "goal_hijack",
  "sensitive_information_disclosure",
  "hidden_context_exposure",
  "excessive_agency",
  "privilege_abuse",
  "unexpected_code_execution",
  "improper_output_handling",
  "memory_context_poisoning",
  "data_model_poisoning",
  "supply_chain",
  "vector_embedding_weakness",
  "unbounded_consumption",
  "inter_agent_communication",
  "cascading_failure",
  "human_trust_exploitation",
  "rogue_agent",
  "misinformation",
  "capability_accuracy",
  "harmful_content",
  "bias_fairness",
  "ai_interaction_disclosure",
  "synthetic_content_marking",
  "policy_violation",
] as const;
/** The engine's floors: raised, never lowered (D-10, D-16). */
export const PLAN_FLOORS = {
  minimums: { sampleSize: 30, memberSize: 10, clusters: 10 },
  maxUnscoredFraction: 0.05,
  maxErrorFraction: 0.05,
  judgeValidation: {
    minimumItems: 50,
    minimumKappaLowerBound: 0.6,
    pairwiseMinimumConsistencyLowerBound: 0.8,
  },
} as const;
export const MAX_WORKSPACE_CRITERIA = 50;

/**
 * The Freeze plan dialog's starting plan: one accuracy criterion with a band,
 * so it freezes and the engine runs it as written (#248). The auditor sets
 * the band from the methodology before freezing. The contract fixtures hold
 * it as "default-template", which the engine accepts.
 */
export const GENAI_PLAN_TEMPLATE = {
  schemaVersion: PLAN_SCHEMA,
  criteria: [
    {
      id: "C1",
      kind: "genai_mean",
      metric: "accuracy",
      band: { lower: 0.9 },
    },
  ],
};

const CRITERION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KEY_COMPONENT = /^[A-Za-z0-9._@+=/#-]{1,128}$/;
const ED25519_SPKI = /^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const SCORE_NAME_MAX = 300;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const real = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const int = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const oneOf = (v: unknown, values: readonly string[]) =>
  typeof v === "string" && values.includes(v);
const has = (o: Obj, key: string) => Object.hasOwn(o, key);
const list = (values: readonly string[]) => values.join(", ");

/** Unknown keys of an object, as the engine's _keys refuses them. */
function unknownKeys(o: Obj, allowed: readonly string[]) {
  return Object.keys(o).filter((k) => !allowed.includes(k));
}

function successRuleProblem(rule: unknown, where: string): string | null {
  if (!isObject(rule)) return `${where} must be an object`;
  const extra = unknownKeys(rule, ["type", "values", "operator", "value"]);
  if (extra.length) return `${where} has unknown keys: ${extra.join(", ")}`;
  if (rule.type === "tool_native")
    return Object.keys(rule).length === 1
      ? null
      : `${where} of type tool_native takes no other keys`;
  if (rule.type === "value_in") {
    const values = rule.values;
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 50 ||
      !values.every((v) =>
        ["string", "number", "boolean"].includes(typeof v),
      ) ||
      has(rule, "operator") ||
      has(rule, "value")
    )
      return `${where} of type value_in lists 1 to 50 values and nothing else`;
    return null;
  }
  if (rule.type === "threshold") {
    if (
      !oneOf(rule.operator, [">=", ">", "<=", "<"]) ||
      !real(rule.value) ||
      has(rule, "values")
    )
      return `${where} of type threshold has an operator (>=, >, <= or <) and a numeric value`;
    return null;
  }
  return `${where}.type is tool_native, value_in or threshold`;
}

function bandProblem(band: unknown, kind: string, name: string) {
  const example =
    kind === "genai_attack_success"
      ? '{"upper": 0.05}'
      : kind === "genai_paired_difference"
        ? '{"lower": -0.02}'
        : '{"lower": 0.9}';
  if (band === undefined)
    return `${name} needs a band, for example "band": ${example}`;
  if (!isObject(band)) return `${name}: the band must be an object`;
  const extra = unknownKeys(band, ["lower", "upper"]);
  if (extra.length)
    return `${name}: the band has unknown keys: ${extra.join(", ")}`;
  const lower = band.lower ?? null,
    upper = band.upper ?? null;
  if (lower === null && upper === null)
    return `${name} needs a band with a lower or upper bound, for example ${example}`;
  if ((lower !== null && !real(lower)) || (upper !== null && !real(upper)))
    return `${name}: the band's bounds are numbers`;
  if (kind === "genai_paired_difference") {
    if (upper !== null || lower === null || lower <= -1 || lower >= 1)
      return `${name}: a paired-difference band is {"lower": -m} or {"lower": m} with m inside (0, 1)`;
    return null;
  }
  for (const bound of [lower, upper])
    if (bound !== null && (bound <= 0 || bound >= 1))
      return `${name}: the band's bounds lie strictly between 0 and 1`;
  if (kind === "genai_attack_success" && lower !== null)
    return `${name}: an attack-success band is {"upper": t}`;
  if (kind === "genai_pass_k" && upper !== null)
    return `${name}: a pass^k band is {"lower": t}`;
  if (lower !== null && upper !== null && lower >= upper)
    return `${name}: the band's lower bound is below its upper bound`;
  return null;
}

function selectorProblem(sel: unknown, where: string) {
  if (!isObject(sel)) return `${where} must be an object`;
  const extra = unknownKeys(sel, ["runKey", "task", "format"]);
  if (extra.length) return `${where} has unknown keys: ${extra.join(", ")}`;
  for (const [key, value] of Object.entries(sel))
    if (!text(value, 512)) return `${where}.${key} is 1 to 512 characters`;
  return null;
}

function criterionProblems(c: unknown, i: number): string[] {
  if (!isObject(c)) return [`Criterion ${i + 1} must be an object`];
  const name =
    typeof c.id === "string" && c.id
      ? `Criterion ${c.id}`
      : `Criterion ${i + 1}`;
  const problems: string[] = [];
  const add = (p: string | null) => p && problems.push(p);
  const extra = unknownKeys(c, CRITERION_KEYS);
  if (extra.length) add(`${name} has unknown keys: ${extra.join(", ")}`);
  if (!has(c, "id")) add(`${name} needs an id`);
  else if (typeof c.id !== "string" || !CRITERION_ID.test(c.id))
    add(
      `${name}: the id starts with a letter or digit and has up to 128 letters, digits and . _ : -`,
    );
  if (!oneOf(c.kind, CRITERION_KINDS)) {
    add(`${name}: the kind is one of ${list(CRITERION_KINDS)}`);
    return problems;
  }
  const kind = c.kind as string;
  add(bandProblem(c.band, kind, name));
  if (has(c, "role") && !oneOf(c.role, ["confirmatory", "exploratory"]))
    add(`${name}: the role is confirmatory or exploratory`);
  if (has(c, "select")) add(selectorProblem(c.select, `${name}: select`));
  if (has(c, "primaryScore") && !text(c.primaryScore, SCORE_NAME_MAX))
    add(`${name}: primaryScore is 1 to ${SCORE_NAME_MAX} characters`);
  if (has(c, "epochReducer") && !oneOf(c.epochReducer, REDUCERS))
    add(`${name}: epochReducer is one of ${list(REDUCERS)}`);
  if (has(c, "successRule"))
    add(successRuleProblem(c.successRule, `${name}: successRule`));
  const forbidden = (keys: string[]) => {
    const present = keys.filter((k) => has(c, k));
    if (present.length)
      add(`${name}: a ${kind} criterion takes no ${present.join(", ")}`);
  };
  if (kind === "genai_mean") {
    if (has(c, "metric") && !oneOf(c.metric, MEAN_METRICS))
      add(`${name}: the metric is one of ${list(MEAN_METRICS)}`);
    forbidden(["groupBy", "k", "candidate", "baseline"]);
  } else if (kind === "genai_attack_success") {
    if (has(c, "groupBy") && !oneOf(c.groupBy, GROUP_BY))
      add(`${name}: groupBy is one of ${list(GROUP_BY)}`);
    forbidden(["metric", "k", "candidate", "baseline"]);
  } else if (kind === "genai_pass_k") {
    const k = c.k;
    if (
      !Array.isArray(k) ||
      k.length < 1 ||
      k.length > 20 ||
      !k.every((v) => int(v) && v >= 1 && v <= 1000) ||
      new Set(k).size !== k.length
    )
      add(`${name}: k lists 1 to 20 distinct whole numbers from 1 to 1000`);
    forbidden(["metric", "groupBy", "candidate", "baseline"]);
  } else if (kind === "genai_paired_difference") {
    if (!has(c, "candidate") || !has(c, "baseline"))
      add(`${name}: a paired difference names a candidate and a baseline`);
    else {
      add(selectorProblem(c.candidate, `${name}: candidate`));
      add(selectorProblem(c.baseline, `${name}: baseline`));
    }
    forbidden(["select", "metric", "groupBy", "k"]);
  } else {
    if (!oneOf(c.metric, MARKING_METRICS))
      add(`${name}: the metric is one of ${list(MARKING_METRICS)}`);
    for (const key of ["stratum", "transformation"])
      if (has(c, key) && !text(c[key], 300))
        add(`${name}: ${key} is 1 to 300 characters`);
    if (
      c.metric === "detection_rate_after_transformation" &&
      !has(c, "transformation")
    )
      add(
        `${name}: detection_rate_after_transformation names a transformation`,
      );
    if (
      has(c, "requireTrustedSigner") &&
      (c.requireTrustedSigner !== true || c.metric !== "marking_presence")
    )
      add(`${name}: requireTrustedSigner is true, on marking_presence only`);
    if (
      c.metric === "false_positive_rate" &&
      isObject(c.band) &&
      (c.band.lower ?? null) !== null
    )
      add(`${name}: a false-positive band is {"upper": t}`);
  }
  if (kind !== "genai_marking" && has(c, "requireTrustedSigner"))
    add(`${name}: requireTrustedSigner belongs to genai_marking`);
  return problems;
}

function detectionKeyProblems(keys: unknown): string[] {
  if (!Array.isArray(keys) || keys.length > 20)
    return ["detectionKeys lists at most 20 keys"];
  const problems: string[] = [],
    ids = new Set<unknown>();
  keys.forEach((key, i) => {
    const where = `detectionKeys[${i}]`;
    if (!isObject(key)) return problems.push(`${where} must be an object`);
    const fields = ["keyId", "solutionId", "algorithm", "publicKeySPKI"];
    const extra = unknownKeys(key, fields),
      missing = fields.filter((f) => !has(key, f));
    if (extra.length)
      return problems.push(`${where} has unknown keys: ${extra.join(", ")}`);
    if (missing.length)
      return problems.push(`${where} needs ${missing.join(", ")}`);
    if (
      typeof key.keyId !== "string" ||
      !KEY_COMPONENT.test(key.keyId) ||
      ids.has(key.keyId)
    )
      problems.push(`${where}.keyId must be a unique key component`);
    ids.add(key.keyId);
    if (!text(key.solutionId, 100) || LONE_SURROGATE.test(key.solutionId))
      problems.push(`${where}.solutionId is 1 to 100 characters`);
    if (key.algorithm !== "Ed25519")
      problems.push(`${where}.algorithm is Ed25519`);
    if (
      typeof key.publicKeySPKI !== "string" ||
      !ED25519_SPKI.test(key.publicKeySPKI)
    )
      problems.push(
        `${where}: publicKeySPKI is a base64 Ed25519 SubjectPublicKeyInfo`,
      );
  });
  return problems;
}

/**
 * Every reason the engine would refuse this plan (plan_invalid), plus the
 * workspace's own limits; empty when the plan freezes and the engine accepts
 * it as frozen.
 */
export function genaiPlanProblems(plan: unknown): string[] {
  if (!isObject(plan)) return ["The plan must be a JSON object"];
  const problems: string[] = [];
  const add = (p: string | null) => p && problems.push(p);
  const extra = unknownKeys(plan, PLAN_KEYS);
  if (extra.length) add(`The plan has unknown keys: ${extra.join(", ")}`);
  if (plan.schemaVersion !== PLAN_SCHEMA)
    add(`schemaVersion must be ${PLAN_SCHEMA}`);
  if (
    has(plan, "statisticsVersion") &&
    plan.statisticsVersion !== STATISTICS_VERSION
  )
    add(`statisticsVersion must be ${STATISTICS_VERSION}`);
  if (
    has(plan, "confidenceLevel") &&
    ![0.9, 0.95, 0.99].includes(plan.confidenceLevel as number)
  )
    add("confidenceLevel is 0.90, 0.95 or 0.99");
  if (has(plan, "minimums")) {
    const m = plan.minimums;
    if (!isObject(m)) add("minimums must be an object");
    else
      for (const [key, value] of Object.entries(m)) {
        const floor =
          PLAN_FLOORS.minimums[key as keyof typeof PLAN_FLOORS.minimums];
        if (floor === undefined) add(`minimums has an unknown key: ${key}`);
        else if (!int(value) || value > 10_000_000)
          add(`minimums.${key} is a whole number`);
        else if (value < floor)
          add(`minimums.${key} may not be below ${floor}`);
      }
  }
  if (
    (plan.primaryScore ?? null) !== null &&
    !text(plan.primaryScore, SCORE_NAME_MAX)
  )
    add(`primaryScore is 1 to ${SCORE_NAME_MAX} characters`);
  if (has(plan, "successRule"))
    add(successRuleProblem(plan.successRule, "successRule"));
  if (
    (plan.epochReducer ?? null) !== null &&
    !oneOf(plan.epochReducer, REDUCERS)
  )
    add(`epochReducer is one of ${list(REDUCERS)}`);
  if (
    has(plan, "scorePolicy") &&
    !oneOf(plan.scorePolicy, ["original", "as_edited"])
  )
    add("scorePolicy is original or as_edited");
  const cluster = plan.clusterKey ?? null;
  if (cluster !== null) {
    const ok = isObject(cluster)
      ? Object.keys(cluster).length > 0 &&
        Object.keys(cluster).length <= 1000 &&
        Object.values(cluster).every((v) => text(v, 300))
      : text(cluster, 300);
    if (!ok)
      add("clusterKey is a key of 1 to 300 characters or a map of such keys");
  }
  for (const key of ["techniqueKey", "variantKey"])
    if ((plan[key] ?? null) !== null && !text(plan[key], 300))
      add(`${key} is 1 to 300 characters`);
  if (has(plan, "taskTypes")) {
    const t = plan.taskTypes;
    if (
      !isObject(t) ||
      Object.keys(t).length > 1000 ||
      !Object.values(t).every((v) => oneOf(v, ITEM_TYPES))
    )
      add(`taskTypes maps tasks to ${list(ITEM_TYPES)}`);
  }
  if (has(plan, "categories")) {
    const cats = plan.categories;
    const known = (v: unknown) =>
      Array.isArray(v) && v.every((c) => oneOf(c, CATEGORIES));
    if (!isObject(cats)) add("categories must be an object");
    else {
      const extraCats = unknownKeys(cats, ["default", "byTechnique"]);
      if (extraCats.length)
        add(`categories has unknown keys: ${extraCats.join(", ")}`);
      if (has(cats, "default") && !known(cats.default))
        add("categories.default lists categories of the taxonomy");
      if (
        has(cats, "byTechnique") &&
        !(
          isObject(cats.byTechnique) &&
          Object.values(cats.byTechnique).every(known)
        )
      )
        add(
          "categories.byTechnique maps techniques to categories of the taxonomy",
        );
    }
  }
  for (const key of ["maxUnscoredFraction", "maxErrorFraction"] as const)
    if (has(plan, key)) {
      const v = plan[key];
      if (!real(v) || v < 0) add(`${key} is a fraction`);
      else if (v > PLAN_FLOORS[key])
        add(`${key} may not exceed ${PLAN_FLOORS[key]}`);
    }
  if (has(plan, "judgeValidation")) {
    const jv = plan.judgeValidation,
      floors = PLAN_FLOORS.judgeValidation;
    if (!isObject(jv)) add("judgeValidation must be an object");
    else {
      const extraJv = unknownKeys(jv, [
        ...Object.keys(floors),
        "requireDifferentFamily",
      ]);
      if (extraJv.length)
        add(`judgeValidation has unknown keys: ${extraJv.join(", ")}`);
      if (
        has(jv, "minimumItems") &&
        (!int(jv.minimumItems) || jv.minimumItems < floors.minimumItems)
      )
        add("judgeValidation.minimumItems may not be below 50 (D-10)");
      if (
        has(jv, "minimumKappaLowerBound") &&
        (!real(jv.minimumKappaLowerBound) ||
          jv.minimumKappaLowerBound < floors.minimumKappaLowerBound ||
          jv.minimumKappaLowerBound >= 1)
      )
        add(
          "judgeValidation.minimumKappaLowerBound may not be below 0.60 (D-10) and lies below 1",
        );
      if (
        has(jv, "pairwiseMinimumConsistencyLowerBound") &&
        (!real(jv.pairwiseMinimumConsistencyLowerBound) ||
          jv.pairwiseMinimumConsistencyLowerBound <
            floors.pairwiseMinimumConsistencyLowerBound ||
          jv.pairwiseMinimumConsistencyLowerBound >= 1)
      )
        add(
          "judgeValidation.pairwiseMinimumConsistencyLowerBound may not be below 0.80 (D-16) and lies below 1",
        );
      if (
        has(jv, "requireDifferentFamily") &&
        jv.requireDifferentFamily !== true
      )
        add("judgeValidation.requireDifferentFamily must stay true (D-10)");
    }
  }
  if (has(plan, "excerpts") && !oneOf(plan.excerpts, EXCERPTS))
    add(`excerpts is one of ${list(EXCERPTS)}`);
  if (has(plan, "detectionKeys"))
    problems.push(...detectionKeyProblems(plan.detectionKeys));
  if (
    has(plan, "allowUnverifiedFormatVersion") &&
    typeof plan.allowUnverifiedFormatVersion !== "boolean"
  )
    add("allowUnverifiedFormatVersion is true or false");
  if (has(plan, "reconciliationTolerance")) {
    const v = plan.reconciliationTolerance;
    if (!real(v) || v < 0 || v > 1e-3)
      add("reconciliationTolerance lies between 0 and 0.001");
  }
  const criteria = plan.criteria;
  if (!Array.isArray(criteria)) add("The plan needs a criteria list");
  else {
    if (criteria.length === 0) add("The plan needs at least one criterion");
    if (criteria.length > MAX_WORKSPACE_CRITERIA)
      add(`The plan has at most ${MAX_WORKSPACE_CRITERIA} criteria`);
    criteria.forEach((c, i) => problems.push(...criterionProblems(c, i)));
    const ids = criteria.map((c) => (isObject(c) ? c.id : undefined));
    if (new Set(ids).size !== ids.length) add("Criterion ids must be unique");
  }
  if (JSON.stringify(plan).length > 64 * 1024) add("The plan exceeds 64 KiB");
  return problems;
}
