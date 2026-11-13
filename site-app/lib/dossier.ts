import { bucket } from "./bindings";
import { ApiError } from "./http";
import { id, now, sha256 } from "./ids";
import type { Context } from "./tenancy";
import type { CriteriaStamp } from "./criteria/types";
import type { Engagement, Report, RulePackStamp } from "./domain";
import { opinionLabel } from "./domain/report-model";
import { canonical } from "./assurance-core";
import { exportedPapers } from "./papers/export";
import { pinnedRecordFacts, storedBodies } from "./assurance-store";
import {
  describeScope,
  inScope,
  maxDossierFiles,
  type DossierScope,
  type DossierScopeDefinition,
} from "./dossier-scope";
import { legalDate } from "./rule-pack";
import { sign, type SigningKey } from "./signing-keys";
export function base64(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < data.length; i += 8192)
    s += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(s);
}
const escaped = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/**
 * The captured criteria pack (docs/design/criteria-model.md section 10) and
 * whether its legal content was pending qualified legal review at capture.
 */
function criteriaLine(snapshot: Record<string, unknown>) {
  const c = snapshot.criteriaPack as Partial<CriteriaStamp> | undefined;
  if (!c?.packId) return "";
  const frameworks = Array.isArray(c.frameworks) ? c.frameworks : [],
    crosswalks = Array.isArray(c.crosswalks) ? c.crosswalks : [];
  return (
    "<small>Criteria pack " +
    escaped(c.packId) +
    " " +
    escaped(c.packVersion) +
    (c.legalReviewPending
      ? ": its legal content is pending qualified legal review"
      : "") +
    (frameworks.length
      ? " · assessed against " +
        frameworks
          .map(
            (f) =>
              escaped(f.id) +
              " " +
              escaped(f.edition) +
              " (data " +
              escaped(f.version) +
              ")",
          )
          .join("; ")
      : "") +
    (crosswalks.length
      ? " · crosswalks " +
        crosswalks
          .map((x) => escaped(x.id) + " " + escaped(x.version))
          .join("; ")
      : "") +
    "</small>"
  );
}
/** The captured rule-pack and methodology versions, for the readable rendition. */
function rulePackLine(snapshot: Record<string, unknown>) {
  const pack = snapshot.rulePack as Partial<RulePackStamp> | undefined;
  if (!pack?.version)
    return snapshot.methodologyVersion
      ? "<small>Methodology " +
          escaped(snapshot.methodologyVersion) +
          "</small>"
      : "";
  return (
    "<small>Rule pack " +
    escaped(pack.version) +
    " (legal text " +
    escaped(pack.legalVersion) +
    ", researched " +
    escaped(legalDate(String(pack.researchedAsOf))) +
    (pack.legalReview === "approved" ? "" : ", pending legal review") +
    ") · methodology " +
    escaped(snapshot.methodologyVersion) +
    "</small>"
  );
}
/** A version label the verifier accepts: nonempty text of at most 200 characters. */
const versionText = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "" && v.length <= 200;
/** The captured rule-pack stamp as signed in manifests 1.1 and 1.2, or null. */
function signedRulePack(snapshot: Record<string, unknown>) {
  const pack = snapshot.rulePack as Partial<RulePackStamp> | undefined;
  if (
    !pack ||
    !versionText(pack.version) ||
    !versionText(pack.legalVersion) ||
    !versionText(pack.researchedAsOf) ||
    (pack.legalReview !== "pending" && pack.legalReview !== "approved")
  )
    return null;
  return {
    version: pack.version,
    legalVersion: pack.legalVersion,
    researchedAsOf: pack.researchedAsOf,
    legalReview: pack.legalReview,
  };
}
/** The key a scoped seal is found by: the digest of its canonical definition. */
export const scopeSha256 = (scope: DossierScopeDefinition) =>
  sha256(canonical(scope));
type Pin = { id: string; sha256: string };
/**
 * The pinned records a dossier includes and its signed scope: every pin for
 * the full dossier (scope null), else the pins within the scope (#83).
 */
