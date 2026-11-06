// Dossier signing keys in the built Worker (#25, F-23,
// docs/security/signing-keys.md): drizzle 0009 retires and erases plaintext
// private keys while a dossier signed before it still verifies with
// `python -m engine.assurance verify` against the published keys; signing
// refuses without DOSSIER_KEK outside the development server; and a rotation
// stores only a wrapped key (AES-256-GCM bound to practice and key ID) that
// unwraps under the configured secret to the published public key. Sealing
// and rotation through the workflow are in assurance-integration-check.mjs.
// Needs `npm run build` first; ASSURANCE_TEST_PYTHON names the Python.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";

const python = process.env.ASSURANCE_TEST_PYTHON ?? "python";
const local = "http://127.0.0.1:5173";
const modules = [
  "index.js",
  ...(await fs.readdir("dist/server", { recursive: true })).filter(
    (p) => p !== "index.js" && /\.m?js$/.test(p),
  ),
];
const migrationFiles = (await fs.readdir("drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const keysMigration = migrationFiles.findIndex((f) =>
  f.endsWith("_dossier_signing_keys.sql"),
);
assert(keysMigration > 0, "drizzle/*_dossier_signing_keys.sql is missing");
const statements = async (file) =>
  (await fs.readFile("drizzle/" + file, "utf8"))
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? "[" + value.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(value)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
          .join(",") +
        "}";
const user = "user-signing-lead";
const as = {
  "oai-authenticated-user-id": user,
  "oai-authenticated-user-email": "signing-lead@fixture.invalid",
  Origin: local,
};
const tenantId = "tenant-" + sha256(user).slice(0, 24);

async function withWorker(bindings, migrateBefore, check) {
  const mf = new Miniflare({
    modules: modules.map((p) => ({
      type: "ESModule",
      path: path.resolve("dist/server", p),
    })),
    modulesRoot: path.resolve("dist/server"),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      IDENTITY_MODE: "trusted-headers",
      IDENTITY_TRUSTED_HEADERS: "loopback-tests",
      SELF_SIGNUP: "open",
      ...bindings,
    },
    d1Databases: { DB: "signing-keys" },
    r2Buckets: { BUCKET: "signing-keys-evidence" },
    d1Persist: false,
    r2Persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
    const migrate = async (files) => {
      for (const file of files)
        for (const sql of await statements(file)) await db.prepare(sql).run();
    };
    await migrate(migrationFiles.slice(0, keysMigration));
    await migrateBefore(db);
    await migrate(migrationFiles.slice(keysMigration));
    const call = async (url, body) => {
      const response = await mf.dispatchFetch(local + url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...as,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    await check({ db, call });
  } finally {
    await mf.dispose();
  }
}
const rotate = async (call, reason) => {
  const workspace = (await call("/api/workspace")).body;
  return call("/api/management", {
    tenantId,
    expectedVersion: workspace.managementVersion,
    op: "rotateSigningKey",
    data: { reason },
  });
};
const verify = (dossierPath, trustPath) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      python,
      [
        "-m",
        "engine.assurance",
        "verify",
        "--dossier",
        dossierPath,
        "--trusted-keys",
        trustPath,
        "--require-trusted-signature",
      ],
      { cwd: path.resolve(".."), windowsHide: true },
    );
    let out = "";
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (out += x));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, out }));
  });

// --- 0009 retires plaintext keys; earlier dossiers still verify -------------
// A key and a manifest-1.0 dossier exactly as the platform made them before
// #25: plaintext PKCS#8 in D1, Ed25519 over the canonical manifest.
const legacy = generateKeyPairSync("ed25519"),
  legacyPkcs8 = legacy.privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64"),
  legacySpki = legacy.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64"),
  report = Buffer.from(JSON.stringify({ opinion: "Legacy fixture" })),
  manifest = {
    schemaVersion: "1.0",
    audience: "internal",
    reportId: "REPORT-legacy",
    reportSha256: sha256(report),
    createdAt: "2026-10-01T00:00:00.000Z",
    files: [
      {
        path: "report.json",
        sha256: sha256(report),
        size: report.length,
        mediaType: "application/json",
      },
    ],
    withheld: [],
    custody: [],
  },
  legacyDossier = {
    schemaVersion: "1.0",
    manifest,
    manifestSha256: sha256(canonical(manifest)),
    files: [{ path: "report.json", contentBase64: report.toString("base64") }],
    signature: {
      algorithm: "Ed25519",
      keyId: "KEY-legacy",
      publicKeySPKI: legacySpki,
      signature: sign(
        null,
        Buffer.from(canonical(manifest)),
        legacy.privateKey,
      ).toString("base64"),
    },
  };
