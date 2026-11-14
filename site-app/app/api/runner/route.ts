import { db, bucket } from "@/lib/bindings";
import {
  ApiError,
  parseJsonBody,
  readBounded,
  responseError,
} from "@/lib/http";
import { now, id, sha256 } from "@/lib/ids";
import { activeJobGuard, workerSponsorGuard } from "@/lib/assurance-store";
import { resultEnvelope } from "@/lib/assurance-core";
import { GenaiEnvelopeError, readGenaiEnvelope } from "@/lib/genai/envelope";
import { claimResponse } from "@/lib/external-worker-contract";
import { requestedCriteria } from "@/lib/hosted-statistics";
import { assertPlatformBytes } from "@/lib/special-category";
import type { Artifact } from "@/lib/domain/types";
import { z } from "zod";
export const dynamic = "force-dynamic";
type WorkerRow = {
  id: string;
  tenant_id: string;
  engagement_id: string;
  image_digest: string;
  capabilities: string;
  created_by: string;
};
type JobRow = {
  id: string;
  state: string;
  request: string;
  request_sha256: string;
  worker_id: string | null;
  attempt_id: string | null;
  fence: number;
  nonce: string | null;
  lease_until: string | null;
  result_sha256: string | null;
};
const short = z.string().min(1).max(300),
  pins = z.object({
    jobId: short,
    attemptId: short,
    fence: z.number().int().positive(),
    nonce: short,
    requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  });
const workerGuard =
  "EXISTS(SELECT 1 FROM runner_workers w WHERE w.id=? AND " +
  workerSponsorGuard +
  ")";
async function worker(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([a-zA-Z0-9-]{60,100})$/)?.[1];
  if (!token) throw new ApiError(401, "Runner authentication required");
  const tokenHash = await sha256(token),
    w = await db()
      .prepare("SELECT * FROM runner_workers WHERE token_hash=? AND active=1")
      .bind(tokenHash)
      .first<WorkerRow>();
  if (!w) throw new ApiError(401, "Runner credential invalid or revoked");
  if (
    !(await db()
      .prepare(
        "SELECT 1 FROM memberships m JOIN engagement_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.role='Lead Auditor' AND m.status='active' AND a.engagement_id=? AND a.active=1",
      )
      .bind(w.tenant_id, w.created_by, w.engagement_id)
      .first())
  )
    throw new ApiError(403, "Worker sponsor access has been revoked");
  return { w, tokenHash };
}
async function live(w: WorkerRow, p: z.infer<typeof pins>) {
  const j = await db()
    .prepare(
      "SELECT * FROM execution_jobs WHERE id=? AND tenant_id=? AND engagement_id=? AND " +
        activeJobGuard,
    )
    .bind(p.jobId, w.tenant_id, w.engagement_id)
    .first<JobRow>();
  if (
    !j ||
    j.worker_id !== w.id ||
    j.attempt_id !== p.attemptId ||
    j.fence !== p.fence ||
    j.nonce !== p.nonce ||
    j.request_sha256 !== p.requestSha256
  )
    throw new ApiError(409, "Attempt identity or frozen request mismatch");
  return j;
}
const lease = (j: JobRow) => {
  if (
    j.state !== "running" ||
    !j.lease_until ||
    Date.parse(j.lease_until) <= Date.now()
  )
    throw new ApiError(
      409,
      "Attempt is expired, cancelled or already complete",
    );
};
/** The tabular result contract (run contract 1.x) against the frozen request. */
function assertTabularResult(
  resultJSON: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the frozen request is the JSON the workspace wrote
  frozen: any,
  j: JobRow,
  w: WorkerRow,
) {
  const r = resultEnvelope.parse(JSON.parse(resultJSON));
  if (
    r.provenance.requestSha256 !== j.request_sha256 ||
    r.provenance.inputHashes.dataset !== frozen.inputHashes.dataset ||
    (frozen.executionMode === "auditor_model" &&
      r.provenance.inputHashes.modelArtifact !==
        frozen.inputHashes.modelArtifact) ||
    r.provenance.imageDigest !== w.image_digest ||
    r.provenance.executionMode !== frozen.executionMode
  )
    throw new ApiError(400, "Consumed input or runtime pins mismatch");
  const execution = r.provenance.execution as
    { datasetCustody?: unknown } | undefined;
  if (
    (frozen.dataset.custody === "client") !==
    (execution?.datasetCustody === "client")
  )
    throw new ApiError(400, "Dataset custody differs from the frozen request");
  // Section 11.2: one result per criterion of the plan, in plan order,
  // the article following the criterion kind. A 1.4 request carries its
  // plan; a 1.1 request's derived plan has the suite names as ids.
  const expected = requestedCriteria(frozen);
  if (
    expected.length !== r.hostedResults.length ||
    r.hostedResults.some(
      (x, i) =>
        x.testId !== expected[i].id ||
        (x.decision && x.decision.kind !== expected[i].kind) ||
        x.article !== (expected[i].kind === "group_comparison" ? "10" : "15"),
    )
  )
    throw new ApiError(400, "Result definitions do not match requested tests");
}
/**
 * A genai-result/0.1 envelope (docs/design/genai-evidence.md section 10.2):
 * its own pins hold, and it binds this request, these inputs and this
 * worker's enrolled image.
 */
