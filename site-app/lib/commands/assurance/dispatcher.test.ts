import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/assurance/route";
import { locationSchema, type AssuranceRecord } from "@/lib/assurance-core";
import {
  addRecord,
  jobs,
  recordCount,
  recordPage,
  recordsById,
  recordStatement,
} from "@/lib/assurance-store";
import {
  assuranceModules,
  assuranceTarget,
  dispatchAssurance,
} from "@/lib/commands/assurance";
import {
  roles,
  type Artifact,
  type Engagement,
  type EvaluationProfile,
  type Model,
  type Role,
} from "@/lib/domain";
import { getEngagement, loadEngagement, save } from "@/lib/engagement-repo";
import { ApiError } from "@/lib/http";
import { sha256 } from "@/lib/ids";
import type { assuranceView } from "@/lib/read-models/assurance-view";
import { context, type Context } from "@/lib/tenancy";
import { at, declaration } from "@/lib/workflow/test-fixtures";
import { seedWorkflow } from "@/lib/workflow-seed";
import { caller, fakeD1, postRequest, stored } from "../test-fixtures";

// Identity, persistence and the assurance record store are faked per test.
vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(),
}));
vi.mock("@/lib/engagement-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/engagement-repo")>()),
  getEngagement: vi.fn(),
  loadEngagement: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assurance-store")>()),
  recordPage: vi.fn(),
  recordCount: vi.fn(),
  recordsById: vi.fn(),
  addRecord: vi.fn(),
  recordStatement: vi.fn(),
  jobs: vi.fn(),
}));

const dataset: Artifact = {
  id: "EV-1",
  name: "applicants.csv",
  category: "Dataset",
  size: 120,
  sha256: "a".repeat(64),
  key: "tenant-1/ENG-1/EV-1",
  createdAt: "2026-11-05T09:00:00.000Z",
  uploadedBy: "user-lead",
  visibility: "internal",
  status: "accepted",
  mediaType: "text/csv",
};
const location = {
  artifactId: "EV-1",
  label: "Approval rule",
  kind: "dataset",
  locator: "rows 1-20",
  excerpt: "approved = score > 600",
  quality: "Transcribed from the accepted source",
};
function written(
  kind: string,
  body: Record<string, unknown>,
  id = "AS-1",
  actor = "user-lead",
): AssuranceRecord {
  return {
    id,
    kind,
    body,
    sha256: "b".repeat(64),
    createdAt: "2026-11-05T10:00:00.000Z",
    actor,
  };
}
function load(e: Engagement, ctx: Context = caller()) {
  vi.mocked(context).mockResolvedValue(ctx);
  vi.mocked(getEngagement).mockResolvedValue(e);
  vi.mocked(loadEngagement).mockResolvedValue(e);
  vi.mocked(recordPage).mockResolvedValue({ records: [], nextCursor: null });
  vi.mocked(recordCount).mockResolvedValue(0);
  vi.mocked(recordsById).mockResolvedValue([]);
  vi.mocked(jobs).mockResolvedValue([]);
}
function post(e: Engagement, op: string, data: Record<string, unknown> = {}) {
  return POST(
    postRequest("/api/assurance", {
      tenantId: "tenant-1",
      engagementId: e.id,
      op,
      data,
    }),
  );
}
function statements() {
  vi.mocked(recordStatement).mockImplementation(
    async (_ctx, _id, kind, body) => ({
      statement: {} as D1PreparedStatement,
      guarded: () => ({}) as D1PreparedStatement,
      record: written(kind, body),
    }),
  );
}
const refusal = { error: "Your role cannot perform this action" };
const internalOnly = { error: "The assurance workbench is internal" };

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  delete env.DB;
});

