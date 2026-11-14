// Enrolling and revoking external runners against SQLite D1 (#201 items 3
// and 7): a malformed image digest says what is expected, and only a runner
// enrolled for the engagement can be revoked, once.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getEngagement } from "../../engagement-repo";
import { ApiError } from "../../http";
import { engagementWithParts, member, practice } from "../../test-storage";
import { dispatchAssurance } from "./index";
import { assuranceTarget } from "./target";

afterEach(() => {
  delete env.DB;
  delete env.BUCKET;
});

const lead = () => member("lead", "Lead Auditor");
const op = async (name: string, data: Record<string, unknown>, ctx = lead()) =>
  dispatchAssurance(
    assuranceTarget(await getEngagement(ctx, "ENG-W"), ctx),
    name,
    data,
    ctx,
  );
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );
const enrollment = {
  name: "Client runner",
  imageDigest: "sha256:" + "a".repeat(64),
  formats: ["provided_predictions"],
  securityReview: "Reviewed the image and its network policy",
};
async function setup() {
  return (await practice([engagementWithParts("ENG-W", "Runner audit")]))
    .sqlite;
}
type Sqlite = Awaited<ReturnType<typeof setup>>;
const workerEvents = (sqlite: Sqlite) =>
  sqlite
    .prepare(
      "SELECT body FROM assurance_records WHERE kind='worker_event' ORDER BY created_at,id",
    )
    .all()
    .map((r) => JSON.parse(String(r.body)) as { action: string });

describe("enrollWorker", () => {
  it("names the expected digest format for a malformed image digest", async () => {
    await setup();
    for (const imageDigest of ["latest", "sha256:ABC", "a".repeat(64)]) {
      const error = await refusal(
        op("enrollWorker", { ...enrollment, imageDigest }),
      );
      expect(error, imageDigest).toBeInstanceOf(z.ZodError);
      expect((error as z.ZodError).issues.map((i) => i.message)).toEqual([
        "Enter the image digest as sha256: followed by 64 lowercase hexadecimal characters",
      ]);
    }
  });
});

describe("revokeWorker", () => {
  it("revokes an enrolled runner and records the event", async () => {
    const sqlite = await setup();
    const enrolled = (await op("enrollWorker", enrollment)) as Response;
    const { workerId } = (await enrolled.json()) as { workerId: string };
    await op("revokeWorker", { workerId, reason: "Engagement closed" });
    expect(
      sqlite
        .prepare("SELECT active FROM runner_workers WHERE id=?")
        .get(workerId),
    ).toEqual({ active: 0 });
    expect(workerEvents(sqlite).map((e) => e.action)).toEqual([
      "enrolled",
      "revoked",
    ]);
    // Revoking it again is refused and records nothing more.
    const again = await refusal(
      op("revokeWorker", { workerId, reason: "Engagement closed" }),
    );
    expect(again).toMatchObject({
      status: 409,
      message: "This runner is already revoked",
    });
    expect(workerEvents(sqlite)).toHaveLength(2);
  });

  it("answers 404 for an unknown runner and records no worker event", async () => {
    const sqlite = await setup();
    const error = await refusal(
      op("revokeWorker", { workerId: "WORKER-NONE", reason: "Typo" }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, message: "Runner not found" });
    expect(workerEvents(sqlite)).toEqual([]);
  });

  it("answers 404 for another engagement's runner", async () => {
    const sqlite = await setup();
    sqlite
      .prepare(
        "INSERT INTO runner_workers(id,tenant_id,engagement_id,name,token_hash,image_digest,capabilities,active,created_by,created_at) VALUES('WORKER-X','tenant-1','ENG-OTHER','x','h','d','[]',1,'lead','2026-11-01')",
      )
      .run();
    const error = await refusal(
      op("revokeWorker", { workerId: "WORKER-X", reason: "Wrong" }),
    );
    expect(error).toMatchObject({ status: 404 });
    expect(workerEvents(sqlite)).toEqual([]);
  });
});
