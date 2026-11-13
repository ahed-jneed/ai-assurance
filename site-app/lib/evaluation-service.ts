import { z } from "zod";
import type { Engagement, Model, Run, EvaluationProfile } from "./domain";
import { bucket } from "./bindings";
import { ApiError } from "./http";
import { id, now, sha256 } from "./ids";
import {
  configSchema,
  suiteSchema,
  profileSchema,
  planProfileSchema,
  tasks,
  assertSuite,
  fairnessSelected,
  runnerVersion,
  testDefinitionVersion,
} from "./evaluation";
import { inspectCSV, validateEvaluation } from "./diagnostics";
import {
  planGroupFields,
  planSuite,
  resolvePlan,
  validateHostedPlan,
} from "./hosted-statistics";
import { recordVersions } from "./criteria/pin";
import { StatisticsError, planSha256 } from "./statistics";
import {
  assertPlatformBytes,
  declarationInputSchema,
  declareProtocol,
  hostedGate,
  type SpecialCategoryAcknowledgement,
} from "./special-category";
const short = z.string().trim().min(1).max(300),
  notes = z.string().trim().max(5000);
const cardSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    owner: short,
    framework: short,
    license: notes,
    population: notes,
    outOfScope: notes,
    limitations: notes,
    inputSchema: notes,
    outputSemantics: short,
    preprocessing: notes,
    source: z
      .object({
        kind: z.enum(["internal", "huggingface"]),
        repoId: notes,
        revision: notes,
        filename: notes,
      })
      .strict(),
  })
  .strict();
export function registerModel(
  e: Engagement,
  data: Record<string, unknown>,
  actor: string,
) {
  const a = z
      .object({
        name: short,
        version: short,
        format: short,
        task: z.enum(tasks),
        intendedPurpose: notes.min(1),
        artifactId: short,
        card: cardSchema.optional(),
      })
      .strict()
      .parse(data),
    source = e.artifacts.find((x) => x.id === a.artifactId);
  if (!source) throw new ApiError(400, "Link an artifact from this engagement");
  if (
    a.format === "Prediction file" &&
    (source.category !== "Dataset" ||
      source.status !== "accepted" ||
      !source.name.toLowerCase().endsWith(".csv"))
  )
    throw new ApiError(
      400,
      "Saved-prediction registration requires an accepted Dataset CSV",
    );
  if (a.format !== "Prediction file" && source.category !== "Model")
    throw new ApiError(400, "A model binary must link Model-category evidence");
  const family = e.models.filter(
    (m) => m.name.toLocaleLowerCase() === a.name.toLocaleLowerCase(),
  );
  if (
    family.some(
      (m) => m.version.toLocaleLowerCase() === a.version.toLocaleLowerCase(),
    )
  )
    throw new ApiError(
      409,
      "This model name and version already exist. Register a new version for a corrected card or artifact.",
    );
  if (
    a.card?.source.kind === "huggingface" &&
    (!/^[\w.-]+\/[\w.-]+$/.test(a.card.source.repoId) ||
      !/^[a-f\d]{40}$/i.test(a.card.source.revision) ||
      !a.card.source.filename ||
      a.card.source.filename.startsWith("/") ||
      a.card.source.filename.split(/[\\/]/).includes(".."))
  )
    throw new ApiError(
      400,
      "Hugging Face provenance requires owner/repository, a full 40-character commit and a relative filename",
    );
  const modelId = id("MODEL"),
    m: Model = {
      ...a,
      id: modelId,
      familyId: family[0]?.familyId ?? family[0]?.id ?? modelId,
      status: a.format === "Prediction file" ? "registered" : "quarantined",
      sourceSha256: source.sha256,
      registeredAt: now(),
      registeredBy: actor,
    };
  e.models.push(m);
  return m;
}
/**
 * Saves a protocol. A saved protocol is frozen: changing its plan, bands or
 * mappings needs a new protocol version, and each run freezes the protocol
 * and its plan into its manifest (#22). A request with `statistics` saves a
 * pre-registered plan (schemaVersion 1.1); one with legacy thresholds saves a
 * 1.0 protocol whose plan each run derives (section 9.3).
 */
