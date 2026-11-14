// Refusals of assurance ops that answered 500 or the wrong conflict (#220),
// against SQLite D1 and an in-memory R2 bucket: an imported packet or
// briefing that is not JSON is the caller's file to correct (400), and
// cancelJob answers 404 for a job this engagement does not hold.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNew } from "../../criteria/pin";
import type { Artifact, Engagement } from "../../domain/types";
import { getEngagement } from "../../engagement-repo";
import { freshEngagement } from "../../factories";
import { ApiError } from "../../http";
import { sha256 } from "../../ids";
import { member, practice, tenantId } from "../../test-storage";
import { dispatchAssurance } from "./index";
import { assuranceTarget } from "./target";

const auditor = () => member("auditor", "Auditor");
const broken = "{not json";
let store: Awaited<ReturnType<typeof practice>>;

async function artifact(
  engagementId: string,
  id: string,
  name: string,
  text: string,
): Promise<Artifact> {
  const sha = await sha256(text);
  return {
    id,
    name,
    category: "Governance",
    size: new TextEncoder().encode(text).length,
    sha256: sha,
    key: tenantId + "/" + engagementId + "/" + id + "/" + sha,
    createdAt: "2026-11-05T00:00:00.000Z",
    uploadedBy: "auditor",
    visibility: "internal",
    status: "accepted",
    mediaType: "application/json",
  };
}
const engagement = (id: string) => {
  const e: Engagement = freshEngagement(
    resolveNew(),
    "CL-1",
    "Refusal fixture " + id,
    "lead",
    true,
  );
  e.id = id;
  return e;
};
/** Two engagements of one practice; ENG-A holds a malformed JSON file. */
async function seed() {
  const a = engagement("ENG-A"),
    b = engagement("ENG-B");
  const file = await artifact("ENG-A", "EV-BAD", "packet.json", broken);
  a.artifacts.push(file);
  store = await practice([a, b]);
  await env.BUCKET!.put(file.key, broken);
}
async function op(
  engagementId: string,
  name: string,
  data: Record<string, unknown>,
) {
  const ctx = auditor(),
    e = await getEngagement(ctx, engagementId);
  return dispatchAssurance(assuranceTarget(e, ctx), name, data, ctx);
}
const refusal = (run: Promise<unknown>) =>
  run.then(
    () => {
      throw new Error("Expected a refusal");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(ApiError);
      return error as ApiError;
    },
  );
function job(id: string, engagementId: string, state: string) {
  store.sqlite
    .prepare(
      "INSERT INTO execution_jobs(id,tenant_id,engagement_id,state,request,request_sha256,created_by,created_at) VALUES(?,?,?,?,'{}',?,'auditor','2026-11-05T00:00:00.000Z')",
    )
    .run(id, tenantId, engagementId, state, "0".repeat(64));
}

afterEach(() => {
  delete env.DB;
  delete env.BUCKET;
});

describe("importing a file that is not JSON", () => {
  it("refuses an assurance packet with 400 naming the file kind", async () => {
    await seed();
    const error = await refusal(
      op("ENG-A", "importPacket", {
        artifactId: "EV-BAD",
        assessment: "Malformed packet fixture",
      }),
    );
    expect(error.status).toBe(400);
    expect(error.message).toBe("This assurance packet file is not valid JSON");
  });

  it("refuses a cited-model briefing with 400 naming the file kind", async () => {
    await seed();
    const error = await refusal(
      op("ENG-A", "importBriefing", {
        artifactId: "EV-BAD",
        assessment: "Malformed briefing fixture",
      }),
    );
    expect(error.status).toBe(400);
    expect(error.message).toBe("This briefing file is not valid JSON");
  });
});

describe("cancelJob", () => {
  const cancel = (engagementId: string, jobId: string) =>
    op(engagementId, "cancelJob", { jobId, reason: "Refusal fixture" });

  it("answers 404 for an unknown job", async () => {
    await seed();
    const error = await refusal(cancel("ENG-A", "JOB-missing"));
    expect([error.status, error.message]).toEqual([404, "Job not found"]);
  });

  it("answers 404 for a live job of another engagement in the practice", async () => {
    await seed();
    job("JOB-B", "ENG-B", "queued");
    const error = await refusal(cancel("ENG-A", "JOB-B"));
    expect([error.status, error.message]).toEqual([404, "Job not found"]);
    // The other engagement's job is left as it was.
    expect(
      store.sqlite
        .prepare("SELECT state FROM execution_jobs WHERE id='JOB-B'")
        .get(),
    ).toEqual({ state: "queued" });
  });

  it.each(["succeeded", "failed", "cancelled"])(
    "keeps 409 for a job of this engagement that is %s",
    async (state) => {
      await seed();
      job("JOB-A", "ENG-A", state);
      const error = await refusal(cancel("ENG-A", "JOB-A"));
      expect([error.status, error.message]).toEqual([
        409,
        "Job already completed or cancelled",
      ]);
    },
  );

  it("cancels a queued job of this engagement", async () => {
    await seed();
    job("JOB-A", "ENG-A", "queued");
    await cancel("ENG-A", "JOB-A");
    expect(
      store.sqlite
        .prepare("SELECT state FROM execution_jobs WHERE id='JOB-A'")
        .get(),
    ).toEqual({ state: "cancelled" });
  });
});
