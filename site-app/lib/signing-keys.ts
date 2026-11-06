// The practice's Ed25519 signing keys for dossiers and briefing packets
// (#25, F-23; docs/security/signing-keys.md). A private key never reaches D1
// in the clear: it is wrapped with AES-256-GCM under the key-encryption key in
// the DOSSIER_KEK Worker secret, bound to its practice and key ID, and only
// ever unwrapped into a non-extractable CryptoKey. A retired key keeps only its
// public half, which stays published so earlier signatures still verify.
import { env } from "cloudflare:workers";
import { db } from "./bindings";
import { ApiError } from "./http";
import { id, now, sha256 } from "./ids";
import type { Context } from "./tenancy";

/** The Worker settings read here (cloudflare-env.d.ts). */
export type SigningSettings = { DOSSIER_KEK?: string; IDENTITY_MODE?: string };

const settings = () => env as SigningSettings;

/**
 * Seed of the development server's key-encryption key. It is public, so it
 * protects nothing: it only lets `npm run dev` seal dossiers without a secret.
 * It applies only while IDENTITY_MODE is dev, which works only on the
 * development server (lib/identity.ts).
 */
const DEV_KEK_SEED =
  "ai-assurance development dossier key-encryption key; public, never for production";
export const DEV_KEK_ID = "kek-development";

export type KeyEncryptionKey = { id: string; key: CryptoKey };

function base64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unbase64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
/** Standard base64 that decodes and re-encodes to itself, else null. */
function strictBase64(s: string) {
  try {
    const bytes = unbase64(s);
    return base64(bytes) === s ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * The key-encryption key: DOSSIER_KEK (32 random bytes, standard base64), the
 * public development key on the development server, and otherwise a 503 that
 * names the missing secret, so nothing is signed with an unprotected key.
 */
export async function keyEncryptionKey(
  config: SigningSettings = settings(),
): Promise<KeyEncryptionKey> {
  const secret = config.DOSSIER_KEK?.trim();
  let raw: Uint8Array, kekId: string;
  if (secret) {
    const bytes = strictBase64(secret);
    if (!bytes || bytes.length !== 32)
      throw new ApiError(
        503,
        "DOSSIER_KEK must be 32 random bytes in standard base64 (docs/security/signing-keys.md). Nothing was signed.",
      );
    raw = bytes;
    // A fingerprint, not the key: it tells which secret wrapped a stored key.
    kekId = "kek-" + (await sha256("dossier-kek|" + secret)).slice(0, 16);
  } else if (config.IDENTITY_MODE === "dev") {
    raw = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(DEV_KEK_SEED),
      ),
    );
    kekId = DEV_KEK_ID;
  } else
    throw new ApiError(
      503,
      "Signing is not configured: the platform operator must set the DOSSIER_KEK Worker secret (docs/security/signing-keys.md). Nothing was signed.",
    );
  return {
    id: kekId,
    key: await crypto.subtle.importKey(
      "raw",
      raw as BufferSource,
      "AES-GCM",
      false,
      ["wrapKey", "unwrapKey"],
    ),
  };
}

/** Binds a wrapped key to its practice and ID, so rows cannot be swapped. */
const binding = (tenantId: string, keyId: string) =>
  new TextEncoder().encode("dossier-signing-key/v1|" + tenantId + "|" + keyId);
const WRAP_PREFIX = "A256GCM.";

/** A fresh key pair, its private half wrapped for storage. */
export async function newSigningKey(tenantId: string, kek: KeyEncryptionKey) {
  const keyId = id("KEY"),
    pair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair,
    iv = crypto.getRandomValues(new Uint8Array(12)),
    wrapped = new Uint8Array(
      await crypto.subtle.wrapKey("pkcs8", pair.privateKey, kek.key, {
        name: "AES-GCM",
        iv,
        additionalData: binding(tenantId, keyId),
      }),
    ),
    sealed = new Uint8Array(iv.length + wrapped.length);
  sealed.set(iv);
  sealed.set(wrapped, iv.length);
  return {
    id: keyId,
    kekId: kek.id,
    wrappedKey: WRAP_PREFIX + base64(sealed),
    publicKeySPKI: base64(
      new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)),
    ),
  };
}

/** Unwraps a stored private key into a non-extractable signing key. */
export async function unwrapSigningKey(
  tenantId: string,
  keyId: string,
  wrappedKey: string,
  kek: KeyEncryptionKey,
) {
  const sealed = wrappedKey.startsWith(WRAP_PREFIX)
    ? strictBase64(wrappedKey.slice(WRAP_PREFIX.length))
    : null;
  if (!sealed || sealed.length <= 12)
    throw new ApiError(500, "Stored signing key is malformed");
  try {
    return await crypto.subtle.unwrapKey(
      "pkcs8",
      sealed.subarray(12) as BufferSource,
      kek.key,
      {
        name: "AES-GCM",
        iv: sealed.subarray(0, 12) as BufferSource,
        additionalData: binding(tenantId, keyId),
      },
      "Ed25519",
      false,
      ["sign"],
    );
  } catch {
    throw new ApiError(
      500,
      "Stored signing key failed authentication; it was altered or moved",
    );
  }
}