describe("POST /api/assurance", () => {
  it.each(["archiveEverything", "toString", "__proto__", "createPaper"])(
    "rejects the unknown op %s with 400 and writes nothing",
    async (op) => {
      const e = stored();
      load(e);
      const response = await post(e, op);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Unknown assurance action",
      });
      expect(addRecord).not.toHaveBeenCalled();
      expect(recordStatement).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each(["Client Viewer", "Client Contributor"] as Role[])(
    "refuses %s with 403 before dispatching, whatever the op",
    async (role) => {
      const e = stored();
      load(e, caller(role));
      // F-56: a Client Viewer is refused every op the bus accepts.
      const ops =
        role === "Client Viewer"
          ? [...assuranceModules.flatMap((m) => m.ops), "archiveEverything"]
          : ["addLocation", "assist", "archiveEverything"];
      for (const op of ops) {
        const response = await post(e, op, location);
        expect(response.status, op).toBe(403);
        expect(await response.json(), op).toEqual(
          role === "Client Viewer"
            ? { error: "Client Viewers have read-only access" }
            : internalOnly,
        );
      }
      expect(getEngagement).not.toHaveBeenCalled();
      expect(addRecord).not.toHaveBeenCalled();
      expect(recordsById).not.toHaveBeenCalled();
    },
  );

  it("checks the op's roles before validating its data", async () => {
    const e = stored();
    load(e, caller("Reviewer"));
    const register = await post(e, "registerSystem", { name: "" });
    expect(register.status).toBe(403);
    expect(await register.json()).toEqual(refusal);
    const assist = await post(e, "assist", { sourceIds: [] });
    expect(assist.status).toBe(403);
    expect(await assist.json()).toEqual(refusal);
    load(e, caller("Auditor"));
    const review = await post(e, "reviewAssertion", { assertionId: "" });
    expect(review.status).toBe(403);
    expect(await review.json()).toEqual(refusal);
    expect(addRecord).not.toHaveBeenCalled();
    expect(recordsById).not.toHaveBeenCalled();
  });

  it("answers invalid data with the zod messages and no paths", async () => {
    const e = stored();
    load(e, caller("Auditor"));
    const response = await post(e, "addLocation", { artifactId: "EV-1" });
    expect(response.status).toBe(400);
    const parsed = locationSchema.safeParse({ artifactId: "EV-1" });
    expect(parsed.success).toBe(false);
    expect(await response.json()).toEqual({
      error: parsed.error!.issues.map((i) => i.message).join("; "),
    });
  });

  it("answers the record an op wrote as { record }, uncached", async () => {
    const e = stored();
    e.artifacts.push(dataset);
    const ctx = caller("Auditor");
    load(e, ctx);
    vi.mocked(addRecord).mockImplementation(async (_ctx, _id, kind, body) =>
      written(kind, body),
    );
    const response = await post(e, "addLocation", location);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = {
      ...location,
      parser: "manual-transcription",
      artifactSha256: dataset.sha256,
      artifactName: dataset.name,
      visibility: dataset.visibility,
    };
    expect(await response.json()).toEqual({
      record: written("location", body),
    });
    expect(addRecord).toHaveBeenCalledWith(ctx, e.id, "location", body);
    // An op that names no record loads none.
    expect(recordsById).not.toHaveBeenCalled();
    expect(recordPage).not.toHaveBeenCalled();
  });

  it("loads only the records an op names", async () => {
    const e = stored();
    const ctx = caller("Reviewer");
    load(e, ctx);
    const assertion = written(
      "assertion",
      { statement: "Approvals follow the policy" },
      "AS-7",
      "user-auditor",
    );
    vi.mocked(recordsById).mockResolvedValue([assertion]);
    vi.mocked(addRecord).mockImplementation(async (_ctx, _id, kind, body) =>
      written(kind, body, "AS-8"),
    );
    const response = await post(e, "reviewAssertion", {
      assertionId: "AS-7",
      decision: "approve",
      reason: "Independent source review",
    });
    expect(response.status).toBe(200);
    expect(recordsById).toHaveBeenCalledTimes(1);
    expect(recordsById).toHaveBeenCalledWith(ctx, e.id, ["AS-7"]);
    expect(recordPage).not.toHaveBeenCalled();
    expect(addRecord).toHaveBeenCalledWith(ctx, e.id, "assertion_review", {
      assertionId: "AS-7",
      decision: "approve",
      reason: "Independent source review",
      assertionSha256: assertion.sha256,
    });
    // A record of another kind, or none, is not a review target.
    vi.mocked(recordsById).mockResolvedValue([
      written("location", location, "AS-7"),
    ]);
    const wrongKind = await post(e, "reviewAssertion", {
      assertionId: "AS-7",
      decision: "approve",
      reason: "Independent source review",
    });
    expect(wrongKind.status).toBe(400);
    expect(await wrongKind.json()).toEqual({
      error: "Select an existing assertion record",
    });
  });

  it("answers assist on unknown or non-source records with 400", async () => {
    const e = stored();
    const ctx = caller("Auditor");
    load(e, ctx);
    const assertion = written(
        "assertion",
        { statement: "Approvals follow the policy", relations: [] },
        "AS-7",
      ),
      system = written("system", { modelIds: [] }, "AS-9");
    vi.mocked(recordsById).mockImplementation(async (_ctx, _id, ids) =>
      [assertion, system].filter((r) => ids.includes(r.id)),
    );
    vi.mocked(addRecord).mockImplementation(async (_ctx, _id, kind, body) =>
      written(kind, body, "AS-10"),
    );
    const cases: [string[], string][] = [
      [
        ["AS-404"],
        "Select existing evidence locations or assertions; unknown record: AS-404",
      ],
      [
        ["AS-7", "AS-404", "AS-404"],
        "Select existing evidence locations or assertions; unknown record: AS-404",
      ],
      [
        ["AS-9"],
        "Select evidence locations or assertions only; not a source record: AS-9 (system)",
      ],
      [
        ["AS-7", "AS-9"],
        "Select evidence locations or assertions only; not a source record: AS-9 (system)",
      ],
    ];
    for (const [sourceIds, error] of cases) {
      const response = await post(e, "assist", {
        sourceIds,
        action: "unsupported",
      });
      expect(response.status, sourceIds.join()).toBe(400);
      expect(await response.json(), sourceIds.join()).toEqual({ error });
    }
    expect(addRecord).not.toHaveBeenCalled();
    // Only the selection was loaded, never the records it would cite.
    expect(recordsById).toHaveBeenCalledTimes(cases.length);
    // A selection of source records still writes its briefing.
    const ok = await post(e, "assist", {
      sourceIds: ["AS-7"],
      action: "unsupported",
    });
    expect(ok.status).toBe(200);
    expect(addRecord).toHaveBeenCalledWith(
      ctx,
      e.id,
      "assistant",
      expect.objectContaining({ sourceIds: ["AS-7"] }),
    );
  });

  it("passes through the Response of an op that builds its own", async () => {
    const e = stored();
    load(e);
    statements();
    const response = await post(e, "enrollWorker", {
      name: "Runner",
      imageDigest: "sha256:" + "4".repeat(64),
      formats: ["ONNX"],
      securityReview: "Reviewed the image and its adapters",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const reply = (await response.json()) as Record<string, string>;
    expect(Object.keys(reply).sort()).toEqual(["notice", "token", "workerId"]);
    expect(reply.workerId).toMatch(/^WORKER-/);
    expect(reply.token).toHaveLength(72);
    expect(save).toHaveBeenCalledTimes(1);
    expect(vi.mocked(save).mock.calls[0].slice(2, 5)).toEqual([
      3,
      "enrollWorker",
      { workerId: reply.workerId },
    ]);
  });

  // An approved procedure ready for an external job on `data`.
  function externalFixture(data: Artifact = dataset) {
    const e = stored();
    const model: Model = {
        id: "MODEL-1",
        name: "Scorer",
        version: "1",
        format: "Prediction file",
        task: "Binary classification",
        intendedPurpose: "Credit decisions",
        artifactId: "EV-2",
        status: "registered",
        sourceSha256: "c".repeat(64),
      },
      profile = {
        id: "PROFILE-1",
        version: "1",
        task: "Binary classification",
        suite: ["performance"],
        config: { positiveLabel: "1" },
      } as EvaluationProfile;
    e.artifacts.push(data, {
      ...dataset,
      id: "EV-2",
      name: "scores.csv",
      sha256: model.sourceSha256!,
    });
    e.models.push(model);
    e.evaluationProfiles = [profile];
    e.workflow = {
      brief: { status: "approved", revision: 2 },
      program: { status: "approved", revision: 3 },
      procedures: [
        {
          id: "PROC-1",
          revision: 1,
          instructions: [],
          selected: true,
          applicability: "applicable",
          modelId: model.id,
          datasetId: dataset.id,
          profileId: profile.id,
        },
      ],
    } as unknown as Engagement["workflow"];
    const ctx = caller("Auditor");
    load(e, ctx);
    statements();
    const system = written(
        "system",
        {
          modelIds: [model.id],
          modelPins: [{ id: model.id, sha256: model.sourceSha256 }],
          features: [],
          outputs: { classOrder: ["0", "1"], threshold: 0.5 },
        },
        "AS-SYSTEM",
      ),
      prediction = written(
        "prediction",
        {
          modelId: model.id,
          systemId: system.id,
          datasetId: dataset.id,
          datasetSha256: dataset.sha256,
        },
        "AS-PREDICTION",
      );
    vi.mocked(recordsById).mockImplementation(async (_ctx, _id, ids) =>
      [system, prediction].filter((r) => ids.includes(r.id)),
    );
    return {
      e,
      system,
      prediction,
      queue: (mode: string) =>
        post(e, "queueExternal", {
          systemId: system.id,
          modelId: model.id,
          datasetId: dataset.id,
          profileId: profile.id,
          procedureId: "PROC-1",
          mode,
          predictionId: prediction.id,
        }),
    };
  }

  it("freezes an external job and answers it uncached", async () => {
    const { e, system, prediction, queue } = externalFixture();
    const response = await queue("provided_predictions");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const reply = (await response.json()) as Record<string, string>;
    expect(reply.jobId).toMatch(/^JOB-/);
    expect(reply.requestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(vi.mocked(recordsById).mock.calls.map((c) => c[2])).toEqual([
      [system.id],
      [prediction.id],
    ]);
    expect(vi.mocked(save).mock.calls[0].slice(3, 5)).toEqual([
      "freezeExternalExecution",
      { jobId: reply.jobId, requestSha256: reply.requestSha256 },
    ]);
    // The job binds the plan content: a procedure planned before plan hashes
    // keeps the hash it was queued with (#105).
    expect(e.workflow!.procedures[0].planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("queues a client-held dataset pin only in client-local mode (#102)", async () => {
    const { queue } = externalFixture({
      ...dataset,
      key: "",
      custody: "client",
    });
    for (const mode of ["provided_predictions", "auditor_model"]) {
      const refused = await queue(mode);
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: string }).error).toContain(
        "held by the client: queue it in client-local mode",
      );
    }
    expect(save).not.toHaveBeenCalled();
    expect((await queue("client_local")).status).toBe(200);
    // The frozen request carries the custody, so no worker downloads it.
    const { db } = fakeD1();
    env.DB = db;
    const batch = vi.mocked(save).mock.calls[0][5] as unknown as (
      cmd: string,
    ) => { sql: string; args: unknown[] }[];
    const insert = batch("CMD-1").find((s) =>
      s.sql.startsWith("INSERT INTO execution_jobs"),
    )!;
    const frozen = JSON.parse(String(insert.args[3]));
    expect(frozen.executionMode).toBe("client_local");
    expect(frozen.dataset).toMatchObject({
      id: dataset.id,
      sha256: dataset.sha256,
      size: dataset.size,
      custody: "client",
    });
    expect(frozen.limitations.at(-1)).toContain(
      "The dataset stays in the client's environment",
    );
  });

  it.each([
    ["client", "platform"],
    ["platform", "client"],
    ["client", undefined],
  ] as const)(
    "importJob refuses a result whose custody differs from the frozen %s request (#102)",
    async (frozenCustody, stated) => {
      const e = stored();
      // The job binds the procedure's current plan, so only the custody
      // differs (#123).
      e.workflow = {
        brief: { status: "approved", revision: 2 },
        program: { status: "approved", revision: 3 },
        procedures: [{ id: "PROC-1", revision: 1, planHash: "a".repeat(64) }],
      } as unknown as Engagement["workflow"];
      load(e);
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: "1.0",
          hostedResults: [
            { testId: "performance", outcome: "pass", metrics: [] },
          ],
          provenance: {
            execution: stated ? { datasetCustody: stated } : {},
          },
        }),
      );
      const job = {
        id: "JOB-1",
        state: "succeeded",
        result_key: "results/JOB-1",
        result_sha256: await sha256(bytes.buffer as ArrayBuffer),
        request: JSON.stringify({
          dataset: {
            id: dataset.id,
            ...(frozenCustody === "client" ? { custody: "client" } : {}),
          },
          engineConfig: {},
          procedure: {
            id: "PROC-1",
            revision: 1,
            planHash: "a".repeat(64),
            briefRevision: 2,
          },
        }),
      };
      env.DB = fakeD1((sql) =>
        sql.includes("FROM execution_jobs") ? job : null,
      ).db;
      env.BUCKET = {
        get: async () => ({ arrayBuffer: async () => bytes.buffer }),
      } as unknown as R2Bucket;
      try {
        const response = await post(e, "importJob", { jobId: job.id });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: "The result's dataset custody differs from the frozen request",
        });
        expect(save).not.toHaveBeenCalled();
      } finally {
        delete env.BUCKET;
      }
    },
  );
});

