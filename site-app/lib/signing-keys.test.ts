import { env } from "cloudflare:workers";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "./http";
import {
  DEV_KEK_ID,
  activeSigningKey,
  keyEncryptionKey,
  newSigningKey,
  rotationStatements,
  sign,
  unwrapSigningKey,
  verificationKeys,
} from "./signing-keys";
import type { Context } from "./tenancy";
import { sqliteD1 } from "./test-d1";

// A generated test key-encryption key; never a real secret.
const testKek = Buffer.from(
  crypto.getRandomValues(new Uint8Array(32)),
).toString("base64");
const ctx = { tenantId: "tenant-1" } as Context;
const refusal = (error: unknown) =>
  error instanceof ApiError ? [error.status, error.message] : error;

async function verifies(spki: string, message: string, signature: string) {
  const key = await crypto.subtle.importKey(
    "spki",
    Buffer.from(spki, "base64"),
    "Ed25519",
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    key,
    Buffer.from(signature, "base64"),
    new TextEncoder().encode(message),
  );
}

afterEach(() => {
  delete env.DB;
  delete env.DOSSIER_KEK;
  delete env.IDENTITY_MODE;
});

describe("keyEncryptionKey", () => {
  it("refuses to sign without DOSSIER_KEK outside the development server", async () => {
    for (const mode of [undefined, "sites", "cloudflare-access"])
      expect(
        refusal(
          await keyEncryptionKey({ IDENTITY_MODE: mode }).catch((e) => e),
        ),
      ).toEqual([
        503,
        "Signing is not configured: the platform operator must set the DOSSIER_KEK Worker secret (docs/security/signing-keys.md). Nothing was signed.",
      ]);
  });

  it("uses the public development key only on the development server", async () => {
    expect((await keyEncryptionKey({ IDENTITY_MODE: "dev" })).id).toBe(
      DEV_KEK_ID,
    );
    // An explicit secret wins over the development default.
    expect(
      (await keyEncryptionKey({ IDENTITY_MODE: "dev", DOSSIER_KEK: testKek }))
        .id,
    ).toMatch(/^kek-[0-9a-f]{16}$/);
  });

  it("names a secret by a stable fingerprint that is not the key", async () => {
    const a = await keyEncryptionKey({ DOSSIER_KEK: testKek }),
      b = await keyEncryptionKey({ DOSSIER_KEK: " " + testKek + "\n" });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toContain(testKek.slice(0, 8));
    expect(a.key.extractable).toBe(false);
  });

  it.each([
    ["too short", Buffer.alloc(16, 1).toString("base64")],
    ["too long", Buffer.alloc(48, 1).toString("base64")],
    ["not base64", "not a key at all!"],
    ["noncanonical base64", testKek.replace(/=*$/, "")],
  ])("refuses a DOSSIER_KEK that is %s", async (_label, secret) => {
    expect(
      refusal(await keyEncryptionKey({ DOSSIER_KEK: secret }).catch((e) => e)),
    ).toEqual([
      503,
      "DOSSIER_KEK must be 32 random bytes in standard base64 (docs/security/signing-keys.md). Nothing was signed.",
    ]);
  });
});

describe("wrapped signing keys", () => {
  it("wraps a new key, unwraps it unextractable and signs with it", async () => {
    const kek = await keyEncryptionKey({ DOSSIER_KEK: testKek }),
      created = await newSigningKey("tenant-1", kek);
    expect(created.kekId).toBe(kek.id);
    expect(created.wrappedKey).toMatch(/^A256GCM\.[A-Za-z0-9+/]+=*$/);
    const privateKey = await unwrapSigningKey(
      "tenant-1",
      created.id,
      created.wrappedKey,
      kek,
    );
    expect(privateKey.extractable).toBe(false);
    const key = {
      id: created.id,
      publicKeySPKI: created.publicKeySPKI,
      privateKey,
    };
    const signature = await sign(key, "manifest");
    expect(await verifies(created.publicKeySPKI, "manifest", signature)).toBe(
      true,
    );
  });

  it("refuses a wrapped key under another key, practice or key ID", async () => {
    const kek = await keyEncryptionKey({ DOSSIER_KEK: testKek }),
      other = await keyEncryptionKey({ IDENTITY_MODE: "dev" }),
      created = await newSigningKey("tenant-1", kek);
    for (const [tenantId, keyId, wrapping] of [
      ["tenant-1", created.id, other],
      ["tenant-2", created.id, kek],
      ["tenant-1", "KEY-other", kek],
    ] as const)
      expect(
        refusal(
          await unwrapSigningKey(
            tenantId,
            keyId,
            created.wrappedKey,
            wrapping,
          ).catch((e) => e),
        ),
      ).toEqual([
        500,
        "Stored signing key failed authentication; it was altered or moved",
      ]);
    expect(
      refusal(
        await unwrapSigningKey("tenant-1", created.id, "MIIC", kek).catch(
          (e) => e,
        ),
      ),
    ).toEqual([500, "Stored signing key is malformed"]);
  });
});

