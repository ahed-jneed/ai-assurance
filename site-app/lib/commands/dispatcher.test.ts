import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/workspace/route";
import { commandModules, dispatch } from "@/lib/commands";
import { roles, type Engagement, type Role, type Run } from "@/lib/domain";
import { getEngagement, save } from "@/lib/engagement-repo";
import { evidenceRequestOps } from "@/lib/evidence-requests";
import { freshEngagement } from "@/lib/factories";
import { ApiError } from "@/lib/http";
import { context, type Context } from "@/lib/tenancy";
import { workflowOps } from "@/lib/workflow-service";

// Identity and persistence are faked per test.
vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(),
}));
vi.mock("@/lib/engagement-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/engagement-repo")>()),
  getEngagement: vi.fn(),
  save: vi.fn(),
}));

function caller(role: Role = "Lead Auditor"): Context {
  return {
    user: {
      userId: "user-lead",
      displayName: "Lead",
      email: "lead@fixture.invalid",
    },
    tenantId: "tenant-1",
    role,
    clientId: null,
    practiceAdmin: true,
  };
}
function stored(version = 3): Engagement {
  const e = freshEngagement("CL-1", "Model risk audit", "user-lead");
  e.version = version;
  return e;
}
function envelope(
  e: Engagement,
  op: string,
  data: Record<string, unknown> = {},
  expectedVersion = e.version,
) {
  return {
    tenantId: "tenant-1",
    engagementId: e.id,
    expectedVersion,
    op,
    data,
  };
}
function post(body: Record<string, unknown>) {
  return POST(
    new Request("https://workspace.test/api/workspace", {
      method: "POST",
      headers: {
        origin: "https://workspace.test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}
function load(e: Engagement, ctx = caller()) {
  vi.mocked(context).mockResolvedValue(ctx);
  vi.mocked(getEngagement).mockResolvedValue(e);
  vi.mocked(save).mockImplementation(async (_ctx, saved, expectedVersion) => {
    saved.version = expectedVersion + 1;
    return saved;
  });
}
type Reply = { engagement: Engagement; details?: Record<string, unknown> };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/workspace", () => {
  it.each(["archiveEverything", "toString", "__proto__"])(
    "rejects the unknown op %s with 400 and saves nothing",
    async (op) => {
      const e = stored();
      load(e);
      const response = await post(envelope(e, op));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Unknown command" });
      expect(save).not.toHaveBeenCalled();
    },
  );

  it("rejects a stale expectedVersion with 409 before dispatching", async () => {
    const e = stored(4);
    load(e);
    const rename = await post(
      envelope(e, "renameEngagement", { title: "Renamed", dueDate: "" }, 3),
    );
    expect(rename.status).toBe(409);
    expect(await rename.json()).toEqual({
      error: "The engagement changed. Reload before saving.",
    });
    expect(e.title).toBe("Model risk audit");
    // The version is checked before the op is looked up.
    const unknown = await post(envelope(e, "archiveEverything", {}, 3));
    expect(unknown.status).toBe(409);
    expect(save).not.toHaveBeenCalled();
  });

  it("saves the changed engagement at the caller's expectedVersion", async () => {
    const e = stored(),
      ctx = caller();
    load(e, ctx);
    const data = { title: "Renamed audit", dueDate: "2026-12-31" };
    const response = await post(envelope(e, "renameEngagement", data));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Reply;
    expect(body.details).toEqual(data);
    expect(body.engagement).toMatchObject({
      title: "Renamed audit",
      version: 4,
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      ctx,
      e,
      3,
      "renameEngagement",
      data,
      undefined,
    );
  });

  it("checks the op's roles before validating its data", async () => {
    const e = stored();
    load(e, caller("Reviewer"));
    const response = await post(envelope(e, "renameEngagement", { title: "" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Your role cannot perform this action",
    });
  });

  it("answers invalid envelopes and data with the zod issues as 400", async () => {
    const e = stored();
    load(e);
    const envelopeError = await post({
      ...envelope(e, "renameEngagement"),
      expectedVersion: 0,
    });
    expect(envelopeError.status).toBe(400);
    expect(await envelopeError.json()).toEqual({
      error: "expectedVersion: Number must be greater than 0",
    });
    expect(context).not.toHaveBeenCalled();
    const dataError = await post(
      envelope(e, "renameEngagement", { title: "Renamed", dueDate: "soon" }),
    );
    expect(dataError.status).toBe(400);
    expect(await dataError.json()).toEqual({ error: "dueDate: Invalid" });
    expect(save).not.toHaveBeenCalled();
  });

  it.each(["createClient", "createEngagement", "grantMember"])(
    "refers %s to client and user management for every role",
    async (op) => {
      const e = stored();
      load(e, caller("Client Viewer"));
      const response = await post(envelope(e, op));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Use client and user management for this action",
      });
    },
  );

  it("returns what a self-persisting command saved without saving again", async () => {
    const e = stored();
    // A queued run without a frozen manifest: execution fails, and the run
    // completes as failed.
    e.runs.push({
      id: "RUN-1",
      modelId: "MOD-1",
      datasetId: "EV-1",
      state: "queued",
      paperIds: [],
      createdAt: "2026-11-05T09:00:00.000Z",
    } as unknown as Run);
    load(e);
    const persisted: Engagement[] = [];
    vi.mocked(getEngagement)
      .mockResolvedValueOnce(e)
      .mockImplementation(async () => structuredClone(persisted.at(-1)!));
    vi.mocked(save).mockImplementation(async (_ctx, saved, expectedVersion) => {
      saved.version = expectedVersion + 1;
      persisted.push(structuredClone(saved));
      return saved;
    });
    const response = await post(envelope(e, "executeRun", { runId: "RUN-1" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Reply;
    expect(body).not.toHaveProperty("details");
    expect(body.engagement.version).toBe(5);
    expect(body.engagement.runs[0]).toMatchObject({
      id: "RUN-1",
      state: "failed",
      outcome: "inconclusive",
    });
    expect(vi.mocked(save).mock.calls.map((call) => call.slice(2))).toEqual([
      [3, "claimRun", { runId: "RUN-1" }],
      [
        4,
        "completeRun",
        { runId: "RUN-1", state: "failed", outcome: "inconclusive" },
      ],
    ]);
  });
});

describe("command registry", () => {
  // The ops and role lists the route's single if-chain accepted before the
  // split; workflow and evidence-request ops check their own roles.
  const allowed: Record<string, Role[]> = {
    createPaper: ["Auditor", "Lead Auditor"],
    editPaper: ["Auditor", "Lead Auditor"],
    submitPaper: ["Auditor", "Lead Auditor"],
    reopenPaper: ["Lead Auditor"],
    reviewPaper: ["Reviewer", "Lead Auditor"],
    signPaper: ["Lead Auditor"],
    comment: ["Reviewer", "Lead Auditor", "Auditor"],
    respondComment: ["Auditor", "Lead Auditor"],
    resolveComment: ["Reviewer", "Lead Auditor", "Auditor"],
    classify: ["Auditor", "Lead Auditor"],
    approveClassification: ["Reviewer", "Lead Auditor"],
    createFinding: ["Auditor", "Lead Auditor"],
    updateFinding: ["Auditor", "Lead Auditor"],
    closeFinding: ["Reviewer", "Lead Auditor"],
    createModel: ["Auditor", "Lead Auditor"],
    createEvaluationProfile: ["Auditor", "Lead Auditor"],
    queueRun: ["Auditor", "Lead Auditor"],
    retryRun: ["Auditor", "Lead Auditor"],
    executeRun: ["Auditor", "Lead Auditor"],
    recoverRun: ["Lead Auditor"],
    cancelRun: ["Auditor", "Lead Auditor"],
    acceptEvidence: ["Auditor", "Lead Auditor"],
    setStage: ["Lead Auditor"],
    renameEngagement: ["Auditor", "Lead Auditor"],
    openFollowup: ["Lead Auditor"],
    createReport: ["Lead Auditor"],
  };
  const managementOps = ["createClient", "createEngagement", "grantMember"];

  it("lists each accepted op in exactly one module", () => {
    const ops = commandModules.flatMap((m) => m.ops);
    expect(new Set(ops).size).toBe(ops.length);
    expect(new Set(ops)).toEqual(
      new Set([
        ...workflowOps,
        ...evidenceRequestOps,
        ...Object.keys(allowed),
        ...managementOps,
      ]),
    );
  });

  it.each(Object.entries(allowed))(
    "lets only the permitted roles issue %s",
    async (op, permitted) => {
      for (const role of roles) {
        const outcome = await dispatch(stored(), op, {}, caller(role)).then(
          () => undefined,
          (error: unknown) => error,
        );
        const refused =
          outcome instanceof ApiError &&
          outcome.status === 403 &&
          outcome.message === "Your role cannot perform this action";
        expect(refused, role).toBe(!permitted.includes(role));
      }
    },
  );
});
