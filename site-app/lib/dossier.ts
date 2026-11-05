import { ApiError, bucket, db, id, now, sha256, type Context } from "./store";
import type { Engagement, Report } from "./domain";
import { canonical } from "./assurance-core";
export function base64(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < data.length; i += 8192)
    s += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(s);
}
export function unbase64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
const escaped = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function buildDossier(
  ctx: Context,
  e: Engagement,
  r: Report,
  client: boolean,
  withheld: { id: string; reason: string }[] = [],
) {
  const snapshot = client ? r.clientSnapshot : r.snapshot,
    reportHash = client ? r.clientSha256 : r.sha256;
  if (!snapshot || (await sha256(JSON.stringify(snapshot))) !== reportHash)
    throw new ApiError(409, "Captured report integrity mismatch");
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
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Audit report</title><style>body{max-width:900px;margin:48px auto;font:16px/1.6 system-ui;color:#222;padding:24px}h1,h2,h3{line-height:1.3}section{margin-top:36px;border-top:1px solid #ddd;padding-top:20px}pre{white-space:pre-wrap;font:inherit}small{color:#666}</style></head><body><small>' +
    escaped(client ? "Client projection" : "Internal audit file") +
    " · " +
    escaped(r.kind) +
    "</small><h1>" +
    escaped(e.title) +
    "</h1><h2>" +
    escaped(snapshot.opinion) +
    "</h2><pre>" +
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
  for (const p of papers)
    await add(
      "papers/" + p.id + "-r" + p.revision + ".json",
      bytes(JSON.stringify(p)),
      "application/json",
    );
  if (!client) {
    for (const pin of (snapshot.assurancePins ?? []) as {
      id: string;
      sha256: string;
    }[]) {
      const rec = await db()
        .prepare(
          "SELECT body,sha256,kind FROM assurance_records WHERE tenant_id=? AND engagement_id=? AND id=?",
        )
        .bind(ctx.tenantId, e.id, pin.id)
        .first<{ body: string; sha256: string; kind: string }>();
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
  for (const captured of (snapshot.evidence ?? []) as {
    id: string;
    name: string;
    sha256: string;
    status: string;
  }[]) {
    if (captured.status !== "accepted") {
      excluded.push({
        id: captured.id,
        reason: "Not accepted at report capture",
      });
      continue;
    }
    if (withheld.some((w) => w.id === captured.id)) continue;
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
    "Verify with the separately reviewed engine.assurance CLI: python assurance-verifier.py verify --dossier dossier.json --trusted-keys trust.json --require-trusted-signature. Put the independently confirmed key ID and publicKeySPKI in trust.json as a key/value object. Pin the expected public key through an independent channel. Embedded public keys do not establish trusted origin. report.json is the exact captured report. report.html is a derived readable rendition. SHA-256 detects changed bytes; application Ed25519 signing establishes origin only under the selected trust policy. This is not a qualified signature or independent timestamp. Withheld evidence is listed explicitly. The platform cannot certify the audit conclusion.\n";
  await add("README.txt", bytes(instructions), "text/plain");
  leaves.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    schemaVersion: "1.0",
    audience: client ? "client" : "internal",
    reportId: r.id,
    reportSha256: reportHash!,
    createdAt: now(),
    files: leaves,
    withheld: excluded,
    custody,
  };
  return {
    schemaVersion: "1.0",
    manifest,
    manifestSha256: await sha256(canonical(manifest)),
    files,
  };
}
export async function signingKey(ctx: Context, rotate = false) {
  const existing = await db()
    .prepare(
      "SELECT * FROM dossier_keys WHERE tenant_id=? AND active=1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(ctx.tenantId)
    .first<{ id: string; private_key: string; public_key: string }>();
  if (existing && !rotate) return existing;
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair,
    key = {
      id: id("KEY"),
      private_key: base64(
        await crypto.subtle.exportKey("pkcs8", pair.privateKey),
      ),
      public_key: base64(await crypto.subtle.exportKey("spki", pair.publicKey)),
    };
  await db().batch([
    db()
      .prepare(
        "UPDATE dossier_keys SET active=0 WHERE tenant_id=? AND active=1",
      )
      .bind(ctx.tenantId),
    db()
      .prepare(
        "INSERT INTO dossier_keys(tenant_id,id,private_key,public_key,active,created_at) VALUES(?,?,?,?,1,?)",
      )
      .bind(ctx.tenantId, key.id, key.private_key, key.public_key, now()),
  ]);
  return key;
}
export async function signDossier(
  ctx: Context,
  dossier: Awaited<ReturnType<typeof buildDossier>>,
) {
  const key = await signingKey(ctx),
    privateKey = await crypto.subtle.importKey(
      "pkcs8",
      unbase64(key.private_key),
      "Ed25519",
      false,
      ["sign"],
    ),
    signature = base64(
      await crypto.subtle.sign(
        "Ed25519",
        privateKey,
        new TextEncoder().encode(canonical(dossier.manifest)),
      ),
    );
  return {
    ...dossier,
    signature: {
      algorithm: "Ed25519",
      keyId: key.id,
      publicKeySPKI: key.public_key,
      signature,
    },
  };
}
