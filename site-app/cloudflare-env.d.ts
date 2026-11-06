declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    // Identity (lib/identity.ts, docs/security/identity.md). Unset means no
    // identity is trusted and the API answers 401, except in the Sites build,
    // which defaults to IDENTITY_MODE=sites.
    IDENTITY_MODE?: string;
    IDENTITY_TRUSTED_HEADERS?: string;
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;
  }
}