export function registerProfile(
  e: Engagement,
  data: Record<string, unknown>,
  actor: string,
) {
  if ("statistics" in data) return registerPlanProfile(e, data, actor);
  const { specialCategory: declaration, ...a } = profileSchema
    .extend({ specialCategory: declarationInputSchema.optional() })
    .parse(data);
  try {
    assertSuite(a.task, a.suite);
  } catch (error) {
    throw new ApiError(400, (error as Error).message);
  }
  if (a.task === "Binary classification" && !a.config.positiveLabel)
    throw new ApiError(
      400,
      "Binary classification needs a favourable class label",
    );
  // The protocol freezes the class binary recall is measured on. Only binary
  // performance has one: a value left from a deselected performance test
  // would otherwise constrain the labels of a fairness-only protocol.
  a.config.performancePositiveLabel =
    a.task === "Binary classification" && a.suite.includes("performance")
      ? a.config.performancePositiveLabel || a.config.positiveLabel
      : "";
  if (
    fairnessSelected(a.suite) &&
    new Set([
      a.config.labelColumn,
      a.config.predictionColumn,
      a.config.groupColumn,
    ]).size !== 3
  )
    throw new ApiError(400, "Mapped role columns must be distinct");
  if (a.config.labelColumn === a.config.predictionColumn)
    throw new ApiError(400, "Target and prediction columns must be distinct");
  if (
    fairnessSelected(a.suite) &&
    (!a.config.groupColumn || !a.datasetContext.sensitiveDataBasis)
  )
    throw new ApiError(
      400,
      "Fairness procedures require a protected-group mapping and a reviewed data-handling basis",
    );
  assertNewVersion(e, a);
  const createdAt = now(),
    specialCategory = declareProtocol(e, a, declaration, actor, createdAt);
  const p: EvaluationProfile = {
    ...a,
    ...(specialCategory ? { specialCategory } : {}),
    id: id("PROTOCOL"),
    schemaVersion: "1.0",
    createdAt,
    createdBy: actor,
  };
  (e.evaluationProfiles ??= []).push(p);
  return p;
}
function assertNewVersion(e: Engagement, a: { name: string; version: string }) {
  if (
    (e.evaluationProfiles ?? []).some(
      (p) =>
        p.name.toLocaleLowerCase() === a.name.toLocaleLowerCase() &&
        p.version.toLocaleLowerCase() === a.version.toLocaleLowerCase(),
    )
  )
    throw new ApiError(
      409,
      "This protocol name and version already exist. A saved protocol and its plan are frozen: create a new version to change them.",
    );
}
/** A protocol with a pre-registered statistics plan (schemaVersion 1.1). */
function registerPlanProfile(
  e: Engagement,
  data: Record<string, unknown>,
  actor: string,
) {
  const { specialCategory: declaration, ...a } = planProfileSchema
    .extend({ specialCategory: declarationInputSchema.optional() })
    .parse(data);
  let statistics;
  try {
    statistics = validateHostedPlan(a.task, a.statistics);
  } catch (error) {
    if (error instanceof StatisticsError)
      throw new ApiError(400, error.message);
    throw error;
  }
  const suite = planSuite(statistics);
  if (
    a.suite &&
    (a.suite.length !== suite.length || a.suite.some((x) => !suite.includes(x)))
  )
    throw new ApiError(
      400,
      "The protocol's procedures must be exactly the families of its plan's criteria: " +
        suite.join(", "),
    );
  const c = a.config;
  if (c.labelColumn === c.predictionColumn)
    throw new ApiError(400, "Target and prediction columns must be distinct");
  // A cluster design (section 5.11, #136) names its own id column.
  if (
    statistics.clusterField !== null &&
    [c.labelColumn, c.predictionColumn].includes(statistics.clusterField)
  )
    throw new ApiError(
      400,
      "The cluster column (statistics.clusterField) must differ from the target and prediction columns",
    );
  if (a.task === "Binary classification") {
    if (
      !c.positiveLabel ||
      !c.negativeLabel ||
      c.positiveLabel === c.negativeLabel
    )
      throw new ApiError(
        400,
        "Binary classification declares two distinct labels: the favourable label and the other label",
      );
    // Only binary performance measures its own positive class.
    c.performancePositiveLabel = suite.includes("performance")
      ? c.performancePositiveLabel || c.positiveLabel
      : "";
    if (
      c.performancePositiveLabel &&
      ![c.positiveLabel, c.negativeLabel].includes(c.performancePositiveLabel)
    )
      throw new ApiError(
        400,
        "The performance positive class must be one of the two declared labels",
      );
  } else {
    c.positiveLabel = "";
    c.negativeLabel = "";
    c.performancePositiveLabel = "";
  }
  if (fairnessSelected(suite)) {
    if (new Set([c.labelColumn, c.predictionColumn, c.groupColumn]).size !== 3)
      throw new ApiError(400, "Mapped role columns must be distinct");
    if (!c.groupColumn || !a.datasetContext.sensitiveDataBasis)
      throw new ApiError(
        400,
        "Fairness procedures require a protected-group mapping and a reviewed data-handling basis",
      );
    // Intersectional strata (#30): their columns are group columns too.
    if (
      planGroupFields(statistics).some((f) =>
        [c.labelColumn, c.predictionColumn].includes(f),
      )
    )
      throw new ApiError(
        400,
        "Intersectional group columns must differ from the target and prediction columns",
      );
  } else c.groupColumn = "";
  assertNewVersion(e, a);
  const createdAt = now(),
    specialCategory = declareProtocol(
      e,
      { suite, config: c, statistics },
      declaration,
      actor,
      createdAt,
    );
  const p: EvaluationProfile = {
    name: a.name,
    version: a.version,
    task: a.task,
    suite,
    config: c,
    statistics,
    datasetContext: a.datasetContext,
    rationale: a.rationale,
    id: id("PROTOCOL"),
    ...(specialCategory ? { specialCategory } : {}),
    schemaVersion: "1.1",
    createdAt,
    createdBy: actor,
  };
  (e.evaluationProfiles ??= []).push(p);
  return p;
}
export async function datasetCSV(e: Engagement, artifactId: string) {
  const a = e.artifacts.find((x) => x.id === artifactId);
  if (
    !a ||
    a.category !== "Dataset" ||
    a.status !== "accepted" ||
    !a.name.toLowerCase().endsWith(".csv")
  )
    throw new ApiError(400, "Select accepted Dataset CSV evidence");
  assertPlatformBytes(a);
  if (a.size > 1024 * 1024)
    throw new ApiError(
      400,
      "Interactive evaluations accept at most 1 MB; use the external Python runner for larger files",
    );
  const object = await bucket().get(a.key);
  if (!object) throw new ApiError(404, "Dataset bytes unavailable");
  if (object.size > 1024 * 1024)
    throw new ApiError(400, "Dataset exceeds interactive size limit");
  const bytes = await object.arrayBuffer();
  if ((await sha256(bytes)) !== a.sha256)
    throw new ApiError(400, "Dataset integrity check failed");
  let csv: string;
  try {
    csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError(400, "Prediction CSV must use UTF-8 encoding");
  }
  return { a, csv };
}
/**
 * Freezes a new evaluation of a registered model against a saved protocol.
 * A protocol is required: registerProfile checks what an explicit suite and
 * configuration would skip, such as the fairness data-handling basis. A
 * fairness protocol on special-category data also needs the hosted route,
 * its recorded basis and `acknowledgeSpecialCategory`.
 */
