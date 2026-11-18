# Dossier signing keys

Each practice signs its dossiers and evidence briefing packets with an Ed25519 key of its own. This page covers how those keys are stored, how the platform operator configures the key-encryption secret, how a practice administrator rotates a key, and how a recipient finds the key that verifies a dossier. Code: `site-app/lib/signing-keys.ts`, `site-app/lib/dossier.ts`, `site-app/lib/commands/management/signing-keys.ts`, `site-app/app/api/dossier/keys/route.ts`; table `dossier_keys` (`site-app/db/schema.ts`, `site-app/drizzle/0009_dossier_signing_keys.sql`).

## Storage

- A private key is never stored in the clear. When the platform creates a key, it wraps the PKCS#8 private key with AES-256-GCM under the key-encryption key (KEK) from the `DOSSIER_KEK` Worker secret, with a random 96-bit IV. The practice ID and key ID are bound in as additional authenticated data, so a wrapped key copied to another practice or row fails to unwrap.
- D1 holds the wrapped key (`wrapped_key`), the KEK's fingerprint (`kek_id`, a truncated SHA-256 of the secret, not the secret itself) and the public key. Signing unwraps the key into a non-extractable WebCrypto key for the one request.
- A practice has at most one active key (a unique partial index). A practice's first seal or briefing export creates it.
- When a key retires, its wrapped private half is erased (`wrapped_key` and `kek_id` become NULL). Its public half, creation time, retirement time and reason stay, so everything it signed still verifies.

**Before #25** private keys were stored as plaintext PKCS#8 (F-23). Migration `0009` cannot wrap a key in SQL, and a key that sat in plaintext must be presumed exposed to anyone who had D1 read access or a backup. So the migration retires every existing key, erases its private half and records the reason. Each practice's next seal or briefing export creates a new, wrapped key. Dossiers and packets signed before the migration still verify against the retired public keys. Older D1 backups and Time Travel restore points still contain the plaintext keys: treat them as sensitive until they expire, and do not restore `dossier_keys` from them.

## Configure the key-encryption secret (platform operator)

`DOSSIER_KEK` is 32 random bytes in standard base64 (44 characters ending in `=`). The repository owner sets the production value; never commit a real key, and never reuse one between deployments.

1. Generate a value on a trusted machine, for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` or `openssl rand -base64 32`.
2. Set it as a Worker secret, not a plain variable: `npx wrangler secret put DOSSIER_KEK --config dist/server/wrangler.json` from `site-app/` after `npm run build`, or in the Cloudflare dashboard under the Worker's Settings, Variables and Secrets, as type Secret.
3. Keep a copy in the organisation's secret store. Losing it does not lose any signature (public keys are stored separately), but the active keys can no longer sign until they are rotated.

Without `DOSSIER_KEK`, sealing a dossier, exporting a briefing packet and rotating a key answer 503 "Signing is not configured" and nothing is signed. A value that is not 32 bytes of standard base64 answers 503 as well.

| Where | KEK |
| --- | --- |
| Self-hosted with `npm run self-host` or Docker | `DOSSIER_KEK` created on first start in `DATA_DIR/secrets.env`; back it up with the data |
| Other deployments (built-in accounts, Cloudflare Access, `trusted-headers`) | `DOSSIER_KEK` secret; required |
| Development server (`npm run dev`, `IDENTITY_MODE=dev`) | `DOSSIER_KEK` when set, otherwise a public development key (`kek-development`) that protects nothing |
| Vitest and the Miniflare harnesses | A test key generated for each run |

**Changing `DOSSIER_KEK`.** A key wrapped under the old secret cannot be unwrapped under the new one, and signing answers 503 naming both fingerprints. Either restore the old secret, or have a practice administrator of each practice rotate its signing key: rotation does not need the old private key. There is no automatic re-wrapping (a follow-up).

## Rotate a key (practice administrator)

Only a practice administrator rotates the key, because it signs for every engagement of the practice. In the workspace: Members & access, Practice, **Rotate signing key**, with a reason. Through the API: `POST /api/management` with op `rotateSigningKey` and `data: { "reason": "..." }` (1 to 500 characters). Everyone else gets 403.

The rotation is a management event (`management_events`, action `rotateSigningKey`, details: the new key ID, its public key and the reason; never the private key). It creates a new wrapped key and retires the active one in the same batch. Rotate on a schedule, when an administrator with access to the deployment leaves, and at once on any suspicion that `DOSSIER_KEK` or a key was exposed. Tell recipients who pin keys about the new key through an independent channel.

The earlier `rotate_key` op of `POST /api/dossier`, which any engagement's Lead Auditor could call, is removed.

## Verification keys

- Each dossier's signed manifest (schema 1.1 and later) names the key in `signingKeyId`; the unsigned `signature` block repeats the key ID and carries the public key. The verifier refuses a 1.1 or 1.2 dossier whose signature names a different key than the manifest. Manifest 1.1 also signs the captured rule-pack stamp (`rulePack`) and `methodologyVersion`, or null for a report that captured none. Manifest 1.2 (#83) also signs the export `scope`: null for the full dossier, or the scope of a scoped internal export (see `docs/external-auditor-implementation.md`, "Scoped exports"). `python -m engine.assurance verify` (tool 1.3.0) accepts manifests 1.0, 1.1 and 1.2, so dossiers sealed before these changes still verify.
- `GET /api/dossier/keys?tenantId=<practice>` lists every key the practice has used, active and retired, with creation and retirement times and reasons, to any member of the practice, including client members. Its `trust` field is in the `--trusted-keys` format of the verifier.
- A key list fetched from the same server that signed the dossier does not establish origin. Confirm the key ID and public key through an independent channel (for example the engagement letter or a call with the practice) before relying on `--require-trusted-signature`.

## Limits

- This is application signing with a key held by the Worker, not a KMS or HSM key, a qualified electronic signature or a trusted timestamp. Anyone who holds both `DOSSIER_KEK` and D1 read access can recover a practice's active private key.
- Recipients learn about a rotation only from the practice; there is no revocation list or transparency log.
