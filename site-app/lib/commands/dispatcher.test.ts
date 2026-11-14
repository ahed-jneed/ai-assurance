import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/workspace/route";
import { commandModules, dispatch } from "@/lib/commands";
import {
  roles,
  type Engagement,
  type Role,
  type Run,
} from "@/lib/domain/types";
import { qualityReviewerOps } from "@/lib/domain/quality-review";
import { getEngagement, save } from "@/lib/engagement-repo";
import { evidenceRequestOps } from "@/lib/evidence-requests";
import { ApiError } from "@/lib/http";
import { context } from "@/lib/tenancy";
import { workflowOps } from "@/lib/workflow/dispatch";
import { caller, postRequest, stored } from "./test-fixtures";

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
  return POST(postRequest("/api/workspace", body));
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
    "refers %s to client and user management for every role that writes",
    async (op) => {
      // Client Viewers and Engagement Quality Reviewers write no audit work.
      for (const role of roles.filter(
        (r) => !["Client Viewer", "Engagement Quality Reviewer"].includes(r),
      )) {
        const e = stored();
        load(e, caller(role));
        const response = await post(envelope(e, op));
        expect(response.status, role).toBe(400);
        expect(await response.json(), role).toEqual({
          error: "Use client and user management for this action",
        });
      }
      expect(save).not.toHaveBeenCalled();
    },
  );

  // F-56: Client Viewers only read. Every op the bus accepts, and any other
  // op name, is refused before the engagement is loaded.
  it("refuses every op with 403 to a Client Viewer before loading anything", async () => {
    const e = stored();
    load(e, caller("Client Viewer"));
    for (const op of [
      ...commandModules.flatMap((m) => m.ops),
      "archiveEverything",
    ]) {
      const response = await post(envelope(e, op));
      expect(response.status, op).toBe(403);
      expect(await response.json(), op).toEqual({
        error: "Client Viewers have read-only access",
      });
    }
    expect(getEngagement).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

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
    setFindingCriteria: ["Auditor", "Lead Auditor"],
    closeFinding: ["Reviewer", "Lead Auditor"],
    recordSoaEntry: ["Auditor", "Lead Auditor"],
    reviewSoa: ["Reviewer", "Lead Auditor"],
    gradeNonconformity: ["Auditor", "Lead Auditor"],
    recordCorrectiveAction: ["Auditor", "Lead Auditor"],
    acceptCorrectiveAction: ["Reviewer", "Lead Auditor"],
    createModel: ["Auditor", "Lead Auditor"],
    createEvaluationProfile: ["Auditor", "Lead Auditor"],
    queueRun: ["Auditor", "Lead Auditor"],
    retryRun: ["Auditor", "Lead Auditor"],
    executeRun: ["Auditor", "Lead Auditor"],
    recoverRun: ["Lead Auditor"],
    cancelRun: ["Auditor", "Lead Auditor"],
    computeLl144Audit: ["Auditor", "Lead Auditor"],
    approveLl144Audit: ["Reviewer", "Lead Auditor"],
    recordSpecialCategoryBasis: ["Auditor", "Lead Auditor"],
    pinClientDataset: ["Auditor", "Lead Auditor"],
    acceptEvidence: ["Auditor", "Lead Auditor"],
    setStage: ["Lead Auditor"],
    renameEngagement: ["Auditor", "Lead Auditor"],
    openFollowup: ["Lead Auditor"],
    // M1 pins: the engagement team's writers, and only practice admins.
    pinCriteria: ["Auditor", "Lead Auditor"],
    unpinCriteria: ["Auditor", "Lead Auditor"],
    createReport: ["Lead Auditor"],
    setPaperAudience: ["Lead Auditor"],
    appointQualityReviewer: ["Lead Auditor"],
    saveQualityReview: ["Engagement Quality Reviewer"],
    signOffQualityReview: ["Engagement Quality Reviewer"],
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

  // An Engagement Quality Reviewer reads the engagement and records only the
  // quality review: every other op refuses them before its own checks run.
  it("refuses an Engagement Quality Reviewer every op outside the quality review", async () => {
    const ops = commandModules
      .flatMap((m) => m.ops)
      .filter((op) => !qualityReviewerOps.includes(op));
    expect(ops.length).toBeGreaterThan(60);
    for (const op of ops) {
      const e = stored(),
        before = JSON.stringify(e);
      const outcome = await dispatch(
        e,
        op,
        {},
        caller("Engagement Quality Reviewer"),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(outcome, op).toMatchObject({
        status: 403,
        message:
          "An Engagement Quality Reviewer reviews the engagement but cannot change its audit work",
      });
      expect(JSON.stringify(e), op).toBe(before);
    }
  });

  it.each(Object.entries(allowed))(
    "lets only the permitted roles issue %s",
    async (op, permitted) => {
      for (const role of roles) {
        const outcome = await dispatch(stored(), op, {}, caller(role)).then(
          () => undefined,
          (error: unknown) => error,
        );
        // An Engagement Quality Reviewer is refused every op outside the
        // quality review before the op's role check.
        const refused =
          outcome instanceof ApiError &&
          outcome.status === 403 &&
          (outcome.message === "Your role cannot perform this action" ||
            (role === "Engagement Quality Reviewer" &&
              !qualityReviewerOps.includes(op)));
        expect(refused, role).toBe(!permitted.includes(role));
      }
    },
  );
});