export async function queueEvaluation(
  e: Engagement,
  data: Record<string, unknown>,
  actor: string,
) {
  const a = z
    .object({
      modelId: short,
      datasetId: short,
      profileId: short.optional(),
      suite: suiteSchema.optional(),
      config: configSchema.optional(),
      /** Hosted processing of special-category data, acknowledged. */
      acknowledgeSpecialCategory: z.literal(true).optional(),
    })
    .strict()
    .parse(data);
  if (!a.profileId)
    throw new ApiError(
      400,
      "Choose a saved evaluation protocol. Explicit configurations are accepted only to retry a frozen run.",
    );
  const profile = (e.evaluationProfiles ?? []).find(
    (p) => p.id === a.profileId,
  );
  if (!profile) throw new ApiError(404, "Evaluation protocol not found");
  if (a.suite || a.config)
    throw new ApiError(
      400,
      "A saved protocol cannot be overridden within a run; create a revised protocol",
    );
  return freezeRun(
    e,
    {
      modelId: a.modelId,
      datasetId: a.datasetId,
      profile,
      suite: profile.suite,
      config: profile.config,
      acknowledged: !!a.acknowledgeSpecialCategory,
    },
    actor,
  );
}
/**
 * Queues a new run with the frozen request of a failed or cancelled run: its
 * protocol, or the suite and configuration of a legacy explicit run. It
 * carries over the source's acknowledgement of hosted special-category
 * processing unchanged, naming the source run, so the manifest still names
 * whoever gave it rather than the person who retries.
 */
