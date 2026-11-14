// Seeds a demo practice for the development personas in
// fixtures/dev-personas.json through the running app's own API, so multi-role
// flows are reachable in minutes: qa-lead's practice with the client "Acme", a
// structured engagement, every persona's membership and engagement grant, and
// an evidence request that qa-contrib can answer in the client portal, and a
// second engagement whose approved program pins a registered model, so the
// workbench's model and execution dialogs open (seedTesting). qa-lead2
// also leads a practice of their own (practice switching); qa-outsider stays
// outside. Running it again changes nothing that is already in place.
//
//   npm run dev                  then, in another terminal:
//   npm run seed:demo            (the dev server on http://127.0.0.1:5173)
//   npm run seed:demo -- http://127.0.0.1:5184
//   npm run seed:demo -- --trusted-headers http://127.0.0.1:8787
//
// --trusted-headers sends the persona as oai-* headers, for a built Worker
// started in trusted-headers mode (docs/security/identity.md) with
// SELF_SIGNUP=open, so that qa-lead and qa-lead2 may provision their
// practices (npm start -- --var SELF_SIGNUP:open ...); otherwise each
// persona signs in through /signin-with-chatgpt?as=<id> like a browser.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

const args = process.argv.slice(2);
const trustedHeaders = args.includes("--trusted-headers");
const base = (
  args.find((arg) => !arg.startsWith("--")) ?? "http://127.0.0.1:5173"
).replace(/\/+$/, "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) {
  console.error("seed:demo only seeds a loopback development server.");
  process.exit(1);
}

const fixture = JSON.parse(
  await fs.readFile(
    new URL("../fixtures/dev-personas.json", import.meta.url),
    "utf8",
  ),
);
const persona = Object.fromEntries(fixture.personas.map((p) => [p.id, p]));
const lead = persona["qa-lead"];
const clientRoles = ["Client Viewer", "Client Contributor"];
const CLIENT = { name: "Acme", sector: "Financial services" };
const TITLE = "Acme credit scoring model audit";
const PAPER_TEMPLATE = "WP-A10-01";
const REQUEST_SUBJECT = "Training data lineage and representativeness";
const DAY = 86_400_000;

const sessions = new Map();
/** The request headers that identify `who`. */
async function identify(who) {
  if (trustedHeaders)
    return {
      "oai-authenticated-user-id": who.userId,
      "oai-authenticated-user-email": who.email,
      "oai-authenticated-user-full-name": encodeURIComponent(who.name),
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    };
  if (!sessions.has(who.id)) {
    const response = await fetch(
      base +
        "/signin-with-chatgpt?" +
        new URLSearchParams({ as: who.id, return_to: "/" }),
      { redirect: "manual" },
    );
    // The dev server names its sign-in cookie for its port.
    const cookie = response.headers
      .getSetCookie()
      .find((c) => /^__sites_local_auth_\d+=/.test(c));
    if (response.status !== 302 || !cookie)
      throw new Error(
        `Persona sign-in failed (HTTP ${response.status}). Is \`npm run dev\` serving ${base}? For a built Worker in trusted-headers mode pass --trusted-headers.`,
      );
    sessions.set(who.id, cookie.split(";")[0]);
  }
  return { Cookie: sessions.get(who.id) };
}

async function api(who, path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(await identify(who)),
      ...(body ? { "Content-Type": "application/json", Origin: base } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = { error: text.slice(0, 300) };
  }
  if (!response.ok)
    throw new Error(
      `${who.id}: ${body?.op ?? "GET"} ${path.split("?")[0]} answered ${response.status}: ${value.error ?? ""}`,
    );
  return value;
}

/** The practice provisioned at a persona's first sign-in (lib/tenancy.ts). */
function ownPractice(who) {
  return (
    "tenant-" +
    createHash("sha256").update(who.userId).digest("hex").slice(0, 24)
  );
}

const TESTING_TITLE = "Acme credit scoring model evaluation";
const TESTING_PROCEDURE = "WP-A15-01";
const MODEL = "Credit scorer";
const PREDICTIONS = "predictions.csv";
const attest = { attestation: { rationale: "Seeded demo data (seed:demo)" } };

/**
 * A second engagement of the demo client, kept apart so the demo engagement
 * stays as the end-to-end specs expect: an approved scope and program whose
 * one automated procedure pins a registered saved-predictions model, an
 * accepted dataset and a protocol, plus a dataset card, a system revision
 * and its prediction lineage. The workbench's model and execution dialogs
 * (Register system, Link predictions, Freeze external execution) open on it.
 * qa-lead prepares; qa-reviewer approves the scope and the program.
 */
