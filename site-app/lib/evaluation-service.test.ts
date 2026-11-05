import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact, Engagement, Model } from "./domain";
import { runnerVersion, testDefinitionVersion } from "./evaluation";
import {
  executionCSV,
  queueEvaluation,
  queueRetry,
  registerProfile,
  verifyFrozenInputs,
} from "./evaluation-service";
import { ApiError } from "./http";

// Evidence bytes by R2 key; Node has no Worker bindings.
const objects = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("cloudflare:workers", () => ({
  env: {
    BUCKET: {
      async get(key: string) {
        const bytes = objects.get(key);
        return bytes
          ? { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }
          : null;
      },
    },
  },
}));

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
async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
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