describe("GET /api/assurance", () => {
  function get(e: Engagement, query: Record<string, string> = {}) {
    return GET(
      new Request(
        "https://workspace.test/api/assurance?" +
          new URLSearchParams({
            tenantId: "tenant-1",
            engagementId: e.id,
            ...query,
          }),
      ),
    );
  }

  it.each(["Client Viewer", "Client Contributor"] as Role[])(
    "refuses %s before loading any assurance data",
    async (role) => {
      const e = stored();
      load(e, caller(role));
      const queries: Record<string, string>[] = [
        {},
        { cursor: "next" },
        { kind: "dossier" },
      ];
      for (const query of queries) {
        const response = await get(e, query);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual(internalOnly);
      }
      expect(recordPage).not.toHaveBeenCalled();
      expect(recordCount).not.toHaveBeenCalled();
      expect(jobs).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["Lead Auditor", 1],
    ["Auditor", 0],
    ["Reviewer", 0],
  ] as [Role, number][])(
    "loads the workbench with the first page of records for %s",
    async (role, eligible) => {
      const e = stored();
      const ctx = caller(role);
      load(e, ctx);
      const record = written("location", location);
      vi.mocked(recordPage).mockResolvedValue({
        records: [record],
        nextCursor: "page-2",
      });
      vi.mocked(recordCount).mockResolvedValue(1201);
      const past = new Date(Date.now() - 60_000).toISOString(),
        future = new Date(Date.now() + 60_000).toISOString();
      vi.mocked(jobs).mockResolvedValue([
        { id: "JOB-1", state: "queued" },
        { id: "JOB-2", state: "running", lease_until: past },
        { id: "JOB-3", state: "running", lease_until: future },
      ]);
      const rows: Record<string, unknown[]> = {
        runner_workers: [{ id: "WORKER-1", name: "Runner" }],
        engagement_access: [{ user_id: "user-lead", active: 1 }],
        memberships: [{ user_id: "user-2", role: "Auditor" }],
      };
      env.DB = fakeD1(
        (sql) =>
          rows[
            Object.keys(rows).find((table) => sql.includes("FROM " + table))!
          ],
      ).db;
      const response = await get(e);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const view = (await response.json()) as Awaited<
        ReturnType<typeof assuranceView>
      >;
      expect(view).toMatchObject({
        records: [record],
        nextCursor: "page-2",
        total: 1201,
        workers: rows.runner_workers,
        access: rows.engagement_access,
        practiceAdmin: true,
        telemetry: { queued: 1, stalled: 1 },
      });
      expect(recordPage).toHaveBeenCalledWith(ctx, e.id);
      // One execution_jobs query serves the list and the telemetry (#16), and
      // the workbench never loads the engagement's R2 parts.
      expect(jobs).toHaveBeenCalledTimes(1);
      expect(getEngagement).not.toHaveBeenCalled();
      expect(loadEngagement).toHaveBeenCalledWith(ctx, e.id);
      expect(view.jobs).toHaveLength(3);
      expect(view.eligibleMembers).toHaveLength(eligible);
      expect(Object.keys(view.capabilities).sort()).toEqual([
        "anchor",
        "assistant",
        "external",
        "hosted",
        "signing",
      ]);
    },
  );

  it.each([
    [{ cursor: "page-2" }, { kind: "", cursor: "page-2" }],
    [{ kind: "dataset" }, { kind: "dataset", cursor: "" }],
    [
      { kind: "dossier", cursor: "page-3" },
      { kind: "dossier", cursor: "page-3" },
    ],
  ])("answers only the page of records for %o", async (query, options) => {
    const e = stored();
    const ctx = caller("Reviewer");
    load(e, ctx);
    const page = {
      records: [written("dataset", { name: "Applicants" })],
      nextCursor: null,
    };
    vi.mocked(recordPage).mockResolvedValue(page);
    const response = await get(e, query);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(page);
    expect(recordPage).toHaveBeenCalledWith(ctx, e.id, options);
    expect(recordCount).not.toHaveBeenCalled();
    expect(jobs).not.toHaveBeenCalled();
  });
});

