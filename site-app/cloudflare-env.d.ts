declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    // Identity (lib/identity.ts, docs/security/identity.md). Unset means no
    // identity is trusted and the API answers 401.
    IDENTITY_MODE?: string;
    IDENTITY_TRUSTED_HEADERS?: string;
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;
    // Access lifecycle (lib/access-policy.ts, docs/security/identity.md).
    // SELF_SIGNUP: "open", "off" or an allowlist of emails and @domains;
    // unset means open only on the development server.
    SELF_SIGNUP?: string;
    TENANT_MAX_ENGAGEMENTS?: string;
    TENANT_MAX_SAVES_PER_HOUR?: string;
    // Platform operators (lib/operator.ts): a comma-separated list of exact
    // email addresses that may list and delete abandoned practices at
    // /operator. Unset means nobody, on the development server too.
    PLATFORM_OPERATORS?: string;
    // Signing keys (lib/signing-keys.ts, docs/security/signing-keys.md): a
    // Worker secret of 32 random bytes in base64 that wraps the practices'
    // Ed25519 private keys; unset, signing works only on the development
    // server, with a public development key.
    DOSSIER_KEK?: string;
  }
}
