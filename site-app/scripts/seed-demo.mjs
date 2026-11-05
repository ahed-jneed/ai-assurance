// Seeds a demo practice for the development personas in
// fixtures/dev-personas.json through the running app's own API, so multi-role
// flows are reachable in minutes: qa-lead's practice with the client "Acme", a
// structured engagement, every persona's membership and engagement grant, and
// an evidence request that qa-contrib can answer in the client portal. qa-lead2
// also leads a practice of their own (practice switching); qa-outsider stays
// outside. Running it again changes nothing that is already in place.
//
//   npm run dev                  then, in another terminal:
//   npm run seed:demo            (the dev server on http://127.0.0.1:5173)
//   npm run seed:demo -- http://127.0.0.1:5184
//   npm run seed:demo -- --trusted-headers http://127.0.0.1:8787
//
// --trusted-headers sends the persona as oai-* headers, for a built Worker
// started in trusted-headers mode (docs/security/identity.md); otherwise each
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
    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith("__sites_local_auth="));
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
    `Practice ${tenantId}, client ${CLIENT.name} (${client.id}), engagement ${engagementId}.\n`,
  );
  console.log("Sign in as a persona (loopback development server):");
  for (const who of fixture.personas)
    console.log(
      `  ${who.id.padEnd(12)} ${(who.role ?? "none").padEnd(19)} ${base}/signin-with-chatgpt?${new URLSearchParams(
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
