// TEMPORARY diagnostic for #119 (reverted before merge).
// Probe: overlap engagement saves with workspace reads on the e2e Worker and
// count reads that never answer. node probe.mjs <baseURL> <rounds> <overlap:1|0>
import { createHash } from "node:crypto";
const [base, roundsArg, overlapArg, histArg] = process.argv.slice(2);
const rounds = Number(roundsArg ?? 20),
  overlap = overlapArg !== "0";
const who = {
  userId: "persona-qa-lead",
  email: "qa-lead@personas.test",
  name: "QA Lead",
};
const headers = {
  "oai-authenticated-user-id": who.userId,
  "oai-authenticated-user-email": who.email,
  "oai-authenticated-user-full-name": encodeURIComponent(who.name),
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};
const tenantId =
  "tenant-" +
  createHash("sha256").update(who.userId).digest("hex").slice(0, 24);
async function get(engagementId, ms = 15000) {
  const q = new URLSearchParams({ tenantId });
  if (engagementId) q.set("engagementId", engagementId);
  const r = await fetch(base + "/api/workspace?" + q, {
    headers,
    signal: AbortSignal.timeout(ms),
  });
  if (r.status !== 200)
    throw new Error("GET " + r.status + " " + (await r.text()));
  return r.json();
}
const list = await get();
const engagementId = list.engagements.find(
  (e) => e.title === "Acme credit scoring model audit",
).id;
async function command(op, data) {
  const w = await get(engagementId);
  const r = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", Origin: base },
    body: JSON.stringify({
      tenantId,
      engagementId,
      expectedVersion: w.engagement.version,
      op,
      data,
    }),
  });
  if (r.status !== 200)
    throw new Error(op + " " + r.status + " " + (await r.text()));
  return (await r.json()).details;
}
const body = (n) => ({
  objective: "o" + n,
  scope: "",
  criteria: "",
  procedures: "",
  sampling: "",
  results: "",
  limitations: "",
  conclusion: "",
  conclusionStatus: "not_evaluated",
});
const edit = (paperId, n) =>
  command("editPaper", {
    paperId,
    body: body(n),
    evidenceIds: [],
    required: true,
  });
// Papers with an archived revision: their histories live in R2, and every
// save of the engagement writes each history again under the same key.
const papers = [];
for (let i = 0; i < (histArg === "0" ? 1 : 4); i++) {
  const { paperId } = await command("createPaper", { templateId: "WP-A10-01" });
  if (histArg !== "0") await edit(paperId, 0);
  papers.push(paperId);
}
let hung = 0,
  ok = 0,
  errors = 0;
for (let i = 0; i < rounds; i++) {
  const post = edit(papers[0], i + 1);
  if (!overlap) await post;
  await new Promise((res) => setTimeout(res, 5));
  // Reads staggered across the save's lifetime.
  const reads = [0, 5, 10, 20, 40, 80].map((d) =>
    new Promise((res) => setTimeout(res, d)).then(() =>
      get(engagementId).then(
        () => ok++,
        (e) =>
          e.name === "TimeoutError"
            ? hung++
            : (errors++, console.error(e.message)),
      ),
    ),
  );
  await Promise.all([post, ...reads]);
  console.log(`round ${i + 1}: ok=${ok} hung=${hung} errors=${errors}`);
}
console.log(
  `TOTAL overlap=${overlap} hist=${histArg !== "0"}: ok=${ok} hung=${hung} errors=${errors}`,
);
