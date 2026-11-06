// The GenAI assurance ops (#33, docs/design/genai-evidence.md sections 10.4
// and 12.1) against SQLite D1 and an in-memory R2 bucket: import validation
// (hashes, input pins, custody), the job-type checks of importJob and
// compileGenaiResult, freezing and queueing, and acknowledgements.
import { env } from "cloudflare:workers";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveNew } from "../../criteria/pin";
import type { Artifact, Engagement } from "../../domain";
import { getEngagement } from "../../engagement-repo";
import { freshEngagement } from "../../factories";
import { linkedReadiness } from "../../genai/store";
import { ApiError } from "../../http";
import { sha256 } from "../../ids";
import { member, practice, tenantId } from "../../test-storage";
import type { Context } from "../../tenancy";
import { substantivePlan } from "../../workflow/command";
import type { Procedure } from "../../workflow-types";
import { dispatchAssurance } from "./index";
import { assuranceTarget } from "./target";

const exampleText = readFileSync(
  "../schemas/fixtures/genai-result.example.json",
  "utf8",
);
const example = JSON.parse(exampleText);
const computation = JSON.parse(example.computationJSON);
const [logInput, labelInput] = (
  computation.inputs as { name: string; sha256: string; bytes: number }[]
).map(({ name, sha256, bytes }) => ({ name, sha256, bytes }));

const lead = () => member("lead", "Lead Auditor"),
  auditor = () => member("auditor", "Auditor");
let store: Awaited<ReturnType<typeof practice>>;

function artifact(
  id: string,
  sha: string,
  size: number,
  category = "GenAI log",
): Artifact {
  return {
    id,
    name: id + ".bin",
    category,
    size,
    sha256: sha,
    key: tenantId + "/ENG-G/" + id + "/" + sha,
    createdAt: "2026-11-05T00:00:00.000Z",
    uploadedBy: "auditor",
    visibility: "internal",
    status: "accepted",
    mediaType: "application/octet-stream",
  };
}
/** A GenAI-pack engagement with an approved scope and programme. */
async function engagement(envelopeText = exampleText) {
  const e: Engagement = freshEngagement(
    resolveNew("genai-evaluation"),
    "CL-1",
    "GenAI audit",
    "lead",
    true,
  );
  e.id = "ENG-G";
  const w = e.workflow!;
  w.brief = { revision: 1, status: "approved" } as never;
  w.program.status = "approved";
  w.program.briefRevision = 1;
  const p = w.procedures.find((p) => p.templateId === "WP-GA-02")!;
  p.selected = true;
  p.applicability = "applicable";
  // Kept on first use, as queueing does.
  p.planHash = await sha256(JSON.stringify(substantivePlan(p)));
  const envelopeSha = await sha256(envelopeText);
  e.artifacts.push(
    artifact("EV-LOG", logInput.sha256, logInput.bytes),
    artifact("EV-LABELS", labelInput.sha256, labelInput.bytes),
    artifact(
      "EV-ENV",
      envelopeSha,
      new TextEncoder().encode(envelopeText).length,
    ),
  );
  store = await practice([e]);
  await env.BUCKET!.put(e.artifacts[2].key, envelopeText);
  return { procedure: p };
}
const op = async (
  name: string,
  data: Record<string, unknown>,
  ctx: Context,
) => {
  const e = await getEngagement(ctx, "ENG-G");
  return dispatchAssurance(assuranceTarget(e, ctx), name, data, ctx);
};
const refused = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected a refusal");
};
/** A succeeded job row with its result in R2. */
async function job(
  id: string,
  request: Record<string, unknown>,
  result: string,
) {
  const text = JSON.stringify(request),
    key = tenantId + "/ENG-G/execution/" + id + "/result";
  await env.BUCKET!.put(key, result);
  store.sqlite
    .prepare(
      "INSERT INTO execution_jobs(id,tenant_id,engagement_id,state,request,request_sha256,created_by,created_at,fence,attempt_id,result_key,result_sha256,completed_at) VALUES(?,?,?,'succeeded',?,?,'auditor','2026-11-05T00:00:00.000Z',1,'ATTEMPT-1',?,?,'2026-11-05T00:01:00.000Z')",
    )
    .run(
      id,
      tenantId,
      "ENG-G",
      text,
      await sha256(text),
      key,
      await sha256(result),
    );
}

beforeEach(() => {
  env.DB = undefined;
});
afterEach(() => {
  delete env.DB;
  delete env.BUCKET;
});

