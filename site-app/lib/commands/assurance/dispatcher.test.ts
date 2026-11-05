import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/assurance/route";
import { locationSchema, type AssuranceRecord } from "@/lib/assurance-core";
import {
  addRecord,
  jobs,
  recordStatement,
  records,
} from "@/lib/assurance-store";
import {
  assuranceModules,
  assuranceTarget,
  dispatchAssurance,
} from "@/lib/commands/assurance";
import { roles, type Artifact, type Engagement, type Role } from "@/lib/domain";
import { getEngagement, save } from "@/lib/engagement-repo";
import { ApiError } from "@/lib/http";
import type { assuranceView } from "@/lib/read-models/assurance-view";
import { context, type Context } from "@/lib/tenancy";
import { caller, fakeD1, postRequest, stored } from "../test-fixtures";

// Identity, persistence and the assurance record store are faked per test.
vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(),
}));
vi.mock("@/lib/engagement-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/engagement-repo")>()),
  getEngagement: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assurance-store")>()),
  records: vi.fn(),
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
function written(kind: string, body: Record<string, unknown>): AssuranceRecord {
  return {
    id: "AS-1",
    kind,
    body,
    sha256: "b".repeat(64),
    createdAt: "2026-11-05T10:00:00.000Z",
    actor: "user-lead",
  };
}
function load(e: Engagement, ctx: Context = caller()) {
  vi.mocked(context).mockResolvedValue(ctx);
  vi.mocked(getEngagement).mockResolvedValue(e);
  vi.mocked(records).mockResolvedValue([]);
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
      for (const op of ["addLocation", "assist", "archiveEverything"]) {
        const response = await post(e, op, location);
        expect(response.status, op).toBe(403);
        expect(await response.json(), op).toEqual(internalOnly);
      }
      expect(addRecord).not.toHaveBeenCalled();
    },
  );

  it("checks the op's roles before validating its data", async () => {
    const e = stored();
    load(e, caller("Reviewer"));
    const register = await post(e, "registerSystem", { name: "" });
    expect(register.status).toBe(403);
    expect(await register.json()).toEqual(refusal);
    load(e, caller("Auditor"));
    const review = await post(e, "reviewAssertion", { assertionId: "" });
    expect(review.status).toBe(403);
    expect(await review.json()).toEqual(refusal);
    expect(addRecord).not.toHaveBeenCalled();
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
  });

  it("passes through the Response of an op that builds its own", async () => {
    const e = stored();
    load(e);
    vi.mocked(recordStatement).mockImplementation(
      async (_ctx, _id, kind, body) => ({
        statement: {} as D1PreparedStatement,
        guarded: () => ({}) as D1PreparedStatement,
        record: written(kind, body),
      }),
    );
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
});

describe("GET /api/assurance", () => {
  function get(e: Engagement) {
    return GET(
      new Request(
        "https://workspace.test/api/assurance?tenantId=tenant-1&engagementId=" +
          e.id,
      ),
    );
  }

  it.each(["Client Viewer", "Client Contributor"] as Role[])(
    "refuses %s before loading any assurance data",
    async (role) => {
      const e = stored();
      load(e, caller(role));
      const response = await get(e);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(internalOnly);
      expect(records).not.toHaveBeenCalled();
      expect(jobs).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["Lead Auditor", 1],
    ["Auditor", 0],
    ["Reviewer", 0],
  ] as [Role, number][])(
    "loads the workbench for %s",
    async (role, eligible) => {
      const e = stored();
      load(e, caller(role));
      const record = written("location", location);
      vi.mocked(records).mockResolvedValue([record]);
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
        workers: rows.runner_workers,
        access: rows.engagement_access,
        practiceAdmin: true,
        telemetry: { queued: 1, stalled: 1 },
      });
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
});

describe("assurance command registry", () => {
  // The ops and role checks of the route's if-chain before the split. assist
  // had no role check of its own: the client-role gate left the three
  // internal roles.
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
    assist: ["Auditor", "Lead Auditor", "Reviewer"],
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
        const outcome = await dispatchAssurance(
          assuranceTarget(stored(), []),
          op,
          {},
          caller(role),
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