describe("setAccess and declared conflicts (#112)", () => {
  function conflicted() {
    const e = stored();
    e.workflow = {
      ...seedWorkflow("user-lead", at),
      declarations: [
        declaration("auditor", {
          userId: "user-2",
          exclusions: ["financial_interest"],
        }),
      ],
    };
    env.DB = fakeD1((sql) =>
      sql.startsWith("SELECT 1 FROM memberships") ? { 1: 1 } : null,
    ).db;
    load(e);
    statements();
    return e;
  }

  it("refuses to grant access to a person with a declared conflict", async () => {
    const e = conflicted();
    const response = await post(e, "setAccess", {
      userId: "user-2",
      active: true,
      reason: "Joins the review",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "This person declared a disqualifying relationship with the engagement and cannot be assigned",
    });
    expect(recordStatement).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("still revokes their access, and grants others", async () => {
    const e = conflicted();
    for (const data of [
      { userId: "user-2", active: false, reason: "Leaves the team" },
      { userId: "user-3", active: true, reason: "Joins the review" },
    ]) {
      const response = await post(e, "setAccess", data);
      expect(response.status, data.userId).toBe(200);
    }
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe("assurance command registry", () => {
  // The ops and role checks of the route's if-chain before the split, except
  // assist: it had no role check of its own (the client-role gate let the
  // three internal roles through) and is now preparer work.
  const allowed: Record<string, Role[]> = {
    setAccess: ["Lead Auditor"],
    enrollWorker: ["Lead Auditor"],
    revokeWorker: ["Lead Auditor"],
    registerSystem: ["Auditor", "Lead Auditor"],
    registerDataset: ["Auditor", "Lead Auditor"],
    registerPrediction: ["Auditor", "Lead Auditor"],
    addLocation: ["Auditor", "Lead Auditor"],
    addAssertion: ["Auditor", "Lead Auditor"],
    reviewAssertion: ["Reviewer", "Lead Auditor"],
    importPacket: ["Auditor", "Lead Auditor"],
    sample: ["Auditor", "Lead Auditor"],
    obligationDecision: ["Auditor", "Lead Auditor"],
    reviewObligation: ["Reviewer", "Lead Auditor"],
    impact: ["Auditor", "Lead Auditor"],
    reviewImpact: ["Reviewer", "Lead Auditor"],
    exportBriefing: ["Auditor", "Lead Auditor"],
    importBriefing: ["Auditor", "Lead Auditor"],
    assist: ["Auditor", "Lead Auditor"],
    acceptAssistant: ["Auditor", "Lead Auditor"],
    queueExternal: ["Auditor", "Lead Auditor"],
    cancelJob: ["Auditor", "Lead Auditor"],
    importJob: ["Auditor", "Lead Auditor"],
  };

  it("lists each accepted op in exactly one module", () => {
    const ops = assuranceModules.flatMap((m) => m.ops);
    expect(new Set(ops).size).toBe(ops.length);
    expect(new Set(ops)).toEqual(new Set(Object.keys(allowed)));
  });

  it.each(Object.entries(allowed))(
    "lets only the permitted roles issue %s",
    async (op, permitted) => {
      for (const role of roles) {
        const ctx = caller(role);
        const outcome = await dispatchAssurance(
          assuranceTarget(stored(), ctx),
          op,
          {},
          ctx,
        ).then(
          () => undefined,
          (error: unknown) => error,
        );
        const refused =
          outcome instanceof ApiError &&
          outcome.status === 403 &&
          outcome.message === refusal.error;
        expect(refused, role).toBe(!permitted.includes(role));
      }
    },
  );
});