describe("importGenaiEnvelope", () => {
  it("records an uploaded envelope with custody capped at L1", async () => {
    await engagement();
    const r = (await op(
      "importGenaiEnvelope",
      { artifactId: "EV-ENV" },
      auditor(),
    )) as { record: { kind: string; body: Record<string, unknown> } };
    expect(r.record.kind).toBe("genai_result");
    expect(r.record.body).toMatchObject({
      artifactId: "EV-ENV",
      custody: "uploaded",
      channel: "cli",
    });
    const e = await getEngagement(auditor(), "ENG-G");
    const [readiness] = await linkedReadiness(auditor(), e, ["EV-ENV"]);
    expect(readiness.effectiveLevel).toBe("L1");
    expect(readiness.blockers.map((b) => b.code)).toEqual([
      "genai_level_below_l2",
    ]);
    const again = await refused(
      op("importGenaiEnvelope", { artifactId: "EV-ENV" }, auditor()),
    );
    expect(again.status).toBe(409);
  });

  it("rejects an envelope whose computation was altered", async () => {
    await engagement(
      JSON.stringify({
        ...example,
        computationJSON: example.computationJSON.replace('"L2"', '"L3"'),
      }),
    );
    const error = await refused(
      op("importGenaiEnvelope", { artifactId: "EV-ENV" }, auditor()),
    );
    expect(error.status).toBe(409);
    expect(error.message).toContain("computationSha256");
  });

  it("rejects an envelope whose inputs are not accepted evidence", async () => {
    await engagement();
    const e = await getEngagement(lead(), "ENG-G");
    e.artifacts.find((a) => a.id === "EV-LABELS")!.status = "quarantined";
    const error = await refused(
      dispatchAssurance(
        assuranceTarget(e, auditor()),
        "importGenaiEnvelope",
        { artifactId: "EV-ENV" },
        auditor(),
      ),
    );
    expect(error.status).toBe(409);
    expect(error.message).toContain("judge_large_200.jsonl");
  });

  it("reads only evidence filed as a GenAI log", async () => {
    await engagement();
    const error = await refused(
      op("importGenaiEnvelope", { artifactId: "EV-NONE" }, auditor()),
    );
    expect(error.status).toBe(400);
  });
});

describe("worker results", () => {
  const pins = async (p: Procedure) => ({
    id: p.id,
    revision: p.revision,
    planHash: await sha256(JSON.stringify(substantivePlan(p))),
    briefRevision: 1,
    programRevision: 1,
  });

  it("compiles a genai_ingest job and authenticates a matching upload", async () => {
    const { procedure } = await engagement();
    await op("importGenaiEnvelope", { artifactId: "EV-ENV" }, auditor());
    await job(
      "JOB-G",
      {
        schemaVersion: "genai-1.0",
        executionMode: "genai_ingest",
        procedure: await pins(procedure),
      },
      exampleText,
    );
    const r = (await op(
      "compileGenaiResult",
      { jobId: "JOB-G" },
      auditor(),
    )) as {
      record: { body: Record<string, unknown> };
    };
    expect(r.record.body).toMatchObject({
      artifactId: "JOB-G",
      custody: "worker",
      procedureId: procedure.id,
    });
    const e = await getEngagement(auditor(), "ENG-G");
    expect(e.artifacts.find((a) => a.id === "JOB-G")).toMatchObject({
      category: "GenAI result",
      status: "accepted",
    });
    const readiness = await linkedReadiness(auditor(), e, ["JOB-G", "EV-ENV"]);
    expect(readiness.map((x) => [x.effectiveLevel, x.blockers.length])).toEqual(
      [
        ["L2", 0],
        ["L2", 0],
      ],
    );
  });

  it("keeps importJob and compileGenaiResult to their own job types", async () => {
    await engagement();
    await job("JOB-G", { executionMode: "genai_ingest" }, exampleText);
    await job(
      "JOB-T",
      { executionMode: "provided_predictions", procedure: {} },
      "{}",
    );
    const tabular = await refused(
      op("compileGenaiResult", { jobId: "JOB-T" }, auditor()),
    );
    expect([tabular.status, tabular.message]).toEqual([
      409,
      "This job is not a GenAI ingest; use importJob",
    ]);
    const genai = await refused(op("importJob", { jobId: "JOB-G" }, auditor()));
    expect([genai.status, genai.message]).toEqual([
      409,
      "This job is a GenAI ingest; use compileGenaiResult",
    ]);
    // Neither read R2 before refusing.
    expect(store.reads).toEqual([]);
  });

  it("refuses a result whose procedure plan changed after queueing", async () => {
    const { procedure } = await engagement();
    await job(
      "JOB-G",
      {
        executionMode: "genai_ingest",
        procedure: { ...(await pins(procedure)), planHash: "0".repeat(64) },
      },
      exampleText,
    );
    const error = await refused(
      op("compileGenaiResult", { jobId: "JOB-G" }, auditor()),
    );
    expect(error.status).toBe(409);
    expect(error.message).toContain("plan or scope changed");
  });
});