const temp = path.resolve("../tmp/signing-keys-fixture");
await fs.mkdir(temp, { recursive: true });
try {
  await withWorker(
    {},
    (db) =>
      db
        .prepare(
          "INSERT INTO dossier_keys(tenant_id,id,private_key,public_key,active,created_at) VALUES(?,?,?,?,1,?)",
        )
        .bind(
          tenantId,
          "KEY-legacy",
          legacyPkcs8,
          legacySpki,
          "2026-10-01T00:00:00.000Z",
        )
        .run(),
    async ({ db, call }) => {
      const rows = (await db.prepare("SELECT * FROM dossier_keys").all())
        .results;
      assert.equal(rows.length, 1);
      assert(!JSON.stringify(rows).includes(legacyPkcs8.slice(20, 80)));
      assert(!("private_key" in rows[0]), "the plaintext column is dropped");
      assert.equal(rows[0].active, 0);
      assert.equal(rows[0].wrapped_key, null);
      assert.equal(
        rows[0].retired_reason,
        "Private key was stored unwrapped; retired by migration 0009 (F-23)",
      );
      // The legacy practice is provisioned at first sign-in.
      assert.equal((await call("/api/workspace")).body.tenantId, tenantId);
      const published = await call(
        "/api/dossier/keys?" + new URLSearchParams({ tenantId }),
      );
      assert.equal(published.status, 200, JSON.stringify(published.body));
      assert.deepEqual(
        published.body.keys.map((k) => [k.keyId, k.status]),
        [["KEY-legacy", "retired"]],
      );
      const dossierPath = path.join(temp, "legacy-dossier.json"),
        trustPath = path.join(temp, "legacy-trust.json");
      await fs.writeFile(dossierPath, JSON.stringify(legacyDossier));
      await fs.writeFile(trustPath, JSON.stringify(published.body.trust));
      const verified = await verify(dossierPath, trustPath);
      assert.equal(verified.code, 0, verified.out);
      // Without DOSSIER_KEK outside the development server, nothing is signed.
      const refused = await rotate(call, "No secret configured");
      assert.deepEqual(refused, {
        status: 503,
        body: {
          error:
            "Signing is not configured: the platform operator must set the DOSSIER_KEK Worker secret (docs/security/signing-keys.md). Nothing was signed.",
        },
      });
      assert.equal(
        (
          await db
            .prepare("SELECT COUNT(*) AS n FROM dossier_keys WHERE active=1")
            .first()
        ).n,
        0,
      );
    },
  );
  console.log(
    "PASS drizzle 0009 erases plaintext keys; a pre-migration dossier verifies against the published retired key; signing refuses without DOSSIER_KEK",
  );

  // --- With DOSSIER_KEK: only a wrapped key reaches D1 ------------------------
  const kek = randomBytes(32);
  await withWorker(
    { DOSSIER_KEK: kek.toString("base64") },
    async () => {},
    async ({ db, call }) => {
      await call("/api/workspace");
      const rotated = await rotate(call, "First key");
      assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
      const { keyId, publicKeySPKI } = rotated.body.details;
      const row = await db
        .prepare(
          "SELECT wrapped_key,kek_id,public_key FROM dossier_keys WHERE tenant_id=? AND active=1",
        )
        .bind(tenantId)
        .first();
      assert.equal(row.public_key, publicKeySPKI);
      // AES-256-GCM: IV (12 bytes) || ciphertext || tag (16 bytes), with the
      // practice and key ID as additional data.
      const sealed = Buffer.from(
          row.wrapped_key.replace(/^A256GCM\./, ""),
          "base64",
        ),
        decipher = createDecipheriv("aes-256-gcm", kek, sealed.subarray(0, 12));
      decipher.setAAD(
        Buffer.from("dossier-signing-key/v1|" + tenantId + "|" + keyId),
      );
      decipher.setAuthTag(sealed.subarray(-16));
      const pkcs8 = Buffer.concat([
        decipher.update(sealed.subarray(12, -16)),
        decipher.final(),
      ]);
      assert.equal(
        createPublicKey(
          createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }),
        )
          .export({ type: "spki", format: "der" })
          .toString("base64"),
        publicKeySPKI,
      );
      assert(!row.wrapped_key.includes(pkcs8.toString("base64").slice(0, 40)));
      const event = await db
        .prepare(
          "SELECT details FROM management_events WHERE tenant_id=? AND action='rotateSigningKey'",
        )
        .bind(tenantId)
        .first();
      assert.deepEqual(JSON.parse(event.details), rotated.body.details);
    },
  );
  await withWorker(
    { DOSSIER_KEK: "too-short" },
    async () => {},
    async ({ call }) => {
      await call("/api/workspace");
      assert.deepEqual(await rotate(call, "Malformed secret"), {
        status: 503,
        body: {
          error:
            "DOSSIER_KEK must be 32 random bytes in standard base64 (docs/security/signing-keys.md). Nothing was signed.",
        },
      });
    },
  );
  console.log(
    "PASS rotation stores only an AES-256-GCM wrapped key bound to practice and key ID, recorded as a management event; a malformed DOSSIER_KEK is refused",
  );
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
