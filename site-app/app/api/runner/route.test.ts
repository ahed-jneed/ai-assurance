import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { fakeD1 } from "@/lib/commands/test-fixtures";
import { sha256 } from "@/lib/ids";

const TOKEN = "00000000-0000-4000-8000-000000000001".repeat(2);
const IMAGE = "sha256:" + "a".repeat(64);
const DATASET = "d".repeat(64);

async function signed(body: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(body)),
    tokenHash = await sha256(TOKEN),
    key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(tokenHash.match(/../g)!.map((x) => parseInt(x, 16))),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
    signature = [
      ...new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes)),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  return new Request("https://workspace.test/api/runner", {
    method: "POST",
    headers: {
      authorization: "Bearer " + TOKEN,
      "content-type": "application/json",
      "x-result-signature": signature,
    },
    body: bytes,
  });
}

afterEach(() => {
  delete env.DB;
});

describe("POST /api/runner complete", () => {
  it.each([
    ["client", "platform"],
    ["client", undefined],
    ["platform", "client"],
  ] as const)(
    "refuses a completion whose custody differs from the frozen %s request (#102)",
    async (frozenCustody, stated) => {
      const request = JSON.stringify({
          executionMode: "client_local",
          dataset: {
            id: "EV-1",
            ...(frozenCustody === "client" ? { custody: "client" } : {}),
          },
          inputHashes: { dataset: DATASET },
        }),
        requestSha256 = await sha256(request),
        job = {
          id: "JOB-1",
          state: "running",
          request,
          request_sha256: requestSha256,
          worker_id: "WORKER-1",
          attempt_id: "ATTEMPT-1",
          fence: 1,
          nonce: "NONCE-1",
          lease_until: new Date(Date.now() + 60_000).toISOString(),
          result_sha256: null,
        },
        worker = {
          id: "WORKER-1",
          tenant_id: "tenant-1",
          engagement_id: "ENG-1",
          image_digest: IMAGE,
          capabilities: JSON.stringify([
            "provided_predictions",
            "client_local",
          ]),
          created_by: "user-lead",
        };
      // The job query's guard names memberships too, so it is matched first.
      const { db, batches } = fakeD1((sql) =>
        sql.startsWith("SELECT * FROM execution_jobs")
          ? job
          : sql.includes("FROM runner_workers")
            ? worker
            : sql.includes("FROM memberships")
              ? { 1: 1 }
              : null,
      );
      env.DB = db;
      const resultJSON = JSON.stringify({
        schemaVersion: "1.0",
        externalReport: {},
        hostedResults: [
          {
            testId: "performance",
            label: "Performance",
            article: "15",
            outcome: "pass",
            metrics: [],
            limitations: [],
          },
        ],
        provenance: {
          requestSha256,
          inputHashes: { dataset: DATASET },
          imageDigest: IMAGE,
          executionMode: "client_local",
          execution: stated ? { datasetCustody: stated } : {},
        },
      });
      const response = await POST(
        await signed({
          op: "complete",
          jobId: job.id,
          attemptId: job.attempt_id,
          fence: job.fence,
          nonce: job.nonce,
          requestSha256,
          resultJSON,
          resultSha256: await sha256(resultJSON),
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Dataset custody differs from the frozen request",
      });
      // Nothing is stored or marked complete.
      expect(batches).toEqual([]);
    },
  );
});