async function assertGenaiResult(
  resultJSON: string,
  frozen: { inputHashes: Record<string, string> },
  j: JobRow,
  w: WorkerRow,
) {
  let verified;
  try {
    verified = await readGenaiEnvelope(resultJSON);
  } catch (error) {
    if (error instanceof GenaiEnvelopeError)
      throw new ApiError(400, "GenAI result rejected: " + error.message);
    throw error;
  }
  const pins = verified.envelope.provenance,
    sorted = (h: Record<string, string>) =>
      JSON.stringify(Object.entries(h).sort(([a], [b]) => a.localeCompare(b)));
  if (
    pins.channel !== "runner" ||
    pins.requestSha256 !== j.request_sha256 ||
    sorted(pins.inputHashes) !== sorted(frozen.inputHashes) ||
    pins.imageDigest !== w.image_digest
  )
    throw new ApiError(400, "Consumed input or runtime pins mismatch");
}
export async function POST(request: Request) {
  let pendingKey: string | undefined;
  try {
    const { w, tokenHash } = await worker(request),
      bytes = await readBounded(request, 10 * 1024 * 1024),
      d = parseJsonBody(bytes) as { op?: string };
    if (d.op === "claim") {
      const v = z
        .object({
          op: z.literal("claim"),
          workerId: short.optional(),
          imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          formats: z.array(short).min(1).max(10),
          capabilities: z.record(z.unknown()).optional(),
        })
        .strict()
        .parse(d);
      if (
        (v.workerId && v.workerId !== w.id) ||
        v.imageDigest !== w.image_digest
      )
        throw new ApiError(
          403,
          "Worker identity or enrolled image digest mismatch",
        );
      const aliases: Record<string, string> = {
          onnx: "ONNX",
          xgboost_json: "XGBoost",
          lightgbm_text: "LightGBM",
          pmml: "PMML",
        },
        allowed = JSON.parse(w.capabilities) as string[],
        formats = v.formats
          .map((x) => aliases[x] ?? x)
          .filter((x) => allowed.includes(x));
      if (!formats.length)
        throw new ApiError(409, "No compatible enrolled capability");
      const candidates = (
        await db()
          .prepare(
            "SELECT * FROM execution_jobs WHERE tenant_id=? AND engagement_id=? AND (state='queued' OR (state='running' AND lease_until<=?)) AND " +
              activeJobGuard +
              " ORDER BY created_at LIMIT 20",
          )
          .bind(w.tenant_id, w.engagement_id, now())
          .all<JobRow>()
      ).results;
      // A client-held dataset (#102) goes only to a worker enrolled and
      // claiming as the client's own, which reads it in the client's
      // environment.
      const j = candidates.find((j) => {
        const r = JSON.parse(j.request);
        return formats.includes(
          r.executionMode === "genai_ingest"
            ? "genai_ingest"
            : r.dataset.custody === "client"
              ? "client_local"
              : r.executionMode === "auditor_model"
                ? r.model.format
                : "provided_predictions",
        );
      });
      if (!j) return Response.json({ idle: true });
      if (j.fence >= 5) {
        await db()
          .prepare(
            "UPDATE execution_jobs SET state='failed',error='Maximum attempts exhausted',completed_at=? WHERE id=? AND fence=? AND state IN ('queued','running')",
          )
          .bind(now(), j.id, j.fence)
          .run();
        return Response.json({ idle: true });
      }
      const attemptId = id("ATTEMPT"),
        nonce = crypto.randomUUID(),
        fence = j.fence + 1,
        leaseUntil = new Date(Date.now() + 120000).toISOString();
      const changed = await db().batch([
        db()
          .prepare(
            "UPDATE execution_jobs SET state='running',worker_id=?,attempt_id=?,fence=?,nonce=?,lease_until=? WHERE id=? AND fence=? AND (state='queued' OR (state='running' AND lease_until<=?)) AND " +
              activeJobGuard +
              " AND " +
              workerGuard,
          )
          .bind(
            w.id,
            attemptId,
            fence,
            nonce,
            leaseUntil,
            j.id,
            j.fence,
            now(),
            w.id,
          ),
        db()
          .prepare(
            "UPDATE execution_attempts SET state='expired',completed_at=? WHERE job_id=? AND state='running' AND EXISTS(SELECT 1 FROM execution_jobs WHERE id=? AND attempt_id=?)",
          )
          .bind(now(), j.id, j.id, attemptId),
        db()
          .prepare(
            "INSERT INTO execution_attempts(job_id,fence,id,worker_id,state,started_at,details) SELECT ?,?,?,?,'running',?,? WHERE EXISTS(SELECT 1 FROM execution_jobs WHERE id=? AND attempt_id=?)",
          )
          .bind(
            j.id,
            fence,
            attemptId,
            w.id,
            now(),
            JSON.stringify({
              imageDigest: w.image_digest,
              requestSha256: j.request_sha256,
              capabilities: v.capabilities ?? {},
            }),
            j.id,
            attemptId,
          ),
        db()
          .prepare("UPDATE runner_workers SET last_seen=? WHERE id=?")
          .bind(now(), w.id),
      ]);
      if (!changed[0].meta.changes) return Response.json({ idle: true });
      // queueExternal sized this body with claimResponseBytes.
      return Response.json(
        claimResponse(
          {
            jobId: j.id,
            attemptId,
            fence,
            nonce,
            leaseUntil,
            requestSha256: j.request_sha256,
          },
          j.request,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (d.op === "heartbeat") {
      const p = pins
          .extend({ op: z.literal("heartbeat") })
          .strict()
          .parse(d),
        j = await live(w, p);
      lease(j);
      const leaseUntil = new Date(Date.now() + 120000).toISOString(),
        r = await db()
          .prepare(
            "UPDATE execution_jobs SET lease_until=? WHERE id=? AND attempt_id=? AND fence=? AND state='running' AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND " +
              activeJobGuard +
              " AND " +
              workerGuard,
          )
          .bind(leaseUntil, j.id, p.attemptId, p.fence, w.id)
          .run();
      if (!r.meta.changes) throw new ApiError(409, "Attempt no longer active");
      return Response.json({ leaseUntil });
    }
    if (d.op !== "complete" && d.op !== "fail")
      throw new ApiError(400, "Unknown runner operation");
    const p = pins
        .extend({
          op: z.enum(["complete", "fail"]),
          resultJSON: z
            .string()
            .max(9 * 1024 * 1024)
            .optional(),
          resultSha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          error: z.string().max(1000).optional(),
        })
        .strict()
        .parse(d),
      j = await live(w, p),
      signature = request.headers.get("x-result-signature") ?? "";
    if (!/^[a-f0-9]{64}$/.test(signature))
      throw new ApiError(401, "Authenticated result signature required");
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(tokenHash.match(/../g)!.map((x) => parseInt(x, 16))),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        key,
        Uint8Array.from(signature.match(/../g)!.map((x) => parseInt(x, 16))),
        bytes,
      ))
    )
      throw new ApiError(401, "Result signature verification failed");
    if (
      j.state === "succeeded" &&
      p.op === "complete" &&
      p.resultSha256 === j.result_sha256
    )
      return Response.json({ accepted: true, duplicate: true });
    lease(j);
    let resultKey: null | string = null,
      resultHash: null | string = null;
    if (p.op === "complete") {
      if (
        !p.resultJSON ||
        !p.resultSha256 ||
        (await sha256(p.resultJSON)) !== p.resultSha256
      )
        throw new ApiError(400, "Result bytes hash mismatch");
      const frozen = JSON.parse(j.request);
      if (frozen.executionMode === "genai_ingest")
        await assertGenaiResult(p.resultJSON, frozen, j, w);
      else assertTabularResult(p.resultJSON, frozen, j, w);
      resultHash = p.resultSha256;
      resultKey =
        w.tenant_id +
        "/" +
        w.engagement_id +
        "/execution/" +
        j.id +
        "/" +
        p.attemptId +
        "/" +
        id("DELIVERY") +
        "/" +
        resultHash;
      await bucket().put(resultKey, p.resultJSON, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          sha256: resultHash,
          requestSha256: j.request_sha256,
          workerId: w.id,
        },
      });
      pendingKey = resultKey;
    }
    const finished = now(),
      state = p.op === "complete" ? "succeeded" : "failed",
      changed = await db().batch([
        db()
          .prepare(
            "UPDATE execution_jobs SET state=?,result_key=?,result_sha256=?,error=?,completed_at=? WHERE id=? AND state='running' AND attempt_id=? AND fence=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND " +
              activeJobGuard +
              " AND " +
              workerGuard,
          )
          .bind(
            state,
            resultKey,
            resultHash,
            p.op === "fail" ? (p.error ?? "Worker execution failed") : null,
            finished,
            j.id,
            p.attemptId,
            p.fence,
            w.id,
          ),
        db()
          .prepare(
            "UPDATE execution_attempts SET state=?,completed_at=?,details=? WHERE job_id=? AND fence=? AND state='running' AND EXISTS(SELECT 1 FROM execution_jobs WHERE id=? AND state=? AND attempt_id=?)",
          )
          .bind(
            state,
            finished,
            JSON.stringify({
              requestSha256: j.request_sha256,
              resultSha256: resultHash,
              error: p.error ?? null,
              imageDigest: w.image_digest,
            }),
            j.id,
            p.fence,
            j.id,
            state,
            p.attemptId,
          ),
      ]);
    if (!changed[0].meta.changes) {
      const accepted = await db()
        .prepare("SELECT state,result_sha256 FROM execution_jobs WHERE id=?")
        .bind(j.id)
        .first<{ state: string; result_sha256: string | null }>();
      if (
        p.op === "complete" &&
        accepted?.state === "succeeded" &&
        accepted.result_sha256 === p.resultSha256
      ) {
        if (pendingKey) await bucket().delete(pendingKey);
        pendingKey = undefined;
        return Response.json({ accepted: true, duplicate: true });
      }
      throw new ApiError(
        409,
        "Completion lost its active lease; result not accepted",
      );
    }
    pendingKey = undefined;
    return Response.json({ accepted: true });
  } catch (e) {
    if (pendingKey)
      try {
        const referenced = await db()
          .prepare("SELECT 1 FROM execution_jobs WHERE result_key=?")
          .bind(pendingKey)
          .first();
        if (!referenced) await bucket().delete(pendingKey);
      } catch {}
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Runner payload violates the versioned result contract" },
        { status: 400 },
      );
    return responseError(e);
  }
}
export async function GET(request: Request) {
  try {
    const { w } = await worker(request),
      u = new URL(request.url),
      j = await db()
        .prepare(
          "SELECT * FROM execution_jobs WHERE id=? AND tenant_id=? AND engagement_id=? AND " +
            activeJobGuard,
        )
        .bind(u.searchParams.get("jobId"), w.tenant_id, w.engagement_id)
        .first<JobRow>();
    if (
      !j ||
      j.worker_id !== w.id ||
      j.attempt_id !== u.searchParams.get("attemptId") ||
      j.fence !== Number(u.searchParams.get("fence"))
    )
      throw new ApiError(404, "Attempt input not found");
    lease(j);
    const input = z
        .enum(["dataset", "model", "evidence"])
        .parse(u.searchParams.get("input")),
      r = JSON.parse(j.request);
    // A GenAI ingest downloads only its pinned evidence inputs, by index.
    if ((input === "evidence") !== (r.executionMode === "genai_ingest"))
      throw new ApiError(
        403,
        "These input bytes are not authorized for this request",
      );
    if (input === "model" && r.executionMode !== "auditor_model")
      throw new ApiError(
        403,
        "Model bytes are not authorized for this prediction-only request",
      );
    if (input === "dataset" && r.dataset?.custody === "client")
      throw new ApiError(
        403,
        "This dataset stays in the client's environment; the platform holds only its SHA-256 pin",
      );
    const body = await db()
        .prepare("SELECT body FROM engagements WHERE tenant_id=? AND id=?")
        .bind(w.tenant_id, w.engagement_id)
        .first<{ body: string }>(),
      pin =
        input === "evidence"
          ? r.inputs.find(
              (i: { index: number }) =>
                String(i.index) === u.searchParams.get("index"),
            )
          : undefined;
    if (input === "evidence" && !pin)
      throw new ApiError(404, "Attempt input not found");
    const a = JSON.parse(body!.body).artifacts.find(
      (a: Artifact) =>
        a.id ===
        (input === "evidence"
          ? pin.artifactId
          : input === "dataset"
            ? r.dataset.id
            : r.model.artifactId),
    );
    if (
      !a ||
      (input === "evidence" && a.status !== "accepted") ||
      a.sha256 !==
        (input === "evidence"
          ? r.inputHashes[String(pin.index)]
          : r.inputHashes[input === "dataset" ? "dataset" : "modelArtifact"])
    )
      throw new ApiError(409, "Input artifact pin changed");
    assertPlatformBytes(a);
    const o = await bucket().get(a.key);
    if (!o) throw new ApiError(404, "Pinned input bytes unavailable");
    return new Response(o.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Evidence-SHA256": a.sha256,
      },
    });
  } catch (e) {
    return responseError(e);
  }
}
