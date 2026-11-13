import { env } from "cloudflare:workers";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
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

// GenAI ingest jobs (#33, docs/design/genai-evidence.md sections 10.2 and
// 12.1): which worker may claim them, which bytes it may download and which
// envelope the route accepts as their result.
const exampleText = readFileSync(
  "../schemas/fixtures/genai-result.example.json",
  "utf8",
);
const example = JSON.parse(exampleText) as {
  computationJSON: string;
  provenance: Record<string, unknown> & {
    inputHashes: Record<string, string>;
  };
};
const [LOG_SHA, LABELS_SHA] = [
  example.provenance.inputHashes["0"],
  example.provenance.inputHashes["1"],
];
const GENAI_REQUEST = {
  schemaVersion: "genai-1.0",
  executionMode: "genai_ingest",
  procedure: { id: "PROC-WP-GA-02", revision: 1, briefRevision: 1 },
  inputs: [
    { index: 0, artifactId: "EV-LOG", sha256: LOG_SHA },
    { index: 1, artifactId: "EV-LABELS", sha256: LABELS_SHA },
  ],
  inputHashes: { "0": LOG_SHA, "1": LABELS_SHA },
};
const TABULAR_REQUEST = {
  executionMode: "provided_predictions",
  dataset: { id: "EV-DATA" },
  inputHashes: { dataset: DATASET },
};

async function jobRow(id: string, request: Record<string, unknown>) {
  const text = JSON.stringify(request);
  return {
    id,
    state: "running",
    request: text,
    request_sha256: await sha256(text),
    worker_id: "WORKER-1",
    attempt_id: "ATTEMPT-1",
    fence: 1,
    nonce: "NONCE-1",
    lease_until: new Date(Date.now() + 60_000).toISOString(),
    result_sha256: null,
  };
}
const workerRow = (capabilities: string[]) => ({
  id: "WORKER-1",
  tenant_id: "tenant-1",
  engagement_id: "ENG-1",
  image_digest: IMAGE,
  capabilities: JSON.stringify(capabilities),
  created_by: "user-lead",
});
function evidence(
  id: string,
  sha: string,
  status: "accepted" | "quarantined" = "accepted",
) {
  return { id, name: id + ".bin", sha256: sha, status, key: "k/" + id };
}
/** The route's D1 queries; the job query's guard names memberships too. */
function routeDb(o: {
  job?: unknown;
  candidates?: unknown[];
  capabilities: string[];
  artifacts?: unknown[];
}) {
  return fakeD1((sql) =>
    sql.startsWith("SELECT * FROM execution_jobs WHERE tenant_id")
      ? (o.candidates ?? [])
      : sql.startsWith("SELECT * FROM execution_jobs")
        ? o.job
        : sql.startsWith("SELECT body FROM engagements")
          ? { body: JSON.stringify({ artifacts: o.artifacts ?? [] }) }
          : sql.includes("FROM runner_workers")
            ? workerRow(o.capabilities)
            : sql.includes("FROM memberships")
              ? { 1: 1 }
              : null,
  );
}
/** An in-memory bucket that records what the route reads and writes. */
function fakeBucket() {
  const reads: string[] = [],
    writes: string[] = [];
  env.BUCKET = {
    get: async (key: string) => {
      reads.push(key);
      return { body: "bytes of " + key };
    },
    put: async (key: string) => {
      writes.push(key);
    },
    delete: async () => undefined,
  } as unknown as R2Bucket;
  return { reads, writes };
}

