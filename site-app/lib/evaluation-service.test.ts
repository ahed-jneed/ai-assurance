import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { sha256 as sha256Text } from "./ids";
import { planSha256 } from "./statistics";
import { externalGate, type SpecialCategoryBasis } from "./special-category";

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
    // Synthetic groups: not special-category data.
    specialCategory: { specialCategory: false },
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

  it("accept a cluster design in its own column (#136)", () => {
    const profile = registerProfile(
      e,
      planProtocol({
        version: "cluster-1",
        statistics: { ...recallPlan(), clusterField: "person" },
      }),
      "auditor",
    );
    expect(profile.statistics!.clusterField).toBe("person");
    expect(
      thrown(() =>
        registerProfile(
          e,
          planProtocol({
            version: "cluster-2",
            statistics: { ...recallPlan(), clusterField: "actual" },
          }),
          "auditor",
        ),
      ).message,
    ).toMatch(/cluster column/);
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

describe("special-category fairness data (#60)", () => {
  // The client's GDPR Art 9(2) basis for the group column, as recorded.
  const basis: SpecialCategoryBasis = {
    id: "BASIS-1",
    kind: "gdpr_art9",
    point: "g",
    statement: "Substantial public interest under national equality law",
    columns: ["group"],
    confirmedBy: "Client DPO",
    confirmedOn: "2026-11-01",
    recordedBy: "auditor",
    recordedAt: "2026-11-02T09:00:00.000Z",
  };
  const special = (
    version: string,
    specialCategory: Record<string, unknown> = {},
  ) =>
    binaryProtocol({
      version,
      suite: ["demographic_parity"],
      // The special-category floor (#134).
      config: { ...criteria, groupColumn: "group", minimumGroupSize: 50 },
      datasetContext: { ...context, sensitiveDataBasis: "Client DPIA" },
      specialCategory,
    });
  const queue = (profileId: string, acknowledge = false) =>
    queueEvaluation(
      e,
      {
        modelId: "MODEL-1",
        datasetId: "EV-1",
        profileId,
        ...(acknowledge ? { acknowledgeSpecialCategory: true } : {}),
      },
      "auditor",
    );

  it("declares the group column special-category and client-side by default", () => {
    const p = registerProfile(e, special("1.0"), "auditor");
    expect(p.specialCategory).toMatchObject({
      column: "group",
      specialCategory: true,
      route: "client_side",
      basis: null,
      declaredBy: "auditor",
    });
  });

  it("refuses a hosted run with special-category columns and no basis", async () => {
    const clientSide = registerProfile(e, special("1.0"), "auditor");
    const refused = await rejection(queue(clientSide.id, true));
    expect(refused.status).toBe(409);
    expect(refused.message).toContain("run client-side by default");
    // The hosted route itself needs a recorded basis.
    expect(() =>
      registerProfile(e, special("2.0", { route: "hosted" }), "auditor"),
    ).toThrow(/needs the client's recorded Art 4a or GDPR Art 9\(2\) basis/);
    expect(e.runs).toEqual([]);
  });

  it("refuses a basis that does not cover the group column", () => {
    e.specialCategoryBases = [{ ...basis, columns: ["ethnicity"] }];
    expect(() =>
      registerProfile(
        e,
        special("1.0", { route: "hosted", basisId: "BASIS-1" }),
        "auditor",
      ),
    ).toThrow(/covers the group column group/);
  });

  it("runs with a basis and an acknowledgement, freezing the basis with the run", async () => {
    e.specialCategoryBases = [basis];
    const p = registerProfile(
      e,
      special("1.0", { route: "hosted", basisId: "BASIS-1" }),
      "auditor",
    );
    // The basis is stored with the protocol as recorded.
    expect(p.specialCategory?.basis).toEqual(basis);
    const unacknowledged = await rejection(queue(p.id));
    expect(unacknowledged.message).toContain("Acknowledge");
    const run = await queue(p.id, true);
    expect(run.state).toBe("queued");
    expect(run.manifest?.profile?.specialCategory?.basis).toEqual(basis);
    expect(run.manifest?.specialCategoryAcknowledgement).toMatchObject({
      column: "group",
      acknowledgedBy: "auditor",
    });
    expect(run.manifest?.limitations.at(-1)).toBe(
      "Special-category column group was processed on the platform under GDPR Art 9(2)(g): Substantial public interest under Union or Member State law; confirmed by Client DPO on 2026-11-01; basis BASIS-1.",
    );
    // A later change to the engagement's register does not reach the run.
    e.specialCategoryBases[0].confirmedBy = "Someone else";
    expect(run.manifest?.profile?.specialCategory?.basis?.confirmedBy).toBe(
      "Client DPO",
    );
    await expect(executionCSV(e, run)).resolves.toMatchObject({
      csv: predictions,
    });
    // A retry repeats the frozen request and carries the acknowledgement
    // over as given, naming the source run: the person who retries gave none.
    run.state = "cancelled";
    const retry = await queueRetry(e, run, "lead");
    expect(retry.manifest?.specialCategoryAcknowledgement).toEqual({
      ...run.manifest!.specialCategoryAcknowledgement,
      acknowledgedBy: "auditor",
      inheritedFrom: run.id,
    });
  });

  it("refuses to retry a legacy explicit fairness run on the platform", async () => {
    e.specialCategoryBases = [basis];
    const p = registerProfile(
      e,
      special("1.0", { route: "hosted", basisId: "BASIS-1" }),
      "auditor",
    );
    const frozen = await queue(p.id, true);
    // Explicit-configuration runs predate protocols and declarations.
    const legacy = {
      ...frozen,
      id: "RUN-LEGACY",
      state: "cancelled" as const,
      profileId: undefined,
      manifest: { ...frozen.manifest!, profile: null },
    };
    delete legacy.manifest.specialCategoryAcknowledgement;
    const refused = await rejection(queueRetry(e, legacy, "lead"));
    expect(refused.status).toBe(409);
    expect(refused.message).toContain(
      "This explicit fairness run predates special-category declarations",
    );
  });

  it("refuses hosted runs of fairness protocols saved before declarations", async () => {
    const p = registerProfile(e, special("1.0"), "auditor");
    delete p.specialCategory;
    const refused = await rejection(queue(p.id, true));
    expect(refused.message).toContain("predates special-category declarations");
  });

  it("lets only the client's own worker on a client-held pin run without a basis", () => {
    const p = registerProfile(e, special("1.0"), "auditor");
    expect(() => externalGate(p, "client_local", true)).not.toThrow();
    const refused = thrown(() =>
      externalGate(p, "provided_predictions", false),
    );
    expect(refused.status).toBe(409);
    expect(refused.message).toContain("client-local mode");
    // Client-local on uploaded bytes: the platform holds the column (#102).
    const uploaded = thrown(() => externalGate(p, "client_local", false));
    expect(uploaded.status).toBe(409);
    expect(uploaded.message).toContain(
      "this dataset's bytes are on the platform",
    );
    e.specialCategoryBases = [basis];
    const recorded = registerProfile(
      e,
      special("2.0", { basisId: "BASIS-1" }),
      "auditor",
    );
    expect(() => externalGate(recorded, "auditor_model", false)).not.toThrow();
    expect(() => externalGate(recorded, "client_local", false)).not.toThrow();
  });
});
