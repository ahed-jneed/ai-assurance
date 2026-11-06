import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssuranceRecord } from "../assurance-core";
import type { Artifact, Engagement, Model } from "../domain";
import { registerProfile, verifyFrozenInputs } from "../evaluation-service";
import { ApiError } from "../http";
import { sha256 } from "../ids";
import { substantivePlan } from "../workflow/command";
import { approvedWorkflow, procedureId } from "../workflow/test-fixtures";
import { seedWorkflow } from "../workflow-seed";
import type { Procedure } from "../workflow-types";
import { runs } from "./runs";
import { caller } from "./test-fixtures";

// Registered assurance records by id, as recordsById reads them from D1.
const records = new Map<string, AssuranceRecord>();
vi.mock("../assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assurance-store")>()),
  recordsById: async (_ctx: unknown, _engagementId: string, ids: string[]) =>
    ids.flatMap((id) => (records.has(id) ? [records.get(id)!] : [])),
}));

// Prediction bytes by R2 key, served as the BUCKET binding of the shared
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
  "actual,predicted\n" +
  Array.from({ length: 40 }, (_, i) => `${i % 2},${i % 2}`).join("\n");
const ctx = caller("Auditor");

let e: Engagement;
const procedure = () =>
  e.workflow!.procedures.find((p) => p.id === procedureId) as Procedure;
const other = () =>
  e.workflow!.procedures.find((p) => p.id !== procedureId) as Procedure;
beforeEach(async () => {
  const bytes = new TextEncoder().encode(predictions),
    digest = await sha256(bytes.buffer as ArrayBuffer);
  objects.clear();
  records.clear();
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
        sha256: digest,
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
        sourceSha256: digest,
      } as Model,
    ],
    evaluationProfiles: [],
    runs: [],
    workflow: approvedWorkflow(seedWorkflow("lead", "2026-11-05").procedures),
  } as unknown as Engagement;
  const profile = registerProfile(
    e,
    {
      name: "Binary acceptance",
      version: "1.0",
      task: "Binary classification",
      suite: ["performance"],
      config: {
        labelColumn: "actual",
        predictionColumn: "predicted",
        groupColumn: "",
        positiveLabel: "1",
        minimumGroupSize: 5,
        maximumParityGap: 0.2,
        minimumImpactRatio: 0.8,
        minimumAccuracy: 0.7,
      },
      datasetContext: {
        split: "test",
        population: "Synthetic applicants",
        predictionProvenance: "Exported by the provider",
        independence: "Holdout declared by the provider",
        sensitiveDataBasis: "",
      },
      rationale: "Internal acceptance rule",
    },
    "auditor",
  );
  Object.assign(procedure(), {
    selected: true,
    applicability: "readiness",
    method: "automated",
    modelId: "MODEL-1",
    datasetId: "EV-1",
    profileId: profile.id,
  });
});
afterEach(() => {
  delete env.BUCKET;
});

const plannedRun = { modelId: "MODEL-1", datasetId: "EV-1" };
/** Queues the procedure's planned run and cancels it, ready for a retry. */
async function cancelledRun() {
  const details = await command("queueRun", {
    ...plannedRun,
    profileId: procedure().profileId,
    procedureId,
  });
  const run = e.runs.find((r) => r.id === details.runId)!;
  run.state = "cancelled";
  return run;
}
/** Runs an op of the module and returns its audit event details. */
async function command(op: string, data: Record<string, unknown>) {
  const result = await runs.run(e, op, data, ctx);
  if (!("details" in result)) throw new Error(op + " saved the engagement");
  return result.details;
}
const retry = (runId: string) => command("retryRun", { runId });
/** Registers a dataset card for the accepted prediction bytes. */
function registerCard(id = "CARD-1") {
  const card: AssuranceRecord = {
    id,
    kind: "dataset",
    sha256: "c".repeat(64),
    createdAt: "2026-11-05T00:00:00.000Z",
    actor: "auditor",
    body: {
      name: "Applicants",
      version: "1",
      artifactId: "EV-1",
      artifactSha256: e.artifacts[0].sha256,
    },
  };
  records.set(id, card);
  return card;
}
async function conflict(promise: Promise<unknown>, message: string | RegExp) {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(409);
  expect((error as ApiError).message).toMatch(message);
}
async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(409);
  expect((error as ApiError).message).toBe(
    "The audit scope or procedure changed. Queue a new planned evaluation",
  );
}
/** A substantive change to another procedure, approved in a new program revision. */
function changeAnotherProcedure() {
  const q = other();
  q.rationale = "Revised by another procedure's plan change";
  q.revision++;
  e.workflow!.program.revision++;
}

describe("planned runs", () => {
  it("bind the procedure's plan hash, plan revision and scope revision", async () => {
    const run = await cancelledRun(),
      p = procedure();
    expect(p.planHash).toBe(await sha256(JSON.stringify(substantivePlan(p))));
    expect(run.procedureBinding).toEqual({
      procedureId,
      procedureRevision: p.revision,
      planHash: p.planHash,
      briefRevision: 1,
      programRevision: e.workflow!.program.revision,
    });
    expect(run.provenance.inputHashes.auditBinding).toBe(
      await sha256(JSON.stringify(run.procedureBinding)),
    );
  });
});