export type SigningKey = {
  id: string;
  publicKeySPKI: string;
  privateKey: CryptoKey;
};

type ActiveRow = {
  id: string;
  wrapped_key: string | null;
  kek_id: string | null;
  public_key: string;
};
const activeRow = (tenantId: string) =>
  db()
    .prepare(
      "SELECT id,wrapped_key,kek_id,public_key FROM dossier_keys WHERE tenant_id=? AND active=1 LIMIT 1",
    )
    .bind(tenantId)
    .first<ActiveRow>();

/**
 * The practice's active signing key, created (wrapped) on first use. A
 * practice has at most one active key (a unique partial index), so two first
 * seals racing each other end up signing with the same key.
 */
export async function activeSigningKey(ctx: Context): Promise<SigningKey> {
  const kek = await keyEncryptionKey();
  let row = await activeRow(ctx.tenantId);
  if (!row) {
    const created = await newSigningKey(ctx.tenantId, kek);
    await db()
      .prepare(
        "INSERT INTO dossier_keys(tenant_id,id,wrapped_key,kek_id,public_key,active,created_at) SELECT ?,?,?,?,?,1,? WHERE NOT EXISTS(SELECT 1 FROM dossier_keys WHERE tenant_id=? AND active=1) ON CONFLICT DO NOTHING",
      )
      .bind(
        ctx.tenantId,
        created.id,
        created.wrappedKey,
        created.kekId,
        created.publicKeySPKI,
        now(),
        ctx.tenantId,
      )
      .run();
    row = await activeRow(ctx.tenantId);
    if (!row) throw new ApiError(503, "Signing key unavailable. Please retry.");
  }
  if (!row.wrapped_key || row.kek_id !== kek.id)
    throw new ApiError(
      503,
      "The active signing key was wrapped with a different DOSSIER_KEK (" +
        (row.kek_id ?? "none") +
        ", configured " +
        kek.id +
        "). Restore that secret, or ask a practice administrator to rotate the signing key. Nothing was signed.",
    );
  return {
    id: row.id,
    publicKeySPKI: row.public_key,
    privateKey: await unwrapSigningKey(
      ctx.tenantId,
      row.id,
      row.wrapped_key,
      kek,
    ),
  };
}

/** Ed25519 signature of `message`, base64. */
export async function sign(key: SigningKey, message: string) {
  return base64(
    new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        key.privateKey,
        new TextEncoder().encode(message),
      ),
    ),
  );
}

/**
 * Statements that retire the practice's active key (erasing its wrapped
 * private half) and activate `created`, each guarded by `guard` with its two
 * trailing arguments. Used by the management op rotateSigningKey.
 */
export function rotationStatements(
  tenantId: string,
  created: Awaited<ReturnType<typeof newSigningKey>>,
  reason: string,
  timestamp: string,
  guard: string,
  guardArgs: unknown[],
) {
  return [
    db()
      .prepare(
        "UPDATE dossier_keys SET active=0,wrapped_key=NULL,kek_id=NULL,retired_at=?,retired_reason=? WHERE tenant_id=? AND active=1 AND " +
          guard,
      )
      .bind(timestamp, reason, tenantId, ...guardArgs),
    db()
      .prepare(
        "INSERT INTO dossier_keys(tenant_id,id,wrapped_key,kek_id,public_key,active,created_at) SELECT ?,?,?,?,?,1,? WHERE " +
          guard,
      )
      .bind(
        tenantId,
        created.id,
        created.wrappedKey,
        created.kekId,
        created.publicKeySPKI,
        timestamp,
        ...guardArgs,
      ),
  ];
}

export type VerificationKey = {
  keyId: string;
  algorithm: "Ed25519";
  publicKeySPKI: string;
  status: "active" | "retired";
  createdAt: string;
  retiredAt: string | null;
  retiredReason: string | null;
};

/** Every verification key the practice has used, oldest first. */
export async function verificationKeys(
  ctx: Context,
): Promise<VerificationKey[]> {
  const { results } = await db()
    .prepare(
      "SELECT id,public_key,active,created_at,retired_at,retired_reason FROM dossier_keys WHERE tenant_id=? ORDER BY created_at,id",
    )
    .bind(ctx.tenantId)
    .all<{
      id: string;
      public_key: string;
      active: number;
      created_at: string;
      retired_at: string | null;
      retired_reason: string | null;
    }>();
  return results.map((k) => ({
    keyId: k.id,
    algorithm: "Ed25519",
    publicKeySPKI: k.public_key,
    status: k.active ? "active" : "retired",
    createdAt: k.created_at,
    retiredAt: k.retired_at,
    retiredReason: k.retired_reason,
  }));
}
