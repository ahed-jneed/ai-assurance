// The summary a `genai_result` assurance record keeps of one verified GenAI
// computation (docs/design/genai-evidence.md section 12.1): levels, criteria
// with their members, flags, metadata completeness, judge validation and the
// claim-scope statements, within the record size limit. The full computation
// stays in R2 under the result artifact. Pure.
import type { GenaiComputation } from "./envelope";

export type GenaiLevel = "L0" | "L1" | "L2" | "L3";
/** How the envelope reached the workspace (design section 4.2). */
export type GenaiCustody = "worker" | "uploaded";

/** The run-metadata fields of design section 6.1, in checklist order. */
export const METADATA_FIELDS = [
  "harness",
  "systemUnderTest.snapshot",
  "systemUnderTest.family",
  "systemPrompt",
  "decoding",
  "tools",
  "dataset",
  "epochs",
  "dates",
  "attackSet",
  "judges.model",
  "judges.family",
  "judges.promptTemplate",
  "judges.validation",
] as const;
/** Fields every GenAI conclusion needs; the others only for attack or judged runs. */
const ALWAYS = new Set<string>(METADATA_FIELDS.slice(0, 9));

export type GenaiMember = {
  memberId: string;
  metric: string;
  subject: string | null;
  n: number | null;
  estimate: number | null;
  interval: {
    level: number;
    lower: number | null;
    upper: number | null;
    method: string;
  } | null;
  se: number | null;
  seCluster: number | null;
  nEff: number | null;
  pValue: number | null;
  direction: string;
  status: string;
  reasons: string[];
  band: { lower: number | null; upper: number | null } | null;
};
export type GenaiCriterionSummary = {
  id: string;
  kind: string;
  role: "confirmatory" | "exploratory";
  outcome: string | null;
  reasons: string[];
  pValue: number | null;
  adjustedPValue: number | null;
  sampleSize: number | null;
  confidenceLevel: number;
  runKeys: string[];
  /** Score name to its scorer kinds, per run. */
  scoreKinds: Record<string, Record<string, string[]>>;
  flags: {
    flag: string;
    runKey: string;
    score: string;
    judgeRef: string | null;
    reasons: string[];
  }[];
  members: GenaiMember[];
  membersOmitted: number;
};
export type GenaiRunSummary = {
  runKey: string;
  format: string;
  /** "marking" for a marking block: marking checks (#59, A50-ED-30), C2PA validator reports or signed detection results (#128). */
  kind: "evaluation" | "marking";
  engineLevel: GenaiLevel;
  levelReasons: string[];
  incomplete: boolean;
  inputs: string[];
  checklist: { field: string; state: "recorded" | "declared" | "missing" }[];
  missing: string[];
  systemUnderTest: {
    model: string | null;
    snapshot: string | null;
    family: string | null;
  };
  harness: string | null;
  dataset: string | null;
  tools: {
    agentic: boolean | null;
    offered: { name: string; permission: string }[];
  };
  judges: {
    ref: string;
    role: string;
    model: string | null;
    snapshot: string | null;
    family: string | null;
    kappa: number | null;
    lower: number | null;
    n: number | null;
  }[];
  postRunEdits: {
    scoreEdits: number;
    logUpdates: number;
    invalidated: number;
    logInvalidated: boolean;
  };
  reconciliation: {
    metric: string;
    tool: number | null;
    ours: number | null;
    status: string;
  }[];
  claimScope: string[];
  warnings: string[];
  markingRecords?: number;
  /** Signed detection results whose signature the engine verified (#128). */
  signedResults?: number;
};
export type GenaiSummary = {
  schemaVersion: "genai-summary/1";
  computationSha256: string;
  itemsSha256: string;
  engine: {
    version: string;
    genaiVersion: string;
    statisticsVersion: string;
    taxonomyVersion: string;
  };
  origin: "auditee_supplied" | "auditor_rerun";
  manifestSha256: string;
  planSha256: string;
  plan: {
    confidenceLevel: number;
    minimums: { sampleSize: number; memberSize: number; clusters: number };
    judgeValidation: {
      minimumItems: number;
      minimumKappaLowerBound: number;
      requireDifferentFamily: boolean;
      pairwiseMinimumConsistencyLowerBound: number;
    };
    maxUnscoredFraction: number;
    maxErrorFraction: number;
    scorePolicy: string;
  };
  inputs: {
    name: string;
    sha256: string;
    bytes: number;
    format: string;
    role: string;
  }[];
  overallOutcome: string;
  runs: GenaiRunSummary[];
  criteria: GenaiCriterionSummary[];
  judgeValidation: {
    inputSha256: string;
    judgeRef: string | null;
    n: number;
    kappa: number | null;
    lower: number | null;
    upper: number | null;
    level: number;
    positionConsistencyLower: number | null;
    pairs: number;
    bindings: {
      runKey: string;
      judgeRef: string;
      binding: Record<string, boolean | null>;
      validated: boolean;
      reasons: string[];
    }[];
  }[];
  warnings: { code: string; count: number }[];
};