export async function queueRetry(e: Engagement, source: Run, actor: string) {
  const profile = source.profileId
    ? (e.evaluationProfiles ?? []).find((p) => p.id === source.profileId)
    : null;
  if (profile === undefined)
    throw new ApiError(404, "Evaluation protocol not found");
  return freezeRun(
    e,
    {
      modelId: source.modelId,
      datasetId: source.datasetId,
      profile,
      suite: profile?.suite ?? source.suite,
      config: profile?.config ?? source.config,
      acknowledgement: source.manifest?.specialCategoryAcknowledgement && {
        ...source.manifest.specialCategoryAcknowledgement,
        inheritedFrom: source.id,
      },
    },
    actor,
  );
}
async function freezeRun(
  e: Engagement,
  {
    modelId,
    datasetId,
    profile,
    suite,
    config,
    acknowledged = false,
    acknowledgement,
  }: {
    modelId: string;
    datasetId: string;
    /** The saved protocol; null only to retry a legacy explicit run. */
    profile: EvaluationProfile | null;
    suite: string[];
    config: Run["config"];
    /** The auditor acknowledged hosted special-category processing. */
    acknowledged?: boolean;
    /** A retry: the source run's acknowledgement, carried over as given. */
    acknowledgement?: SpecialCategoryAcknowledgement;
  },
  actor: string,
) {
  const m = e.models.find((x) => x.id === modelId);
  if (!m || m.format !== "Prediction file" || m.status !== "registered")
    throw new ApiError(
      400,
      "This version has no interactive saved-prediction capability",
    );
  if (m.artifactId !== datasetId)
    throw new ApiError(
      400,
      "Use the exact prediction artifact registered for this model version. Register a new version to test a different prediction file.",
    );
  if (profile && profile.task !== m.task)
    throw new ApiError(400, "Model task and protocol task must match");
  try {
    assertSuite(m.task, suite);
  } catch (error) {
    throw new ApiError(400, (error as Error).message);
  }
  const specialCategory = hostedGate(
    profile,
    { suite, config },
    acknowledged || !!acknowledgement,
  );
  if (e.runs.filter((r) => ["queued", "running"].includes(r.state)).length >= 3)
    throw new ApiError(429, "Complete or cancel outstanding runs first");
  const { a: dataset, csv } = await datasetCSV(e, datasetId);
  if (m.sourceSha256 && m.sourceSha256 !== dataset.sha256)
    throw new ApiError(400, "Registered prediction artifact hash changed");
  const run: Run = {
    contractVersion: "1.4",
    id: id("RUN"),
    engagementId: e.id,
    modelId: m.id,
    datasetId: dataset.id,
    task: m.task,
    profileId: profile?.id,
    suite: [...suite],
    config: { ...config },
    seed: 42,
    thresholds: {
      source: "internal_policy",
      policyId: profile?.id ?? "legacy-explicit-configuration",
      policyVersion: profile?.version ?? "1.0",
      frozenAt: now(),
      frozenBy: actor,
      ...config,
    },
    state: "queued",
    outcome: null,
    results: [],
    paperIds: [],
    createdAt: now(),
    ...recordVersions(e),
    provenance: {
      inputHashes: {
        dataset: dataset.sha256,
        modelMetadata: await sha256(JSON.stringify(m)),
        modelArtifact: dataset.sha256,
      },
      runnerVersion,
      policyVersion: profile?.version ?? "1.0",
    },
  };
  let dataRows;
  try {
    dataRows = validateEvaluation(run, csv);
  } catch (error) {
    throw new ApiError(400, (error as Error).message);
  }
  run.manifest = {
    schemaVersion: "1.0",
    model: structuredClone(m),
    dataset: {
      id: dataset.id,
      name: dataset.name,
      sha256: dataset.sha256,
      size: dataset.size,
      rowCount: dataRows.length,
      columns: Object.keys(dataRows[0]),
    },
    profile: profile ? structuredClone(profile) : null,
    // The plan that decides the run, frozen with the inputs: the protocol's
    // stored plan, or the derivation of a legacy protocol (section 9.3).
    statistics: resolvePlan(
      m.task,
      run.suite,
      run.config,
      profile?.statistics,
      dataRows,
    ),
    executionMode: "saved_predictions",
    lineage: "registered_prediction_artifact",
    testDefinitionVersion,
    limitations: [
      "Model/card/source statements are declarations until corroborated.",
      "Metrics evaluate the registered prediction file; no independent inference or holdout verification.",
      ...(!profile
        ? ["Legacy explicit configuration has no dataset-context declaration."]
        : profile.datasetContext.split === "training"
          ? ["Training data evaluates fit, not independent generalization."]
          : []),
      ...(specialCategory ? [specialCategory] : []),
    ],
    ...(specialCategory
      ? {
          specialCategoryAcknowledgement: acknowledgement ?? {
            column: config.groupColumn,
            acknowledgedBy: actor,
            acknowledgedAt: now(),
          },
        }
      : {}),
  };
  if (profile)
    run.provenance.inputHashes.protocol = await sha256(JSON.stringify(profile));
  // The SHA-256 of the plan's RFC 8785 canonical JSON (section 9.2).
  run.provenance.inputHashes.statisticsPlan = planSha256(
    run.manifest.statistics,
  );
  run.provenance.inputHashes.manifest = await sha256(
    JSON.stringify(run.manifest),
  );
  run.provenance.inputHashes.configuration = await sha256(
    JSON.stringify({
      modelId: run.modelId,
      datasetId: run.datasetId,
      task: run.task,
      suite: run.suite,
      config: run.config,
      seed: run.seed,
    }),
  );
  e.runs.push(run);
  return run;
}
/**
 * Pins a registered dataset card to a run just frozen and rehashes its
 * manifest. The caller checks that the card describes the evaluated bytes.
 */