async function seedTesting({ tenantId, clientId, w: practice, manage }) {
  const reviewer = persona["qa-reviewer"];
  let engagementId =
    practice.engagements.find(
      (e) => e.client_id === clientId && e.title === TESTING_TITLE,
    )?.id ?? "";
  if (!engagementId) {
    engagementId = (
      await manage("createEngagement", { clientId, title: TESTING_TITLE })
    ).engagementId;
    done.push(`created engagement "${TESTING_TITLE}"`);
  }
  let w;
  const load = async (who = lead) =>
    (w = await api(
      who,
      "/api/workspace?" + new URLSearchParams({ tenantId, engagementId }),
    ));
  await load();
  if (!w.people.some((p) => p.user_id === reviewer.userId)) {
    // Listed engagements are added to the member's earlier grants.
    await manage("updateMember", {
      userId: reviewer.userId,
      displayName: reviewer.name,
      role: reviewer.role,
      clientId: null,
      engagementIds: [engagementId],
    });
    done.push("granted qa-reviewer the testing engagement");
    await load();
  }
  const command = async (op, data = {}, who = lead) => {
    await load(who);
    const result = await api(who, "/api/workspace", {
      tenantId,
      engagementId,
      expectedVersion: w.engagement.version,
      op,
      data,
    });
    await load();
    return result.details;
  };
  const assurance = async (op, data) =>
    (
      await api(lead, "/api/assurance", {
        tenantId,
        engagementId,
        op,
        data,
      })
    ).record;
  const records = async (kind) =>
    (
      await api(
        lead,
        "/api/assurance?" +
          new URLSearchParams({ tenantId, engagementId, kind }),
      )
    ).records ?? [];
  const e = () => w.engagement;

  let dataset = e().artifacts.find((a) => a.name === PREDICTIONS);
  if (!dataset) {
    const form = new FormData();
    for (const [k, v] of Object.entries({
      tenantId,
      engagementId,
      expectedVersion: String(e().version),
      category: "Dataset",
      handlingBasis: "synthetic",
      visibility: "internal",
    }))
      form.append(k, v);
    form.append(
      "file",
      new Blob(
        [
          await fs.readFile(
            new URL("../../engine/examples/predictions.csv", import.meta.url),
          ),
        ],
        { type: "text/csv" },
      ),
      PREDICTIONS,
    );
    const response = await fetch(base + "/api/evidence", {
      method: "POST",
      headers: { ...(await identify(lead)), Origin: base },
      body: form,
    });
    if (!response.ok)
      throw new Error(
        `qa-lead: upload ${PREDICTIONS} answered ${response.status}: ${await response.text()}`,
      );
    await load();
    dataset = e().artifacts.find((a) => a.name === PREDICTIONS);
    done.push("uploaded " + PREDICTIONS);
  }
  if (dataset.status !== "accepted") {
    await command("acceptEvidence", { artifactId: dataset.id, ...attest });
    dataset = e().artifacts.find((a) => a.id === dataset.id);
    done.push("accepted " + PREDICTIONS);
  }

  let model = e().models.find((m) => m.name === MODEL);
  if (!model) {
    const { modelId } = await command("createModel", {
      name: MODEL,
      version: "3.2",
      task: "Binary classification",
      format: "Prediction file",
      intendedPurpose:
        "Creditworthiness assessment of consumer loan applicants",
      artifactId: dataset.id,
    });
    model = e().models.find((m) => m.id === modelId);
    done.push(`registered model ${MODEL} 3.2`);
  }
  let profile = e().evaluationProfiles?.find((p) => p.task === model.task);
  if (!profile) {
    const { profileId } = await command("createEvaluationProfile", {
      name: "Credit scoring performance and fairness",
      version: "1.0",
      task: "Binary classification",
      suite: [
        "performance",
        "demographic_parity",
        "disparate_impact",
        "equalized_odds",
      ],
      config: {
        labelColumn: "actual",
        predictionColumn: "predicted",
        groupColumn: "group",
        positiveLabel: "1",
        minimumGroupSize: 5,
        maximumParityGap: 0.2,
        minimumImpactRatio: 0.7,
        minimumAccuracy: 0.8,
      },
      datasetContext: {
        split: "test",
        population: "Synthetic applicants of the example file",
        predictionProvenance: "Saved predictions of the scoring service",
        independence: "Synthetic example; no holdout independence claim",
        sensitiveDataBasis: "Synthetic groups; no personal data",
      },
      rationale: "Demo thresholds; they check arithmetic, not conformity",
      specialCategory: { specialCategory: false },
    });
    profile = e().evaluationProfiles.find((p) => p.id === profileId);
    done.push("saved an evaluation protocol");
  }

  const brief = () => e().workflow.brief;
  if (brief()?.status !== "approved") {
    if (!brief() || brief().status === "draft") {
      if (!brief())
        await command("saveBrief", {
          systemName: "Credit scoring model",
          intendedUse:
            "Creditworthiness assessment of consumer loan applicants",
          boundary: "Scoring service and its decision-support interface",
          periodStart: "2026-01-01",
          periodEnd: "2026-09-30",
          actorResponsibilities: "The provider develops; the bank deploys",
          audience: "Board risk committee",
          deliverables: "Readiness report",
          basis: "Demo methodology; readiness against the criteria",
          constraints: "Synthetic and anonymized data only",
          independence: "",
          changeImpact: "",
        });
      await command("submitBrief");
    }
    await command(
      "approveBrief",
      {
        revision: brief().revision,
        reason: "Scope, responsibilities and period reviewed (seed:demo)",
      },
      reviewer,
    );
    done.push("approved the testing engagement's scope");
  }

  const program = () => e().workflow.program;
  const procedure = () =>
    e().workflow.procedures.find((p) => p.templateId === TESTING_PROCEDURE);
  if (program().status !== "approved") {
    if (program().status === "draft") {
      if (!procedure().selected) {
        await command("scopeProgramCandidates", {
          procedureIds: e().workflow.procedures.map((p) => p.id),
          selected: false,
          applicability: "not_applicable",
          rationale:
            "Demo: outside this engagement's agreed scope; no legal exclusion claim",
          periodAnalysis: "Assessed for the audit period of the brief",
        });
        const p = procedure();
        await command("saveProcedurePlan", {
          procedureId: p.id,
          assignmentRevision: p.assignmentRevision ?? 1,
          plan: {
            selected: true,
            applicability: "readiness",
            rationale: "Selected for the demo's automated evaluation",
            criterion: p.criterion || "Accuracy is declared and measured",
            sourceVersion: p.sourceVersion,
            periodAnalysis: "Applies throughout the audit period",
            population: "The saved predictions of the example file",
            sampling: "Every row of the accepted prediction file",
            ownerId: lead.userId,
            reviewerId: reviewer.userId,
            dueDate: "2026-12-31",
            method: "automated",
            modelId: model.id,
            datasetId: dataset.id,
            profileId: profile.id,
          },
        });
      }
      await command("submitProgram");
    }
    await command(
      "approveProgram",
      {
        revision: program().revision,
        reason: "Selection, criteria, sample and assignments reviewed",
      },
      reviewer,
    );
    done.push(`approved the testing program with ${TESTING_PROCEDURE}`);
  }

  if (!(await records("dataset")).length) {
    await assurance("registerDataset", {
      schemaVersion: "1.0",
      name: "Credit scoring example predictions",
      version: "1",
      artifactId: dataset.id,
      owner: "Acme model risk",
      split: "test",
      population: "Synthetic applicants of the example file",
      periodStart: "2026-01-01",
      periodEnd: "2026-09-30",
      collectionMethod: "Generated example rows",
      independence: "Synthetic example only",
      sensitiveDataBasis: "Synthetic groups; no personal data",
      limitations: "No real audit assurance",
      baselineRationale: "",
    });
    done.push("registered a dataset card");
  }
  let system = (await records("system"))[0];
  if (!system) {
    system = await assurance("registerSystem", {
      name: "Credit scoring service",
      version: "1",
      intendedUse: "Creditworthiness assessment of consumer loan applicants",
      population: "Synthetic applicants only",
      modelIds: [model.id],
      features: [
        {
          name: "feature_age",
          type: "number",
          unit: "years",
          nullable: false,
          nullHandling: "reject",
          categories: [],
        },
      ],
      outputs: {
        semantics: "1 approves the application; 0 declines it",
        classOrder: ["0", "1"],
        threshold: 0.5,
      },
      humanDecision: "A credit officer reviews each decline",
      runtime: "Saved predictions",
      limitations: "Demo system revision",
    });
    done.push("registered a system revision");
  }
  if (!(await records("prediction")).length) {
    await assurance("registerPrediction", {
      modelId: model.id,
      systemId: system.id,
      datasetId: dataset.id,
      sourceDatasetId: dataset.id,
      producedAt: new Date().toISOString(),
      producingRun: "example-generation",
      inferenceConfiguration: "Deterministic example predictions",
      mode: "provided_predictions",
      limitations: "Declared lineage only",
    });
    done.push("linked prediction lineage");
  }
  return engagementId;
}