/** Members kept per criterion; the rest stay in the computation in R2. */
const MEMBER_CAP = 60;
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const text = (v: unknown, max = 300) =>
  typeof v === "string" ? v.slice(0, max) : null;

export function genaiSummary(
  c: GenaiComputation,
  pins: { computationSha256: string; itemsSha256: string },
): GenaiSummary {
  const attackRuns = new Set(
    c.criteria
      .filter((k) => k.kind === "genai_attack_success")
      .flatMap((k) => k.runKeys),
  );
  const runs: GenaiRunSummary[] = c.runs.map((r) => {
    const m = r.runMetadata,
      missing = m.completeness.missing,
      declared = new Set(m.completeness.declaredOnly),
      judged = m.judges.length > 0;
    const fields = METADATA_FIELDS.filter(
      (f) =>
        ALWAYS.has(f) ||
        missing.includes(f) ||
        declared.has(f) ||
        (f === "attackSet" ? attackRuns.has(r.runKey) : judged),
    );
    const edits = r.postRunEdits?.counts;
    return {
      runKey: r.runKey,
      format: r.format,
      kind: "evaluation",
      engineLevel: r.evidenceLevel,
      levelReasons: r.levelReasons,
      incomplete: r.incomplete,
      inputs: r.inputs,
      checklist: fields.map((field) => ({
        field,
        state: missing.includes(field)
          ? "missing"
          : declared.has(field)
            ? "declared"
            : "recorded",
      })),
      missing,
      systemUnderTest: {
        model: text(m.systemUnderTest.model),
        snapshot: text(m.systemUnderTest.snapshot),
        family: text(m.systemUnderTest.family, 64),
      },
      harness: m.harness.name
        ? m.harness.name + "@" + (m.harness.version ?? "undeclared")
        : null,
      dataset: m.dataset.name
        ? m.dataset.name + "@" + (m.dataset.version ?? "unversioned")
        : null,
      tools: {
        agentic: m.tools.agentic,
        offered: m.tools.offered.slice(0, 50).map((t) => ({
          name: t.name.slice(0, 128),
          permission: t.permission,
        })),
      },
      judges: m.judges.slice(0, 20).map((j) => ({
        ref: j.ref,
        role: j.role,
        model: text(j.model.model),
        snapshot: text(j.model.snapshot),
        family: text(j.model.family, 64),
        kappa: num(j.validation?.kappa),
        lower: num(j.validation?.lower),
        n: num(j.validation?.n),
      })),
      postRunEdits: {
        scoreEdits: edits?.scoreEdits ?? 0,
        logUpdates: edits?.logUpdates ?? 0,
        invalidated: edits?.invalidatedSampleEpochs ?? 0,
        logInvalidated: edits?.logInvalidated ?? false,
      },
      reconciliation: r.reconciliation.slice(0, 40).map((x) => ({
        metric: x.metric.slice(0, 200),
        tool: num(x.tool),
        ours: num(x.ours),
        status: x.status,
      })),
      claimScope: r.claimScope.slice(0, 40).map((s) => s.slice(0, 1200)),
      warnings: [...new Set(r.warnings.map((w) => w.code))],
    };
  });
  for (const block of c.marking)
    runs.push({
      runKey: block.runKey,
      // Engine 0.1 blocks carry no format: they are all marking checks.
      format: block.format ?? "marking_check_jsonl",
      kind: "marking",
      engineLevel: block.evidenceLevel,
      levelReasons: [],
      incomplete: false,
      inputs: [block.inputSha256],
      checklist: [],
      missing: [],
      systemUnderTest: { model: null, snapshot: null, family: null },
      harness: null,
      dataset: null,
      tools: { agentic: false, offered: [] },
      judges: [],
      postRunEdits: {
        scoreEdits: 0,
        logUpdates: 0,
        invalidated: 0,
        logInvalidated: false,
      },
      reconciliation: [],
      claimScope: markingScope(block.records),
      warnings: markingWarnings(block.records),
      markingRecords: block.count,
      signedResults: verifiedSignatures(block.records),
    });
  const criteria: GenaiCriterionSummary[] = c.criteria.map((k) => ({
    id: k.id,
    kind: k.kind,
    role: k.decision.role,
    outcome: k.outcome,
    reasons: k.decision.reasons,
    pValue: num(k.decision.pValue),
    adjustedPValue: num(k.decision.adjustedPValue),
    sampleSize: num(k.decision.sampleSize),
    confidenceLevel: k.decision.confidenceLevel,
    runKeys: k.runKeys,
    scoreKinds: k.scoreKinds,
    flags: k.flags.slice(0, 50).map((f) => ({
      flag: f.flag,
      runKey: f.runKey,
      score: f.score.slice(0, 200),
      judgeRef: f.judgeRef,
      reasons: f.reasons,
    })),
    // Attack criteria show the worst members first (design section 12.2).
    members: [...k.members]
      .sort((a, b) =>
        k.kind === "genai_attack_success"
          ? (b.interval?.upper ?? 1) - (a.interval?.upper ?? 1)
          : 0,
      )
      .slice(0, MEMBER_CAP)
      .map((m) => ({
        memberId: m.memberId.slice(0, 520),
        metric: m.metric,
        subject: m.subject ?? null,
        n: num(m.counts?.n),
        estimate: num(m.estimate),
        interval: m.interval
          ? {
              level: m.interval.level,
              lower: num(m.interval.lower),
              upper: num(m.interval.upper),
              method: m.interval.method,
            }
          : null,
        // Proportion members (mean, attack success, pass^k, marking) carry
        // seIid; a paired difference carries sePaired.
        se: num(m.seIid ?? m.sePaired ?? m.se),
        seCluster: num(m.seCluster),
        nEff: num(m.nEff),
        pValue: num(m.pValue),
        direction: m.direction,
        status: m.status,
        reasons: m.reasons,
        band: m.band
          ? { lower: num(m.band.lower), upper: num(m.band.upper) }
          : null,
      })),
    membersOmitted: Math.max(0, k.members.length - MEMBER_CAP),
  }));
  const p = c.plan.normalized;
  return {
    schemaVersion: "genai-summary/1",
    ...pins,
    engine: {
      version: c.engine.version,
      genaiVersion: c.engine.genaiVersion,
      statisticsVersion: c.engine.statisticsVersion,
      taxonomyVersion: c.engine.taxonomyVersion,
    },
    origin: c.manifest.origin,
    manifestSha256: c.manifest.manifestSha256,
    planSha256: c.plan.planSha256,
    plan: {
      confidenceLevel: p.confidenceLevel,
      minimums: p.minimums,
      judgeValidation: p.judgeValidation,
      maxUnscoredFraction: p.maxUnscoredFraction,
      maxErrorFraction: p.maxErrorFraction,
      scorePolicy: p.scorePolicy,
    },
    inputs: c.inputs.slice(0, 64).map((i) => ({
      name: i.name.slice(0, 200),
      sha256: i.sha256,
      bytes: i.bytes,
      format: i.format,
      role: i.role,
    })),
    overallOutcome: c.overallOutcome,
    runs,
    criteria,
    judgeValidation: c.judgeValidation.slice(0, 20).map((j) => ({
      inputSha256: j.inputSha256,
      judgeRef: j.declaredJudgeRef,
      n: j.n,
      kappa: num(j.kappa),
      lower: num(j.lower),
      upper: num(j.upper),
      level: j.level,
      positionConsistencyLower: num(j.positionConsistency?.lower),
      pairs: j.positionConsistency?.pairs ?? 0,
      bindings: j.bindings.slice(0, 20).map((b) => ({
        runKey: b.runKey,
        judgeRef: b.judgeRef,
        binding: b.binding,
        validated: b.validated,
        reasons: b.reasons,
      })),
    })),
    warnings: c.warnings
      .slice(0, 60)
      .map((w) => ({ code: w.code, count: w.count })),
  };
}