async function selectPins(
  ctx: Context,
  e: Engagement,
  pins: Pin[],
  scope: DossierScopeDefinition | null,
): Promise<{ selected: Pin[]; signed: DossierScope | null }> {
  if (!scope) return { selected: pins, signed: null };
  const facts = await pinnedRecordFacts(ctx, e.id),
    selected = pins.filter((pin) => {
      const f = facts.get(pin.id);
      if (!f)
        throw new ApiError(
          409,
          "Pinned assurance record unavailable or altered: " + pin.id,
        );
      return inScope(scope, f);
    });
  if (!selected.length)
    throw new ApiError(
      409,
      "The scope selects none of the report's " +
        pins.length +
        " pinned assurance records",
    );
  return {
    selected,
    signed: {
      ...scope,
      pinnedRecords: pins.length,
      includedRecords: selected.length,
    },
  };
}
export async function buildDossier(
  ctx: Context,
  e: Engagement,
  r: Report,
  client: boolean,
  signingKeyId: string,
  withheld: { id: string; reason: string }[] = [],
  scope: DossierScopeDefinition | null = null,
) {
  const snapshot = client ? r.clientSnapshot : r.snapshot,
    reportHash = client ? r.clientSha256 : r.sha256;
  if (!snapshot || (await sha256(JSON.stringify(snapshot))) !== reportHash)
    throw new ApiError(409, "Captured report integrity mismatch");
  if (client && scope)
    throw new ApiError(400, "Scoped exports are internal audit files");
  const files: { path: string; contentBase64: string }[] = [],
    leaves: {
      path: string;
      sha256: string;
      size: number;
      mediaType: string;
    }[] = [],
    custody: {
      id: string;
      action: string;
      actor: string;
      at: string;
      path?: string;
      sha256?: string;
      reason?: string;
    }[] = [],
    excluded = [...withheld];
  let total = 0;
  async function add(path: string, bytes: Uint8Array, mediaType: string) {
    total += bytes.byteLength;
    if (total > 30 * 1024 * 1024)
      throw new ApiError(
        413,
        "Dossier exceeds 30 MB; record explicit externally retained evidence exclusions before sealing",
      );
    const hash = await sha256(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    files.push({ path, contentBase64: base64(bytes) });
    leaves.push({ path, sha256: hash, size: bytes.byteLength, mediaType });
    custody.push({
      id: id("CUSTODY"),
      action: "verified_for_export",
      actor: ctx.user.userId,
      at: now(),
      path,
      sha256: hash,
    });
    return hash;
  }
  const bytes = (s: string) => new TextEncoder().encode(s);
  await add("report.json", bytes(JSON.stringify(snapshot)), "application/json");
  const papers = Array.isArray(snapshot.papers)
    ? (snapshot.papers as {
        id: string;
        title: string;
        revision: number;
        status: string;
        body?: Record<string, string>;
        conclusion?: string;
        conclusionStatus?: string;
      }[])
    : [];
  const evidence = (snapshot.evidence ?? []) as {
    id: string;
    name: string;
    sha256: string;
    status: string;
  }[];
  // An internal dossier files each paper as its working-paper contract
  // document (#51), and a released package's completion memo. A client
  // dossier, and a package captured before the contract, keep the captured
  // paper: a client paper is its conclusion only, without user ids.
  const documents = client ? [] : await exportedPapers(ctx, e, r);
  // Select the pinned records and count the files before reading any record
  // body or evidence byte: a dossier the verifier would refuse is refused
  // here, within the Worker's memory and time limits (#83).
  const { selected, signed: signedScope } = client
    ? { selected: [] as Pin[], signed: null }
    : await selectPins(ctx, e, (snapshot.assurancePins ?? []) as Pin[], scope);
  const evidenceFiles =
      scope?.evidence === "withheld"
        ? 0
        : evidence.filter(
            (c) =>
              c.status === "accepted" &&
              !withheld.some((w) => w.id === c.id) &&
              e.artifacts.find((a) => a.id === c.id)?.custody !== "client",
          ).length,
    plannedFiles =
      3 + (documents.length || papers.length) + selected.length + evidenceFiles;
  if (plannedFiles > maxDossierFiles)
    throw new ApiError(
      413,
      "This dossier would hold " +
        plannedFiles +
        " files (" +
        selected.length +
        " pinned assurance records); the verifier accepts at most " +
        maxDossierFiles +
        ". Seal scoped exports by procedure, period or record type instead.",
    );
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Audit report</title><style>body{max-width:900px;margin:48px auto;font:16px/1.6 system-ui;color:#222;padding:24px}h1,h2,h3{line-height:1.3}section{margin-top:36px;border-top:1px solid #ddd;padding-top:20px}pre{white-space:pre-wrap;font:inherit}small{color:#666}</style></head><body><small>' +
    escaped(client ? "Client projection" : "Internal audit file") +
    " · " +
    escaped(r.kind) +
    "</small><h1>" +
    escaped(e.title) +
    "</h1><h2>" +
    escaped(opinionLabel(snapshot)) +
    "</h2>" +
    rulePackLine(snapshot) +
    criteriaLine(snapshot) +
    (signedScope
      ? "<p><strong>" + escaped(describeScope(signedScope)) + "</strong></p>"
      : "") +
    "<pre>" +
    escaped(snapshot.summary) +
    "</pre>" +
    papers
      .map(
        (p) =>
          "<section><h2>" +
          escaped(p.title) +
          "</h2><small>Revision " +
          escaped(p.revision) +
          " · " +
          escaped(p.status) +
          "</small>" +
          Object.entries(
            p.body ?? {
              conclusion: p.conclusion,
              conclusionStatus: p.conclusionStatus,
            },
          )
            .map(
              ([k, v]) =>
                "<h3>" +
                escaped(k.replace(/([A-Z])/g, " $1")) +
                "</h3><pre>" +
                escaped(v) +
                "</pre>",
            )
            .join("") +
          "</section>",
      )
      .join("") +
    "<section><h2>Limitations</h2><pre>" +
    escaped(snapshot.limitations) +
    "</pre></section></body></html>";
  await add("report.html", bytes(html), "text/html");
  if (documents.length)
    for (const d of documents)
      await add(
        "papers/" + d.id + "-r" + d.revision + ".json",
        bytes(JSON.stringify(d)),
        "application/json",
      );
  else
    for (const p of papers)
      await add(
        "papers/" + p.id + "-r" + p.revision + ".json",
        bytes(JSON.stringify(p)),
        "application/json",
      );
  // A hundred pinned records per query: a query per record would pass D1's
  // per-request query limit on a large engagement.
  for (let start = 0; start < selected.length; start += 100) {
    const chunk = selected.slice(start, start + 100),
      stored = await storedBodies(
        ctx,
        e.id,
        chunk.map((pin) => pin.id),
      );
    for (const pin of chunk) {
      const rec = stored.get(pin.id);
      if (
        !rec ||
        rec.sha256 !== pin.sha256 ||
        (await sha256(rec.body)) !== pin.sha256
      )
        throw new ApiError(
          409,
          "Pinned assurance record unavailable or altered: " + pin.id,
        );
      await add(
        "assurance/" + pin.id + ".json",
        bytes(rec.body),
        "application/json",
      );
    }
  }
  for (const captured of evidence) {
    if (captured.status !== "accepted") {
      excluded.push({
        id: captured.id,
        reason: "Not accepted at report capture",
      });
      continue;
    }
    if (withheld.some((w) => w.id === captured.id)) continue;
    if (scope?.evidence === "withheld") {
      excluded.push({
        id: captured.id,
        reason:
          "Outside this scoped export (evidence bytes withheld); SHA-256 " +
          captured.sha256,
      });
      continue;
    }
    const artifact = e.artifacts.find((a) => a.id === captured.id);
    if (
      !artifact ||
      artifact.sha256 !== captured.sha256 ||
      (client &&
        (artifact.visibility !== "client" || artifact.status !== "accepted"))
    )
      throw new ApiError(
        409,
        "Captured source is no longer available for this audience",
      );
    // A client-held pin (#102) has no bytes here: the dossier lists it with
    // its SHA-256, which the client's own copy can be checked against.
    if (artifact.custody === "client") {
      excluded.push({
        id: captured.id,
        reason:
          "Held by the client; the platform holds only its SHA-256 " +
          artifact.sha256 +
          // The client's signed statement of the pin (#134).
          (artifact.clientPin?.attestation
            ? "; the client signed the pin with Ed25519 key " +
              artifact.clientPin.attestation.keySha256
            : ""),
      });
      continue;
    }
    const object = await bucket().get(artifact.key);
    if (!object)
      throw new ApiError(
        409,
        "Missing evidence bytes: " +
          captured.name +
          ". Record an explicit exclusion if externally retained.",
      );
    const payload = new Uint8Array(await object.arrayBuffer());
    if ((await sha256(payload.buffer)) !== captured.sha256)
      throw new ApiError(409, "Evidence integrity mismatch: " + captured.name);
    await add(
      "evidence/" +
        artifact.id +
        "/" +
        artifact.name.replace(/[^a-zA-Z0-9._-]/g, "_"),
      payload,
      artifact.mediaType,
    );
    custody.push({
      id: id("CUSTODY"),
      action: "source_receipt",
      actor: client ? "client-visible-source" : artifact.uploadedBy,
      at: artifact.createdAt,
      sha256: artifact.sha256,
    });
  }
  const instructions =
    "Verify with the separately reviewed engine.assurance CLI: python assurance-verifier.py verify --dossier dossier.json --trusted-keys trust.json --require-trusted-signature. Put the independently confirmed key ID and publicKeySPKI in trust.json as a key/value object. The signed manifest names the signing key (signingKeyId) and the captured rule-pack and methodology versions; report.json carries the criteria stamp (criteriaPack: the pack, framework data and crosswalk versions with their digests). The practice lists its active and retired verification keys to its members at /api/dossier/keys; pin the expected public key through an independent channel. Embedded public keys do not establish trusted origin. report.json is the exact captured report. report.html is a derived readable rendition. SHA-256 detects changed bytes; application Ed25519 signing establishes origin only under the selected trust policy. This is not a qualified signature or independent timestamp. Withheld evidence is listed explicitly. A scoped export (the manifest's scope, from manifest 1.2) holds only the pinned assurance records within its signed scope and states how many of the report's pinned records it includes; report.json lists every pinned record with its SHA-256, so the records outside the scope stay identifiable. The verifier reports the scope and states a scoped export as a limitation: it is not the complete audit file. The platform cannot certify the audit conclusion.\n";
  await add("README.txt", bytes(instructions), "text/plain");
  leaves.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    schemaVersion: "1.2",
    audience: client ? "client" : "internal",
    reportId: r.id,
    reportSha256: reportHash!,
    createdAt: now(),
    files: leaves,
    withheld: excluded,
    custody,
    // Manifests 1.1 and 1.2 sign the key ID and the captured rule-pack and
    // methodology versions along with the files.
    signingKeyId,
    rulePack: signedRulePack(snapshot),
    methodologyVersion: versionText(snapshot.methodologyVersion)
      ? snapshot.methodologyVersion
      : null,
    // Manifest 1.2 signs the export scope: null for the full dossier (#83).
    scope: signedScope,
  };
  return {
    schemaVersion: "1.0",
    manifest,
    manifestSha256: await sha256(canonical(manifest)),
    files,
  };
}
export async function signDossier(
  key: SigningKey,
  dossier: Awaited<ReturnType<typeof buildDossier>>,
) {
  if (dossier.manifest.signingKeyId !== key.id)
    throw new ApiError(500, "Dossier manifest names another signing key");
  return {
    ...dossier,
    signature: {
      algorithm: "Ed25519",
      keyId: key.id,
      publicKeySPKI: key.publicKeySPKI,
      signature: await sign(key, canonical(dossier.manifest)),
    },
  };
}
