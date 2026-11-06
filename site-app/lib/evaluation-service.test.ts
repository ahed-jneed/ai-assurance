import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Artifact, Engagement, Model } from "./domain";
import { runnerVersion, testDefinitionVersion } from "./evaluation";
import {
  assertExternalProtocol,
  executionCSV,
  queueEvaluation,
  queueRetry,
  registerProfile,
  verifyFrozenInputs,
} from "./evaluation-service";
import { ApiError } from "./http";
import { sha256 as sha256Text } from "./ids";
import { planSha256 } from "./statistics";

// Evidence bytes by R2 key, served as the BUCKET binding of the shared
// cloudflare:workers stub.
const objects = new Map<string, Uint8Array>();
const evidence = {
  async get(key: string) {
    const bytes = objects.get(key);
    return bytes
      ? { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }
      : null;
  },
} as unknown as R2Bucket;

const predictions =
  "actual,predicted,group\n" +
  Array.from(
    { length: 40 },
    (_, i) => `${i % 2},${i % 5 ? i % 2 : 1 - (i % 2)},${i < 20 ? "A" : "B"}`,
  ).join("\n");
async function digest(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
const context = {
  split: "test" as const,
  population: "Synthetic applicants",
  predictionProvenance: "Exported by the provider",
  independence: "Holdout declared by the provider",
  sensitiveDataBasis: "",
};
const criteria = {
  labelColumn: "actual",
  predictionColumn: "predicted",
  groupColumn: "",
  positiveLabel: "1",
  minimumGroupSize: 5,
  maximumParityGap: 0.2,
  minimumImpactRatio: 0.8,
  minimumAccuracy: 0.7,
};
const binaryProtocol = (overrides: Record<string, unknown> = {}) => ({
  name: "Binary acceptance",
  version: "1.0",
  task: "Binary classification",
  suite: ["performance"],
  config: criteria,
  datasetContext: context,
  rationale: "Internal acceptance rule",
  ...overrides,
});

let e: Engagement;
beforeEach(async () => {
  const bytes = new TextEncoder().encode(predictions),
    sha256 = await digest(bytes);
  objects.clear();
  objects.set("tenant/predictions.csv", bytes);
  env.BUCKET = evidence;
  e = {
    id: "ENG-1",
    artifacts: [
      {
        id: "EV-1",
        name: "predictions.csv",
        category: "Dataset",
        status: "accepted",
        key: "tenant/predictions.csv",
        size: bytes.byteLength,
        sha256,
      } as Artifact,
    ],
    models: [
      {
        id: "MODEL-1",
        name: "Scorer",
        version: "1",
        format: "Prediction file",
        task: "Binary classification",
        intendedPurpose: "Fixture",
        artifactId: "EV-1",
        status: "registered",
        sourceSha256: sha256,
      } as Model,
    ],
    evaluationProfiles: [],
    runs: [],
  } as unknown as Engagement;
});
afterEach(() => {
  delete env.BUCKET;
});
async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}
function thrown(action: () => unknown) {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}
// A fairness-only protocol with a class typed before the performance test
// was deselected.
const fairnessOnly = (version: string) =>
  binaryProtocol({
    version,
    suite: ["demographic_parity"],
    config: {
      ...criteria,
      groupColumn: "group",
      performancePositiveLabel: "fraud",
    },
    datasetContext: { ...context, sensitiveDataBasis: "Synthetic data" },
  });

describe("registerProfile", () => {
  it("freezes the performance positive class, defaulting to the favourable label", () => {
    expect(
      registerProfile(e, binaryProtocol(), "auditor").config
        .performancePositiveLabel,
    ).toBe("1");
    expect(
      registerProfile(
        e,
        binaryProtocol({
          version: "2.0",
          config: { ...criteria, performancePositiveLabel: "0" },
        }),
        "auditor",
      ).config.performancePositiveLabel,
    ).toBe("0");
  });

  it("freezes no performance positive class without a performance test", async () => {
    const profile = registerProfile(e, fairnessOnly("1.0"), "auditor");
    expect(profile.config.performancePositiveLabel).toBe("");
    // "fraud" is not a label of the data, and the run does not need it.
    const run = await queueEvaluation(
      e,
      { modelId: "MODEL-1", datasetId: "EV-1", profileId: profile.id },
      "auditor",
    );
    expect(run).toMatchObject({
      state: "queued",
      suite: ["demographic_parity"],
      config: { performancePositiveLabel: "" },
    });
  });

  it("requires a reviewed data-handling basis for fairness tests", async () => {
    expect(() =>
      registerProfile(
        e,
        binaryProtocol({
          suite: ["demographic_parity"],
          config: { ...criteria, groupColumn: "group" },
        }),
        "auditor",
      ),
    ).toThrow(/reviewed data-handling basis/);
  });
});

