// TEMPORARY diagnostic for #119 (reverted before merge).
// Replays the failing sequence with Playwright API contexts: a keep-alive
// connection idle for 2-3.5 s, then a save from another context and a read on
// the idle connection 30 ms later. node probe-119-idle.mjs <baseURL> <rounds> <overlap:1|0>
import { createHash } from "node:crypto";
import { request } from "@playwright/test";
const [base, roundsArg, overlapArg] = process.argv.slice(2);
const rounds = Number(roundsArg ?? 50),
  overlap = overlapArg !== "0";
const persona = (id, name) => ({
  "oai-authenticated-user-id": "persona-" + id,
  "oai-authenticated-user-email": id + "@personas.test",
  "oai-authenticated-user-full-name": encodeURIComponent(name),
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
});
const tenantId =
  "tenant-" +
  createHash("sha256").update("persona-qa-lead").digest("hex").slice(0, 24);
const reader = await request.newContext({
  baseURL: base,
  extraHTTPHeaders: persona("qa-auditor", "QA Auditor"),
  timeout: 15000,
});
const writer = await request.newContext({
  baseURL: base,
  extraHTTPHeaders: persona("qa-lead", "QA Lead"),
  timeout: 15000,
});
const get = async (ctx, engagementId) => {
  const q = new URLSearchParams({ tenantId });
  if (engagementId) q.set("engagementId", engagementId);
  const r = await ctx.get("/api/workspace?" + q);
  if (r.status() !== 200) throw new Error("GET " + r.status());
  return r.json();
};
const engagementId = (await get(writer)).engagements.find(
  (e) => e.title === "Acme credit scoring model audit",
).id;
let paperId;
async function save() {
  const w = await get(writer, engagementId);
  const op = paperId ? "editPaper" : "createPaper";
  const data = paperId
    ? {
        paperId,
        body: {
          objective: "o" + Date.now(),
          scope: "",
          criteria: "",
          procedures: "",
          sampling: "",
          results: "",
          limitations: "",
          conclusion: "",
          conclusionStatus: "not_evaluated",
        },
        evidenceIds: [],
        required: true,
      }
    : { templateId: "WP-A10-01" };
  const r = await writer.post("/api/workspace", {
    headers: { Origin: base },
    data: {
      tenantId,
      engagementId,
      expectedVersion: w.engagement.version,
      op,
      data,
    },
  });
  if (r.status() !== 200)
    throw new Error(op + " " + r.status() + " " + (await r.text()));
  if (!paperId) paperId = (await r.json()).details.paperId;
}
await save();
await save();
let ok = 0,
  failed = 0;
for (let i = 0; i < rounds; i++) {
  await get(reader, engagementId);
  await new Promise((res) => setTimeout(res, 2000 + Math.random() * 1500));
  const saving = save();
  if (!overlap) await saving;
  else await new Promise((res) => setTimeout(res, 30));
  const started = Date.now();
  try {
    await get(reader, engagementId);
    ok++;
  } catch (e) {
    failed++;
    console.log(
      `round ${i + 1}: read failed after ${Date.now() - started} ms: ${e.message.split("\n")[0]}`,
    );
  }
  await saving;
}
console.log(`TOTAL idle overlap=${overlap}: ok=${ok} failed=${failed}`);
await reader.dispose();
await writer.dispose();