describe("GenAI ingest jobs", () => {
  afterEach(() => {
    delete env.BUCKET;
  });

  describe("claim", () => {
    const claim = (formats: string[]) =>
      signed({ op: "claim", imageDigest: IMAGE, formats });

    it("serves a GenAI job only to a worker enrolled with genai_ingest", async () => {
      const genai = await jobRow("JOB-G", GENAI_REQUEST);
      // Enrolled for tabular work only: claiming genai_ingest is filtered out.
      const tabularOnly = routeDb({
        candidates: [genai],
        capabilities: ["provided_predictions"],
      });
      env.DB = tabularOnly.db;
      const idle = await POST(
        await claim(["provided_predictions", "genai_ingest"]),
      );
      expect(await idle.json()).toEqual({ idle: true });
      expect(tabularOnly.batches).toEqual([]);

      const enrolled = routeDb({
        candidates: [await jobRow("JOB-T", TABULAR_REQUEST), genai],
        capabilities: ["genai_ingest"],
      });
      env.DB = enrolled.db;
      const served = await POST(await claim(["genai_ingest"]));
      expect(served.status).toBe(200);
      expect(await served.json()).toMatchObject({
        jobId: "JOB-G",
        requestSha256: genai.request_sha256,
        request: { executionMode: "genai_ingest" },
      });
      expect(enrolled.batches).toHaveLength(1);
    });

    it("never serves a tabular job to a worker claiming only genai_ingest", async () => {
      const { db, batches } = routeDb({
        candidates: [await jobRow("JOB-T", TABULAR_REQUEST)],
        capabilities: ["genai_ingest", "provided_predictions"],
      });
      env.DB = db;
      const response = await POST(await claim(["genai_ingest"]));
      expect(await response.json()).toEqual({ idle: true });
      expect(batches).toEqual([]);
    });
  });

  describe("GET input", () => {
    const download = (input: string, index?: string) =>
      GET(
        new Request(
          "https://workspace.test/api/runner?jobId=JOB-G&attemptId=ATTEMPT-1&fence=1&input=" +
            input +
            (index === undefined ? "" : "&index=" + index),
          { headers: { authorization: "Bearer " + TOKEN } },
        ),
      );
    const setup = async (
      request: Record<string, unknown>,
      artifacts: unknown[] = [
        evidence("EV-LOG", LOG_SHA),
        evidence("EV-LABELS", LABELS_SHA),
      ],
    ) => {
      env.DB = routeDb({
        job: await jobRow("JOB-G", request),
        capabilities: ["genai_ingest"],
        artifacts,
      }).db;
      return fakeBucket();
    };

    it("serves a pinned, accepted evidence input by index", async () => {
      const { reads } = await setup(GENAI_REQUEST);
      const response = await download("evidence", "1");
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Evidence-SHA256")).toBe(LABELS_SHA);
      expect(await response.text()).toBe("bytes of k/EV-LABELS");
      expect(reads).toEqual(["k/EV-LABELS"]);
    });

    it.each(["dataset", "model"])(
      "refuses %s bytes for a GenAI request",
      async (input) => {
        const { reads } = await setup(GENAI_REQUEST);
        const response = await download(input);
        expect(response.status).toBe(403);
        expect(reads).toEqual([]);
      },
    );

    it("refuses evidence bytes for a tabular request", async () => {
      const { reads } = await setup(TABULAR_REQUEST, [
        evidence("EV-DATA", DATASET),
      ]);
      const response = await download("evidence", "0");
      expect(response.status).toBe(403);
      expect(reads).toEqual([]);
    });

    it.each([["7"], ["x"], [undefined]])(
      "answers 404 for an unknown index (%s)",
      async (index) => {
        const { reads } = await setup(GENAI_REQUEST);
        const response = await download("evidence", index);
        expect(response.status).toBe(404);
        expect(reads).toEqual([]);
      },
    );

    it.each([
      ["quarantined", [evidence("EV-LOG", LOG_SHA, "quarantined")]],
      ["changed", [evidence("EV-LOG", "e".repeat(64))]],
      ["removed", []],
    ])("answers 409 when the pinned artifact is %s", async (_, artifacts) => {
      const { reads } = await setup(GENAI_REQUEST, artifacts);
      const response = await download("evidence", "0");
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "Input artifact pin changed",
      });
      expect(reads).toEqual([]);
    });
  });

  describe("complete", () => {
    /** The fixture envelope as a worker delivers it for this request. */
    const delivered = (
      requestSha256: string,
      provenance: Record<string, unknown> = {},
      computationJSON = example.computationJSON,
    ) =>
      JSON.stringify({
        ...example,
        computationJSON,
        provenance: {
          ...example.provenance,
          channel: "runner",
          producedAt: "2026-11-05T18:00:00Z",
          requestSha256,
          imageDigest: IMAGE,
          workerVersion: "1.2.0",
          ...provenance,
        },
      });
    const complete = async (
      resultJSON: string,
      request: Record<string, unknown> = GENAI_REQUEST,
    ) => {
      const job = await jobRow("JOB-G", request),
        { db, batches } = routeDb({ job, capabilities: ["genai_ingest"] });
      env.DB = db;
      const bucket = fakeBucket();
      const response = await POST(
        await signed({
          op: "complete",
          jobId: job.id,
          attemptId: job.attempt_id,
          fence: job.fence,
          nonce: job.nonce,
          requestSha256: job.request_sha256,
          resultJSON,
          resultSha256: await sha256(resultJSON),
        }),
      );
      return { response, batches, ...bucket };
    };
    const requestSha = (request: object = GENAI_REQUEST) =>
      sha256(JSON.stringify(request));
    const refusedWith = async (
      outcome: Awaited<ReturnType<typeof complete>>,
      error: string,
    ) => {
      expect(outcome.response.status).toBe(400);
      expect(await outcome.response.json()).toEqual({ error });
      // Nothing is stored or marked complete.
      expect([outcome.writes, outcome.batches]).toEqual([[], []]);
    };

    it("accepts the fixture envelope bound to this request, inputs and image", async () => {
      const { response, batches, writes } = await complete(
        delivered(await requestSha()),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: true });
      expect(writes).toHaveLength(1);
      expect(batches).toHaveLength(1);
    });

    it.each([
      ["a cli channel", { channel: "cli" }],
      ["another request", { requestSha256: "0".repeat(64) }],
      ["another image", { imageDigest: "sha256:" + "b".repeat(64) }],
    ])("rejects an envelope with %s", async (_, provenance) => {
      await refusedWith(
        await complete(delivered(await requestSha(), provenance)),
        "Consumed input or runtime pins mismatch",
      );
    });

    it("rejects inputs pinned at other indices than the request's", async () => {
      // The envelope is self-consistent, but its index 0 is the request's 1.
      const swapped = {
        ...GENAI_REQUEST,
        inputHashes: { "0": LABELS_SHA, "1": LOG_SHA },
      };
      await refusedWith(
        await complete(delivered(await requestSha(swapped)), swapped),
        "Consumed input or runtime pins mismatch",
      );
    });

    it("rejects a tampered computation", async () => {
      const c = JSON.parse(example.computationJSON);
      c.criteria[0].outcome = "pass_tampered";
      await refusedWith(
        await complete(delivered(await requestSha(), {}, JSON.stringify(c))),
        "GenAI result rejected: computationSha256 does not match computationJSON",
      );
    });

    it("does not accept a tabular result for a GenAI request", async () => {
      const resultJSON = JSON.stringify({
        schemaVersion: "1.0",
        externalReport: {},
        hostedResults: [],
        provenance: {
          requestSha256: await requestSha(),
          inputHashes: GENAI_REQUEST.inputHashes,
          imageDigest: IMAGE,
          executionMode: "genai_ingest",
        },
      });
      await refusedWith(
        await complete(resultJSON),
        "GenAI result rejected: The file is not a genai-result/0.1 envelope",
      );
    });
  });
});