describe("queueEvaluation", () => {
  it("requires a saved protocol for a new run", async () => {
    const missing = await rejection(
      queueEvaluation(e, { modelId: "MODEL-1", datasetId: "EV-1" }, "auditor"),
    );
    expect(missing.status).toBe(400);
    // An explicit configuration cannot skip the protocol's checks, such as
    // the fairness data-handling basis.
    const explicit = await rejection(
      queueEvaluation(
        e,
        {
          modelId: "MODEL-1",
          datasetId: "EV-1",
          suite: ["demographic_parity"],
          config: { ...criteria, groupColumn: "group" },
        },
        "auditor",
      ),
    );
    expect(explicit.status).toBe(400);
    expect(explicit.message).toContain("saved evaluation protocol");
    expect(e.runs).toEqual([]);
  });

  it("freezes a run against the protocol under the current definitions", async () => {
    const profile = registerProfile(e, binaryProtocol(), "auditor");
    const run = await queueEvaluation(
      e,
      { modelId: "MODEL-1", datasetId: "EV-1", profileId: profile.id },
      "auditor",
    );
    expect(run).toMatchObject({
      state: "queued",
      profileId: profile.id,
      config: { performancePositiveLabel: "1" },
      provenance: { runnerVersion },
      manifest: { testDefinitionVersion, dataset: { rowCount: 40 } },
    });
    expect(await executionCSV(e, run)).toMatchObject({ csv: predictions });
  });
});

describe("assertExternalProtocol", () => {
  it("refuses a performance positive class the external worker does not measure", () => {
    const profile = registerProfile(
      e,
      binaryProtocol({
        config: { ...criteria, performancePositiveLabel: "0" },
      }),
      "auditor",
    );
    const refused = thrown(() => assertExternalProtocol(profile));
    expect(refused.status).toBe(400);
    expect(refused.message).toContain(
      "External execution measures binary recall on the favourable label '1' only, so it cannot apply this protocol's performance positive class '0'.",
    );
  });

  it("accepts protocols whose recall the worker measures as frozen", () => {
    for (const profile of [
      registerProfile(e, binaryProtocol(), "auditor"),
      registerProfile(
        e,
        binaryProtocol({
          version: "2.0",
          config: { ...criteria, performancePositiveLabel: "1" },
        }),
        "auditor",
      ),
      registerProfile(e, fairnessOnly("3.0"), "auditor"),
      // Frozen before registration dropped a deselected test's class.
      {
        task: "Binary classification",
        suite: ["demographic_parity"],
        config: { ...criteria, performancePositiveLabel: "fraud" },
      },
    ])
      expect(() => assertExternalProtocol(profile)).not.toThrow();
  });
});

describe("retries", () => {
  it("re-queue a legacy explicit run with its frozen suite and configuration", async () => {
    // Explicit-configuration runs predate saved protocols.
    const profile = registerProfile(e, binaryProtocol(), "auditor");
    const frozen = await queueEvaluation(
      e,
      { modelId: "MODEL-1", datasetId: "EV-1", profileId: profile.id },
      "auditor",
    );
    const legacy = {
      ...frozen,
      id: "RUN-LEGACY",
      state: "cancelled" as const,
      profileId: undefined,
      config: { ...criteria },
    };
    const retry = await queueRetry(e, legacy, "auditor");
    expect(retry).toMatchObject({
      config: criteria,
      suite: ["performance"],
      thresholds: { policyId: "legacy-explicit-configuration" },
      manifest: { profile: null },
    });
    expect(retry.profileId).toBeUndefined();
  });

  it("verify the frozen inputs of a run queued under a retired runner", async () => {
    const profile = registerProfile(e, binaryProtocol(), "auditor");
    const run = await queueEvaluation(
      e,
      { modelId: "MODEL-1", datasetId: "EV-1", profileId: profile.id },
      "auditor",
    );
    run.provenance.runnerVersion = "interactive-predictions-2.0.1";
    // It can no longer execute, but a retry of it remains possible.
    await expect(executionCSV(e, run)).rejects.toThrow(
      "Queued runner definition is no longer available; create a new run",
    );
    await expect(verifyFrozenInputs(e, run)).resolves.toMatchObject({
      csv: predictions,
    });
    run.config = { ...run.config, minimumAccuracy: 0.1 };
    await expect(verifyFrozenInputs(e, run)).rejects.toThrow(
      "Frozen evaluation configuration integrity check failed",
    );
  });
});

// Statistics 1.0.0 protocols (schemaVersion 1.1, #22): the plan is
// pre-registered when the protocol is saved and frozen into every run.
const planConfig = {
  labelColumn: "actual",
  predictionColumn: "predicted",
  groupColumn: "",
  positiveLabel: "1",
  negativeLabel: "0",
};
const recallPlan = (lower = 0.7) => ({
  criteria: [
    {
      id: "recall-check",
      kind: "performance",
      members: [{ metric: "recall", band: { lower } }],
    } as Record<string, unknown>,
  ],
});
const planProtocol = (overrides: Record<string, unknown> = {}) => ({
  name: "Planned acceptance",
  version: "1.0",
  task: "Binary classification",
  config: planConfig,
  statistics: recallPlan(),
  datasetContext: context,
  rationale: "Pre-registered acceptance rule",
  ...overrides,
});