const done = [];
try {
  // First sign-ins provision qa-lead2's own practice and the demo practice.
  await api(persona["qa-lead2"], "/api/workspace");
  await api(lead, "/api/workspace");
  const tenantId = ownPractice(lead);
  let engagementId = "";
  let w;
  const load = async () =>
    (w = await api(
      lead,
      "/api/workspace?" +
        new URLSearchParams({
          tenantId,
          ...(engagementId ? { engagementId } : {}),
        }),
    ));
  const manage = async (op, data) => {
    const result = await api(lead, "/api/management", {
      tenantId,
      expectedVersion: w.managementVersion,
      op,
      data,
    });
    await load();
    return result.details;
  };
  const command = async (op, data) => {
    const result = await api(lead, "/api/workspace", {
      tenantId,
      engagementId,
      expectedVersion: w.engagement.version,
      op,
      data,
    });
    await load();
    return result.details;
  };
  await load();
  if (!w.identity.practiceAdmin)
    throw new Error("qa-lead does not administer " + tenantId);

  let client = w.clients.find((c) => c.name === CLIENT.name);
  if (!client) {
    client = { id: (await manage("createClient", CLIENT)).clientId };
    done.push(`created client ${CLIENT.name}`);
  }
  engagementId =
    w.engagements.find((e) => e.client_id === client.id && e.title === TITLE)
      ?.id ?? "";
  if (!engagementId) {
    engagementId = (
      await manage("createEngagement", { clientId: client.id, title: TITLE })
    ).engagementId;
    done.push(`created engagement "${TITLE}"`);
  }
  await load();

  for (const who of fixture.personas) {
    if (!who.role || who === lead) continue;
    const client_id = clientRoles.includes(who.role) ? client.id : null;
    const member = w.members.find((m) => m.user_id === who.userId);
    const granted =
      clientRoles.includes(who.role) ||
      w.people.some((p) => p.user_id === who.userId);
    if (
      member?.status === "active" &&
      member.role === who.role &&
      member.client_id === client_id &&
      granted
    )
      continue;
    await manage("grantMember", {
      userId: who.userId,
      displayName: who.name,
      role: who.role,
      clientId: client_id,
      ...(client_id ? {} : { engagementIds: [engagementId] }),
    });
    done.push(`granted ${who.id} ${who.role}`);
  }

  const e = () => w.engagement;
  let paper = e().papers.find((p) => p.templateId === PAPER_TEMPLATE);
  if (!paper) {
    const { paperId } = await command("createPaper", {
      templateId: PAPER_TEMPLATE,
    });
    paper = e().papers.find((p) => p.id === paperId);
    done.push("created working paper " + PAPER_TEMPLATE);
  }
  let request = e().evidenceRequests.find((r) => r.subject === REQUEST_SUBJECT);
  if (!request) {
    const { requestId } = await command("createEvidenceRequest", {
      subject: REQUEST_SUBJECT,
      description:
        "Lineage of the credit scoring training data and how its population represents current applicants.",
      responsibleParty: "Acme data office",
      periodVersion: "Model 3.2 training snapshot",
      handling: "Synthetic or anonymized extracts only.",
      dueDate: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10),
      paperIds: [paper.id],
    });
    request = e().evidenceRequests.find((r) => r.id === requestId);
    done.push("created evidence request " + request.id);
  }
  const contributor = persona["qa-contrib"];
  if (
    !e().workflow?.clientGrants.some(
      (g) =>
        g.active &&
        g.userId === contributor.userId &&
        g.requestId === request.id &&
        Date.parse(g.expiresAt) > Date.now() + DAY,
    )
  ) {
    await command("grantClientRequest", {
      userId: contributor.userId,
      requestId: request.id,
      prompt: "Upload the training data lineage summary.",
      instructions:
        "Describe the sources, extraction dates and any reweighting; synthetic or anonymized data only.",
      category: "Dataset",
      handlingBasis: "synthetic",
      expiresAt: new Date(Date.now() + 90 * DAY).toISOString(),
    });
    done.push("granted qa-contrib the evidence request");
  }

  const testingId = await seedTesting({
    tenantId,
    clientId: client.id,
    w,
    manage,
  });

  const deepLink =
    "/?" +
    new URLSearchParams({
      view: "Overview",
      practice: tenantId,
      engagement: engagementId,
    });
  console.log(
    done.length
      ? "Seeded: " + done.join("; ") + "."
      : "The demo practice was already seeded.",
  );
  console.log(
    `Practice ${tenantId}, client ${CLIENT.name} (${client.id}), engagement ${engagementId}.`,
  );
  console.log(
    `Testing engagement "${TESTING_TITLE}" ${testingId}: ${base}/?${new URLSearchParams(
      {
        view: "Assurance workbench",
        practice: tenantId,
        engagement: testingId,
        section: "execution",
      },
    )}\n`,
  );
  console.log("Sign in as a persona (loopback development server):");
  for (const who of fixture.personas)
    console.log(
      `  ${who.id.padEnd(12)} ${(who.role ?? "none").padEnd(28)} ${base}/signin-with-chatgpt?${new URLSearchParams(
        { as: who.id, return_to: who.role ? deepLink : "/" },
      )}`,
    );
} catch (error) {
  console.error(
    "seed:demo failed:",
    error instanceof Error
      ? error.cause instanceof Error
        ? `${error.message} (${error.cause.message})`
        : error.message
      : error,
  );
  process.exit(1);
}
