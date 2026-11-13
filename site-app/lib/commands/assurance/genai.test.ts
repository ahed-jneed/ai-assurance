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
import {
  RERUN_STATEMENT,
  attestationPayload,
  genaiArtifactLevels,
} from "../../genai/evidence-levels";
import { linkedReadiness } from "../../genai/store";
import { ApiError } from "../../http";
import { sha256 } from "../../ids";
import { genaiView } from "../../read-models/genai-view";
import { member, practice, tenantId } from "../../test-storage";
import type { Context } from "../../tenancy";
import { substantivePlan } from "../../workflow/command";
import type { Procedure } from "../../workflow-types";
import { papers } from "../papers";
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
async function engagement(envelopeText = exampleText, ownerId = "") {
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
  if (ownerId) p.ownerId = ownerId;
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

  it("end to end: blocks a conclusion without a validated judge and passes with one", async () => {
    const { procedure } = await engagement();
    // The same bundle judged against a label file that fails the D-10 floor.
    const c = JSON.parse(example.computationJSON);
    c.criteria[0].flags = [
      {
        flag: "judge_not_validated",
        runKey: c.runs[0].runKey,
        score: "model_graded_qa",
        judgeRef: "J1",
        reasons: ["kappa_lower_bound_below_floor"],
      },
    ];
    const computationJSON = JSON.stringify(c),
      failed = JSON.stringify({
        ...example,
        computationJSON,
        computationSha256: await sha256(computationJSON),
      });
    const request = {
      schemaVersion: "genai-1.0",
      executionMode: "genai_ingest",
      procedure: await pins(procedure),
    };
    await job("JOB-F", request, failed);
    await job("JOB-G", request, exampleText);
    await op("compileGenaiResult", { jobId: "JOB-F" }, auditor());
    await op("compileGenaiResult", { jobId: "JOB-G" }, auditor());
    const e = await getEngagement(auditor(), "ENG-G");
    const paper =
      e.papers.find((p) => p.templateId === "WP-GA-02") ??
      (await papers.run(
        e,
        "createPaper",
        { templateId: "WP-GA-02" },
        auditor(),
      ),
      e.papers.at(-1)!);
    const conclude = async (evidenceIds: string[]) =>
      papers.run(
        e,
        "editPaper",
        {
          paperId: paper.id,
          body: { ...paper.body, conclusionStatus: "supported" },
          evidenceIds,
          required: paper.required,
        },
        auditor(),
      );
    const blocked = await refused(conclude(["JOB-F"]));
    expect(blocked.status).toBe(400);
    expect(blocked.message).toContain("genai_judge_not_validated");
    const missing = await refused(conclude([]));
    expect(missing.message).toContain("genai_result_missing");
    await conclude(["JOB-G"]);
    expect(e.papers.find((p) => p.id === paper.id)!.body).toMatchObject({
      conclusionStatus: "supported",
    });
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

  it("refuses queueing at 10 pending jobs counted beyond the 100 most recent (#151)", async () => {
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
    )) as unknown as { record: { id: string } };
    const insert = store.sqlite.prepare(
      "INSERT INTO execution_jobs(id,tenant_id,engagement_id,state,request,request_sha256,created_by,created_at) VALUES(?,?,'ENG-G',?,'{}',?,'auditor',?)",
    );
    // Ten pending jobs older than a hundred newer finished ones.
    for (let i = 0; i < 10; i++)
      insert.run(
        "JOB-OLD-" + i,
        tenantId,
        "queued",
        "0".repeat(64),
        "2026-10-01T00:00:0" + i + ".000Z",
      );
    for (let i = 0; i < 100; i++)
      insert.run(
        "JOB-NEW-" + i,
        tenantId,
        "failed",
        "0".repeat(64),
        "2026-11-0" + (1 + (i % 4)) + "T00:00:00.000Z",
      );
    const queue = () =>
      op(
        "queueGenaiIngest",
        {
          procedureId: procedure.id,
          bundleRecordId: bundle.record.id,
          planRecordId: frozen.record.id,
        },
        auditor(),
      );
    const error = await refused(queue());
    expect(error.status).toBe(429);
    store.sqlite
      .prepare("UPDATE execution_jobs SET state='cancelled' WHERE id=?")
      .run("JOB-OLD-0");
    expect(((await queue()) as Response).status).toBe(200);
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
    const reviewer = secondLead();
    // The example has no post-run edits, so nothing awaits acknowledgement.
    expect(
      (await refused(op("acknowledgeGenaiFlag", data, reviewer))).status,
    ).toBe(409);
  });

  const secondLead = () => {
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
    return member("lead-2", "Lead Auditor");
  };
  const acknowledge = (resultRecordId: string, ctx: Context) =>
    op(
      "acknowledgeGenaiFlag",
      {
        resultRecordId,
        flag: "scorer_kind_declared",
        runKey: computation.runs[0].runKey,
        score: "model_graded_qa",
        rationale: "Reviewed the declaration",
      },
      ctx,
    );
  const preparerRefusal =
    "The person who imported or compiled the result, declared its bundle or prepared its procedure cannot acknowledge its flags";
  const workerRequest = async (
    procedure: Procedure,
    records?: { bundle: string },
  ) => ({
    schemaVersion: "genai-1.0",
    executionMode: "genai_ingest",
    procedure: {
      id: procedure.id,
      revision: procedure.revision,
      planHash: await sha256(JSON.stringify(substantivePlan(procedure))),
      briefRevision: 1,
      programRevision: 1,
    },
    ...(records ? { records } : {}),
  });

  it("refuses the bundle's declarer as the engine recorded it", async () => {
    const c = JSON.parse(example.computationJSON);
    c.manifest.declaredBy = "lead-2";
    const computationJSON = JSON.stringify(c),
      declared = JSON.stringify({
        ...example,
        computationJSON,
        computationSha256: await sha256(computationJSON),
      });
    await engagement(declared);
    const imported = (await op(
      "importGenaiEnvelope",
      { artifactId: "EV-ENV" },
      auditor(),
    )) as { record: { id: string; body: Record<string, unknown> } };
    expect(imported.record.body.declaredBy).toBe("lead-2");
    const error = await refused(acknowledge(imported.record.id, secondLead()));
    expect([error.status, error.message]).toEqual([403, preparerRefusal]);
  });

  it("refuses the declarer of the bundle a worker result was queued from", async () => {
    const { procedure } = await engagement();
    const lead2 = secondLead();
    const bundle = (await op(
      "declareGenaiBundle",
      {
        manifest: {
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
        },
        inputArtifactIds: ["EV-LOG", "EV-LABELS"],
      },
      lead2,
    )) as { record: { id: string } };
    await job(
      "JOB-G",
      await workerRequest(procedure, { bundle: bundle.record.id }),
      exampleText,
    );
    const compiled = (await op(
      "compileGenaiResult",
      { jobId: "JOB-G" },
      auditor(),
    )) as { record: { id: string; body: Record<string, unknown> } };
    expect(compiled.record.body.bundleRecordId).toBe(bundle.record.id);
    const error = await refused(acknowledge(compiled.record.id, lead2));
    expect([error.status, error.message]).toEqual([403, preparerRefusal]);
  });

  it("refuses the preparer of the procedure the result belongs to", async () => {
    const { procedure } = await engagement(exampleText, "lead-2");
    await job("JOB-G", await workerRequest(procedure), exampleText);
    const compiled = (await op(
      "compileGenaiResult",
      { jobId: "JOB-G" },
      auditor(),
    )) as { record: { id: string } };
    const error = await refused(acknowledge(compiled.record.id, secondLead()));
    expect([error.status, error.message]).toEqual([403, preparerRefusal]);
    // The Lead Auditor prepared none of it: only the pending check remains.
    expect(
      (await refused(acknowledge(compiled.record.id, lead()))).status,
    ).toBe(409);
  });
});

