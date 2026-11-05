import { z } from "zod";
import type { Engagement, Model, Run, EvaluationProfile } from "./domain";
import { ApiError, bucket, id, now, sha256 } from "./store";
import {
  configSchema,
  suiteSchema,
  profileSchema,
  tasks,
  assertSuite,
  fairnessSelected,
  runnerVersion,
  testDefinitionVersion,
} from "./evaluation";
import { inspectCSV, validateEvaluation } from "./diagnostics";
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
export function registerProfile(
  e: Engagement,
  data: Record<string, unknown>,
  actor: string,
) {
  const a = profileSchema.parse(data);
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
  // The protocol freezes the class binary recall is measured on; only binary
  // performance has one.
  a.config.performancePositiveLabel =
    a.task === "Binary classification"
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
  if (
    (e.evaluationProfiles ?? []).some(
      (p) =>
        p.name.toLocaleLowerCase() === a.name.toLocaleLowerCase() &&
        p.version.toLocaleLowerCase() === a.version.toLocaleLowerCase(),
    )
  )
    throw new ApiError(
      409,
      "This protocol name and version already exist. Create a new version.",
    );
  const p: EvaluationProfile = {
    ...a,
    id: id("PROTOCOL"),
    schemaVersion: "1.0",
    createdAt: now(),
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
 * configuration would skip, such as the fairness data-handling basis.
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
    },
    actor,
  );
}
/**
 * Queues a new run with the frozen request of a failed or cancelled run: its
 * protocol, or the suite and configuration of a legacy explicit run.
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
  }: {
    modelId: string;
    datasetId: string;
    /** The saved protocol; null only to retry a legacy explicit run. */
    profile: EvaluationProfile | null;
    suite: string[];
    config: Run["config"];
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
  if (e.runs.filter((r) => ["queued", "running"].includes(r.state)).length >= 3)
    throw new ApiError(429, "Complete or cancel outstanding runs first");
  const { a: dataset, csv } = await datasetCSV(e, datasetId);
  if (m.sourceSha256 && m.sourceSha256 !== dataset.sha256)
    throw new ApiError(400, "Registered prediction artifact hash changed");
  const run: Run = {
    contractVersion: "1.1",
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
    ],
  };
  if (profile)
    run.provenance.inputHashes.protocol = await sha256(JSON.stringify(profile));
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