describe("plans, bundles and the queue", () => {
  const manifest = {
    schemaVersion: "genai-bundle/0.1",
    origin: "auditee_supplied",
    inputs: [
      { ...logInput, format: "inspect_eval", role: "log" },
      {
        ...labelInput,
        format: "judge_validation_jsonl",
        role: "judge_validation",
        judgeRef: "J1",
      },
    ],
    declared: { systemUnderTest: { family: "other-fixture-sut" } },
  };
  const plan = {
    schemaVersion: "genai-plan/0.1",
    primaryScore: "model_graded_qa",
    criteria: [
      {
        id: "acc",
        kind: "genai_mean",
        metric: "accuracy",
        band: { lower: 0.7 },
      },
    ],
  };

  it("freezes a plan, declares a bundle and queues a genai-1.0 request", async () => {
    const { procedure } = await engagement();
    const frozen = (await op(
      "freezeGenaiPlan",
      { procedureId: procedure.id, plan },
      auditor(),
    )) as { record: { id: string } };
    const bundle = (await op(
      "declareGenaiBundle",
      { manifest, inputArtifactIds: ["EV-LOG", "EV-LABELS"] },
      auditor(),
    )) as unknown as {
      record: { id: string; body: { manifest: { declaredBy: string } } };
    };
    expect(bundle.record.body.manifest.declaredBy).toBe("auditor");
    const queued = (await op(
      "queueGenaiIngest",
      {
        procedureId: procedure.id,
        bundleRecordId: bundle.record.id,
        planRecordId: frozen.record.id,
      },
      auditor(),
    )) as Response;
    const { jobId } = (await queued.json()) as { jobId: string };
    const row = store.sqlite
      .prepare("SELECT state,request FROM execution_jobs WHERE id=?")
      .get(jobId) as { state: string; request: string };
    expect(row.state).toBe("queued");
    const request = JSON.parse(row.request);
    expect(request).toMatchObject({
      schemaVersion: "genai-1.0",
      executionMode: "genai_ingest",
      inputHashes: { "0": logInput.sha256, "1": labelInput.sha256 },
      procedure: { id: procedure.id, briefRevision: 1 },
      plan: { primaryScore: "model_graded_qa" },
    });
    expect(
      request.inputs.map((i: { artifactId: string }) => i.artifactId),
    ).toEqual(["EV-LOG", "EV-LABELS"]);
  });

  it("refuses a plan that lowers the judge floor and a manifest with other bytes", async () => {
    const { procedure } = await engagement();
    await expect(
      op(
        "freezeGenaiPlan",
        {
          procedureId: procedure.id,
          plan: { ...plan, judgeValidation: { minimumKappaLowerBound: 0.5 } },
        },
        auditor(),
      ),
    ).rejects.toThrow("0.60 (D-10)");
    const error = await refused(
      op(
        "declareGenaiBundle",
        {
          manifest: {
            ...manifest,
            inputs: [{ ...manifest.inputs[0], bytes: 1 }, manifest.inputs[1]],
          },
          inputArtifactIds: ["EV-LOG", "EV-LABELS"],
        },
        auditor(),
      ),
    );
    expect(error.status).toBe(409);
  });

  it("refuses a procedure outside the approved programme", async () => {
    await engagement();
    const error = await refused(
      op("freezeGenaiPlan", { procedureId: "PROC-WP-GA-03", plan }, auditor()),
    );
    expect(error.status).toBe(409);
  });
});

describe("acknowledgeGenaiFlag", () => {
  it("is for an independent reviewer of a flag that awaits acknowledgement", async () => {
    await engagement();
    const imported = (await op(
      "importGenaiEnvelope",
      { artifactId: "EV-ENV" },
      lead(),
    )) as { record: { id: string } };
    const data = {
      resultRecordId: imported.record.id,
      flag: "post_run_edits",
      runKey: computation.runs[0].runKey,
      rationale: "Reviewed the edit log",
    };
    expect(
      (await refused(op("acknowledgeGenaiFlag", data, lead()))).status,
    ).toBe(403);
    const reviewer = member("lead-2", "Lead Auditor");
    store.sqlite
      .prepare(
        "INSERT INTO memberships(tenant_id,user_id,role,display_name) VALUES(?,?,?,?)",
      )
      .run(tenantId, "lead-2", "Lead Auditor", "lead-2");
    store.sqlite
      .prepare(
        "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES(?,?,?,1,'lead',?)",
      )
      .run(tenantId, "ENG-G", "lead-2", "2026-11-01T00:00:00.000Z");
    // The example has no post-run edits, so nothing awaits acknowledgement.
    expect(
      (await refused(op("acknowledgeGenaiFlag", data, reviewer))).status,
    ).toBe(409);
  });
});