describe("queueRun", () => {
  const planned = () => ({
    ...plannedRun,
    profileId: procedure().profileId,
    procedureId,
  });

  it("pins a dataset card for the evaluated bytes into the manifest", async () => {
    const card = registerCard();
    const details = await command("queueRun", {
      ...planned(),
      datasetCardRecordId: card.id,
    });
    const run = e.runs.find((r) => r.id === details.runId)!;
    expect(run.manifest?.dataset.cardPin).toEqual({
      recordId: card.id,
      sha256: card.sha256,
      card: card.body,
    });
    await expect(verifyFrozenInputs(e, run)).resolves.toBeDefined();
  });

  it("refuses a card for other bytes", async () => {
    const card = registerCard();
    card.body.artifactSha256 = "0".repeat(64);
    await conflict(
      command("queueRun", { ...planned(), datasetCardRecordId: card.id }),
      "The dataset card must match the accepted evaluation bytes",
    );
    expect(e.runs).toHaveLength(0);
  });

  it("refuses a second planned run while one is queued or running", async () => {
    const first = await command("queueRun", planned());
    await conflict(
      command("queueRun", planned()),
      `Evaluation ${first.runId} of this procedure is already queued`,
    );
    e.runs[0].state = "running";
    await conflict(command("queueRun", planned()), /already running/);
    expect(e.runs).toHaveLength(1);
    // Once it ends, the procedure can be evaluated again.
    e.runs[0].state = "failed";
    await expect(command("queueRun", planned())).resolves.toHaveProperty(
      "runId",
    );
  });

  it("still queues unbound runs of the same inputs", async () => {
    await command("queueRun", planned());
    await expect(
      command("queueRun", {
        ...plannedRun,
        profileId: procedure().profileId,
      }),
    ).resolves.toHaveProperty("runId");
  });
});

describe("retryRun", () => {
  it("keeps the source's dataset card pin and rehashes the manifest", async () => {
    const card = registerCard();
    const queued = await command("queueRun", {
      ...plannedRun,
      profileId: procedure().profileId,
      procedureId,
      datasetCardRecordId: card.id,
    });
    const source = e.runs.find((r) => r.id === queued.runId)!;
    source.state = "failed";
    const details = await retry(source.id);
    const copy = e.runs.find((r) => r.id === details.runId)!;
    expect(copy.manifest?.dataset.cardPin).toEqual(
      source.manifest?.dataset.cardPin,
    );
    await expect(verifyFrozenInputs(e, copy)).resolves.toBeDefined();
  });

  it("refuses a retry whose pinned card changed", async () => {
    const card = registerCard();
    const queued = await command("queueRun", {
      ...plannedRun,
      profileId: procedure().profileId,
      procedureId,
      datasetCardRecordId: card.id,
    });
    const source = e.runs.find((r) => r.id === queued.runId)!;
    source.state = "cancelled";
    const message = /dataset card pinned to this run changed/;
    records.set(card.id, { ...card, sha256: "d".repeat(64) });
    await conflict(retry(source.id), message);
    records.set(card.id, {
      ...card,
      body: { ...card.body, artifactId: "EV-2" },
    });
    await conflict(retry(source.id), message);
    records.delete(card.id);
    await conflict(retry(source.id), message);
    expect(e.runs).toHaveLength(1);
  });

  it("refuses a retry of a bound run while the procedure has an active run", async () => {
    const source = await cancelledRun();
    const active = await command("queueRun", {
      ...plannedRun,
      profileId: procedure().profileId,
      procedureId,
    });
    await conflict(
      retry(source.id),
      `Evaluation ${active.runId} of this procedure is already queued`,
    );
  });

  it("retries a run of an unchanged procedure after another procedure changed the program", async () => {
    const source = await cancelledRun();
    changeAnotherProcedure();
    const details = await retry(source.id);
    const copy = e.runs.find((r) => r.id === details.runId)!;
    expect(copy.retryOf).toBe(source.id);
    expect(copy.procedureBinding).toEqual(source.procedureBinding);
  });

  it("retries a run whose procedure plan was changed and restored", async () => {
    const source = await cancelledRun();
    // The revision moved twice; the plan content, and its hash, did not.
    procedure().revision += 2;
    e.workflow!.program.revision++;
    await expect(retry(source.id)).resolves.toMatchObject({
      retryOf: source.id,
    });
  });

  it("refuses a retry after the procedure's own plan changed", async () => {
    const source = await cancelledRun(),
      p = procedure();
    p.sampling = "A different sample";
    p.planHash = await sha256(JSON.stringify(substantivePlan(p)));
    p.revision++;
    e.workflow!.program.revision++;
    await refusal(retry(source.id));
  });

  it("refuses a retry after the scope changed", async () => {
    const source = await cancelledRun();
    e.workflow!.brief!.revision++;
    await refusal(retry(source.id));
  });

  it("refuses a retry while the program awaits approval", async () => {
    const source = await cancelledRun();
    changeAnotherProcedure();
    e.workflow!.program.status = "draft";
    await refusal(retry(source.id));
  });

  it("binds a run queued before runs recorded plan hashes by its plan revision", async () => {
    const source = await cancelledRun();
    const { planHash, ...legacy } = source.procedureBinding!;
    expect(planHash).toBeDefined();
    source.procedureBinding = legacy;
    source.provenance.inputHashes.auditBinding = await sha256(
      JSON.stringify(legacy),
    );
    changeAnotherProcedure();
    await expect(retry(source.id)).resolves.toMatchObject({
      retryOf: source.id,
    });
    // The same plan content under a later revision is not provable for it.
    procedure().revision++;
    await refusal(retry(source.id));
  });
});