describe("the results view (#145)", () => {
  const enrol = (id: string, capabilities: string[], active = 1) =>
    store.sqlite
      .prepare(
        "INSERT INTO runner_workers(id,tenant_id,engagement_id,name,token_hash,image_digest,capabilities,active,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,'lead','2026-11-05T00:00:00.000Z')",
      )
      .run(
        id,
        tenantId,
        "ENG-G",
        id,
        "hash-" + id,
        "sha256:" + "0".repeat(64),
        JSON.stringify(capabilities),
        active,
      );

  it("counts only active workers of the engagement enrolled with genai_ingest", async () => {
    await engagement();
    expect((await genaiView(auditor(), "ENG-G")).ingestWorkers).toBe(0);
    enrol("W-TABULAR", ["provided_predictions", "ONNX"]);
    enrol("W-REVOKED", ["genai_ingest"], 0);
    expect((await genaiView(auditor(), "ENG-G")).ingestWorkers).toBe(0);
    enrol("W-GENAI", ["provided_predictions", "genai_ingest"]);
    expect((await genaiView(auditor(), "ENG-G")).ingestWorkers).toBe(1);
    // A worker whose sponsor lost engagement access does not count, as the
    // runner route would not serve it a job either.
    store.sqlite
      .prepare(
        "UPDATE engagement_access SET active=0 WHERE engagement_id='ENG-G' AND user_id='lead'",
      )
      .run();
    expect((await genaiView(auditor(), "ENG-G")).ingestWorkers).toBe(0);
    store.sqlite
      .prepare(
        "UPDATE engagement_access SET active=1 WHERE engagement_id='ENG-G' AND user_id='lead'",
      )
      .run();
    expect((await genaiView(auditor(), "ENG-G")).ingestWorkers).toBe(1);
    // Another engagement's worker does not count.
    store.sqlite
      .prepare("UPDATE runner_workers SET engagement_id='ENG-X' WHERE id=?")
      .run("W-GENAI");
    expect((await genaiView(auditor(), "ENG-G")).ingestWorkers).toBe(0);
  });

  it("records the attestation form's payload and gives each vault file its level", async () => {
    await engagement();
    await op("importGenaiEnvelope", { artifactId: "EV-ENV" }, auditor());
    const before = await genaiView(auditor(), "ENG-G");
    let e = await getEngagement(auditor(), "ENG-G");
    const levels = genaiArtifactLevels(before.results, e.artifacts);
    expect(levels.get("EV-ENV")).toMatchObject({ level: "L1", role: "result" });
    expect(levels.get("EV-LOG")).toMatchObject({ level: "L1", role: "input" });
    expect(levels.get("EV-LABELS")).toMatchObject({ role: "input" });

    const payload = attestationPayload(
      {
        artifactIds: ["EV-LOG", "EV-LABELS"],
        harnessName: "inspect_ai",
        harnessVersion: "0.3.90",
        imageDigest: "",
        endpointHost: "api.example.com",
        snapshot: "fixture-2026-10",
        start: "2026-11-05T09:00",
        end: "2026-11-05T10:00",
        environment: "",
        statement: RERUN_STATEMENT,
      },
      e.artifacts,
    );
    await op("attestGenaiRerun", payload, auditor());
    const after = await genaiView(auditor(), "ENG-G");
    expect(after.attestations).toHaveLength(1);
    expect(after.attestations[0].bundleSha256s).toEqual([
      logInput.sha256,
      labelInput.sha256,
    ]);
    // Every input is pinned, but an uploaded envelope stays at L1 at most.
    expect(after.results[0].attested).toBe(true);
    e = await getEngagement(auditor(), "ENG-G");
    expect(
      genaiArtifactLevels(after.results, e.artifacts).get("EV-ENV"),
    ).toMatchObject({ level: "L1" });
  });
});