describe("activeSigningKey", () => {
  beforeEach(() => {
    env.DB = sqliteD1().db;
    env.DOSSIER_KEK = testKek;
  });

  it("creates one wrapped key on first use and reuses it", async () => {
    const first = await activeSigningKey(ctx),
      again = await activeSigningKey(ctx);
    expect(again.id).toBe(first.id);
    const { results } = await env
      .DB!.prepare("SELECT * FROM dossier_keys")
      .all<Record<string, unknown>>();
    expect(results).toHaveLength(1);
    expect(Object.keys(results[0]).sort()).toEqual([
      "active",
      "created_at",
      "id",
      "kek_id",
      "public_key",
      "retired_at",
      "retired_reason",
      "tenant_id",
      "wrapped_key",
    ]);
    // What D1 holds does not import as a private key.
    await expect(
      crypto.subtle.importKey(
        "pkcs8",
        Buffer.from(String(results[0].wrapped_key).slice(8), "base64"),
        "Ed25519",
        false,
        ["sign"],
      ),
    ).rejects.toThrow();
  });

  it("refuses to sign once DOSSIER_KEK changed, naming both fingerprints", async () => {
    const before = (await keyEncryptionKey()).id;
    await activeSigningKey(ctx);
    env.DOSSIER_KEK = Buffer.alloc(32, 7).toString("base64");
    const after = (await keyEncryptionKey()).id;
    expect(refusal(await activeSigningKey(ctx).catch((e) => e))).toEqual([
      503,
      "The active signing key was wrapped with a different DOSSIER_KEK (" +
        before +
        ", configured " +
        after +
        "). Restore that secret, or ask a practice administrator to rotate the signing key. Nothing was signed.",
    ]);
  });

  it("rotates: the old key loses its private half and stays published", async () => {
    const old = await activeSigningKey(ctx),
      created = await newSigningKey(ctx.tenantId, await keyEncryptionKey());
    await env.DB!.batch(
      rotationStatements(
        ctx.tenantId,
        created,
        "Scheduled rotation",
        "2026-11-06T00:00:00.000Z",
        "1=1 AND ?=?",
        [1, 1],
      ),
    );
    expect((await activeSigningKey(ctx)).id).toBe(created.id);
    const keys = await verificationKeys(ctx);
    expect(keys.map((k) => [k.keyId, k.status, k.retiredReason])).toEqual(
      expect.arrayContaining([
        [old.id, "retired", "Scheduled rotation"],
        [created.id, "active", null],
      ]),
    );
    const retired = await env
      .DB!.prepare(
        "SELECT wrapped_key,kek_id,retired_at FROM dossier_keys WHERE id=?",
      )
      .bind(old.id)
      .first();
    expect(retired).toEqual({
      wrapped_key: null,
      kek_id: null,
      retired_at: "2026-11-06T00:00:00.000Z",
    });
  });

  it("allows only one active key per practice", async () => {
    await activeSigningKey(ctx);
    const created = await newSigningKey(ctx.tenantId, await keyEncryptionKey());
    await expect(
      env
        .DB!.prepare(
          "INSERT INTO dossier_keys(tenant_id,id,wrapped_key,kek_id,public_key,active,created_at) VALUES(?,?,?,?,?,1,?)",
        )
        .bind(
          ctx.tenantId,
          created.id,
          created.wrappedKey,
          created.kekId,
          created.publicKeySPKI,
          "2026-11-06T00:00:00.000Z",
        )
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe("drizzle 0009", () => {
  it("retires and erases every plaintext key, keeping the public halves", () => {
    const sqlite = new DatabaseSync(":memory:"),
      folder = new URL("../drizzle/", import.meta.url),
      files = readdirSync(folder)
        .filter((f) => f.endsWith(".sql"))
        .sort(),
      at = files.findIndex((f) => f.endsWith("_dossier_signing_keys.sql"));
    expect(at).toBeGreaterThan(0);
    const apply = (file: string) => {
      for (const sql of readFileSync(new URL(file, folder), "utf8").split(
        "--> statement-breakpoint",
      ))
        if (sql.trim()) sqlite.exec(sql);
    };
    files.slice(0, at).forEach(apply);
    const insert = sqlite.prepare(
      "INSERT INTO dossier_keys(tenant_id,id,private_key,public_key,active,created_at) VALUES(?,?,?,?,?,?)",
    );
    insert.run("tenant-1", "KEY-old", "PLAINTEXT-1", "SPKI-1", 0, "2026-01-01");
    insert.run("tenant-1", "KEY-new", "PLAINTEXT-2", "SPKI-2", 1, "2026-02-01");
    insert.run("tenant-2", "KEY-b", "PLAINTEXT-3", "SPKI-3", 1, "2026-03-01");
    files.slice(at).forEach(apply);
    const rows = sqlite
      .prepare("SELECT * FROM dossier_keys ORDER BY id")
      .all() as Record<string, unknown>[];
    expect(JSON.stringify(rows)).not.toContain("PLAINTEXT");
    expect(
      rows.map((r) => [
        r.id,
        r.public_key,
        r.active,
        r.wrapped_key,
        typeof r.retired_at,
        r.retired_reason,
      ]),
    ).toEqual([
      [
        "KEY-b",
        "SPKI-3",
        0,
        null,
        "string",
        "Private key was stored unwrapped; retired by migration 0009 (F-23)",
      ],
      [
        "KEY-new",
        "SPKI-2",
        0,
        null,
        "string",
        "Private key was stored unwrapped; retired by migration 0009 (F-23)",
      ],
      [
        "KEY-old",
        "SPKI-1",
        0,
        null,
        "object",
        "Rotated before migration 0009; retirement time not recorded",
      ],
    ]);
  });
});