describe("protocols with a pre-registered statistics plan", () => {
  it("store the normalised plan, derive the suite and add the chance baseline", () => {
    const profile = registerProfile(e, planProtocol(), "auditor");
    expect(profile.schemaVersion).toBe("1.1");
    expect(profile.suite).toEqual(["performance"]);
    expect(profile.statistics!.criteria[0].members).toEqual([
      { metric: "recall", band: { lower: 0.7, upper: null } },
      { metric: "balanced_accuracy", band: { lower: 0.5, upper: null } },
    ]);
    expect(profile.statistics!.minimums).toEqual({
      sampleSize: 30,
      groupSize: 30,
      classCount: 10,
    });
    expect(profile.config).toEqual({
      ...planConfig,
      performancePositiveLabel: "1",
    });
  });

  it("leave the chance baseline out only with a recorded rationale", () => {
    const plan = recallPlan();
    plan.criteria[0].rationale = "Recall alone is the contractual criterion";
    const profile = registerProfile(
      e,
      planProtocol({ statistics: plan }),
      "auditor",
    );
    expect(profile.statistics!.criteria[0].members).toHaveLength(1);
  });

  it("reject minimums below the floors, invalid bands, a mismatched suite and undeclared labels", () => {
    expect(
      thrown(() =>
        registerProfile(
          e,
          planProtocol({
            statistics: { ...recallPlan(), minimums: { sampleSize: 20 } },
          }),
          "auditor",
        ),
      ).message,
    ).toMatch(/platform floor/);
    expect(
      thrown(() =>
        registerProfile(
          e,
          planProtocol({ statistics: recallPlan(1) }),
          "auditor",
        ),
      ).message,
    ).toMatch(/strictly inside/);
    expect(
      thrown(() =>
        registerProfile(
          e,
          planProtocol({ suite: ["performance", "demographic_parity"] }),
          "auditor",
        ),
      ).message,
    ).toMatch(/families of its plan/);
    expect(
      thrown(() =>
        registerProfile(
          e,
          planProtocol({ config: { ...planConfig, negativeLabel: "" } }),
          "auditor",
        ),
      ).message,
    ).toMatch(/two distinct labels/);
    expect(
      thrown(() =>
        registerProfile(
          e,
          planProtocol({
            task: "Multiclass classification",
            statistics: {
              criteria: [
                {
                  id: "performance",
                  kind: "multiclass_performance",
                  members: [{ metric: "accuracy", band: { lower: 0.8 } }],
                },
              ],
            },
          }),
          "auditor",
        ),
      ).message,
    ).toMatch(/1\/k/);
  });

  it("need a new protocol version to change the plan after it is saved", () => {
    const first = registerProfile(e, planProtocol(), "auditor");
    const changed = planProtocol({ statistics: recallPlan(0.6) });
    const conflict = thrown(() => registerProfile(e, changed, "auditor"));
    expect(conflict.status).toBe(409);
    expect(conflict.message).toMatch(/create a new version/);
    const revised = registerProfile(
      e,
      { ...changed, version: "1.1" },
      "auditor",
    );
    expect(revised.id).not.toBe(first.id);
    expect(revised.statistics!.criteria[0].members![0].band.lower).toBe(0.6);
    // The first version still holds its plan, untouched.
    expect(first.statistics!.criteria[0].members![0].band.lower).toBe(0.7);
  });

  it("freeze the plan and its hash into the run manifest, and detect a changed plan", async () => {
    const profile = registerProfile(e, planProtocol(), "auditor");
    const run = await queueEvaluation(
      e,
      { modelId: "MODEL-1", datasetId: "EV-1", profileId: profile.id },
      "auditor",
    );
    expect(run.contractVersion).toBe("1.4");
    expect(run.manifest!.statistics).toEqual(profile.statistics);
    expect(run.provenance.inputHashes.statisticsPlan).toBe(
      planSha256(profile.statistics!),
    );
    await expect(executionCSV(e, run)).resolves.toBeTruthy();
    // The manifest pin covers the plan; the plan's own hash pins it too.
    run.manifest!.statistics!.criteria[0].members![0].band.lower = 0.1;
    await expect(verifyFrozenInputs(e, run)).rejects.toThrow(
      /integrity check failed/,
    );
    run.provenance.inputHashes.manifest = await sha256Text(
      JSON.stringify(run.manifest),
    );
    await expect(verifyFrozenInputs(e, run)).rejects.toThrow(
      "Frozen statistics plan integrity check failed",
    );
  });

  it("freeze the derived plan of a legacy protocol with its configured minimums", async () => {
    const profile = registerProfile(e, binaryProtocol(), "auditor");
    const run = await queueEvaluation(
      e,
      { modelId: "MODEL-1", datasetId: "EV-1", profileId: profile.id },
      "auditor",
    );
    expect(run.manifest!.statistics).toMatchObject({
      derivedFrom: { source: "hosted_config", contractVersion: "1.1" },
      minimums: { sampleSize: 30, groupSize: 30, classCount: 10 },
      configuredMinimums: { sampleSize: 20, groupSize: 5, classCount: 5 },
    });
  });
});