export async function pinDatasetCard(
  run: Run,
  card: { id: string; sha256: string; body: Record<string, unknown> },
) {
  if (!run.manifest) return;
  run.manifest.dataset.cardPin = {
    recordId: card.id,
    sha256: card.sha256,
    card: card.body,
  };
  run.provenance.inputHashes.manifest = await sha256(
    JSON.stringify(run.manifest),
  );
}
/**
 * Verifies a frozen run's procedure binding, manifest, protocol and
 * configuration pins and its dataset bytes, and returns those bytes. A
 * retry needs only these; executing a queued run also needs the runner and
 * test definitions it was queued under (`currentDefinition`).
 */
export async function verifyFrozenInputs(
  e: Engagement,
  run: Run,
  { currentDefinition = false } = {},
) {
  if (
    run.procedureBinding &&
    (await sha256(JSON.stringify(run.procedureBinding))) !==
      run.provenance.inputHashes.auditBinding
  )
    throw Error("Frozen audit procedure binding integrity check failed");
  if (!run.manifest)
    throw Error(
      "This legacy queued run has no frozen evaluation manifest. Create a new evaluation using a current protocol; completed legacy results remain readable.",
    );
  if (
    (await sha256(JSON.stringify(run.manifest))) !==
      run.provenance.inputHashes.manifest ||
    (await sha256(JSON.stringify(run.manifest.model))) !==
      run.provenance.inputHashes.modelMetadata
  )
    throw Error("Frozen input manifest integrity check failed");
  if (
    run.manifest.profile &&
    (await sha256(JSON.stringify(run.manifest.profile))) !==
      run.provenance.inputHashes.protocol
  )
    throw Error("Frozen protocol integrity check failed");
  if (
    run.manifest.statistics &&
    planSha256(run.manifest.statistics) !==
      run.provenance.inputHashes.statisticsPlan
  )
    throw Error("Frozen statistics plan integrity check failed");
  if (
    (await sha256(
      JSON.stringify({
        modelId: run.modelId,
        datasetId: run.datasetId,
        task: run.task,
        suite: run.suite,
        config: run.config,
        seed: run.seed,
      }),
    )) !== run.provenance.inputHashes.configuration
  )
    throw Error("Frozen evaluation configuration integrity check failed");
  if (
    currentDefinition &&
    (run.provenance.runnerVersion !== runnerVersion ||
      run.manifest.testDefinitionVersion !== testDefinitionVersion)
  )
    throw Error(
      "Queued runner definition is no longer available; create a new run",
    );
  const { a, csv } = await datasetCSV(e, run.datasetId);
  if (a.sha256 !== run.provenance.inputHashes.dataset)
    throw Error("Dataset integrity check failed");
  return { a, csv };
}
/** The verified dataset bytes to execute a queued run with. */
export function executionCSV(e: Engagement, run: Run) {
  return verifyFrozenInputs(e, run, { currentDefinition: true });
}
export { inspectCSV };