type MarkingRecord = {
  metadata?: { signatureClaimed?: unknown } | null;
  signedResult?: { verifiedByEngine?: unknown } | null;
};
const markingRecord = (r: unknown): MarkingRecord =>
  typeof r === "object" && r !== null ? (r as MarkingRecord) : {};

// Marking records whose metadata signature verdict is only claimed, by the
// provider or a named C2PA validator: the engine does not verify metadata
// signatures (engine/GENAI.md).
function markingWarnings(records: unknown[]) {
  const claimed = records.some(
    (r) => typeof markingRecord(r).metadata?.signatureClaimed === "boolean",
  );
  return claimed ? ["marking_signature_unverified"] : [];
}

// Signed detection results whose Ed25519 signature the engine verified
// against a key the frozen plan pins for the detection solution (#128).
function verifiedSignatures(records: unknown[]) {
  return records.filter(
    (r) => markingRecord(r).signedResult?.verifiedByEngine === true,
  ).length;
}

function markingScope(records: unknown[]) {
  const signed = verifiedSignatures(records);
  return signed
    ? [
        `${signed} signed detection results: each signature verified against a key the frozen plan pins for the detection solution, and each result bound to the sampled output's SHA-256.`,
      ]
    : [];
}

/** Bytes of a summary as the record stores it. */
export const summaryBytes = (s: GenaiSummary) =>
  new TextEncoder().encode(JSON.stringify(s)).length;
