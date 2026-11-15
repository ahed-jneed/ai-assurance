// Built-in accounts for the `local` identity mode (docs/security/identity.md):
// email and password, hashed with PBKDF2-SHA256, and sessions held in an
// HttpOnly cookie whose random token is stored only as its SHA-256. The first
// account is the owner; everyone else signs up through an invitation's signed
// sign-up link. Pure storage and crypto: the pages are in lib/local-auth-pages.ts.

/** Workers caps PBKDF2 at 100,000 iterations. */
export const PBKDF2_ITERATIONS = 100_000;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;
/** Consecutive failed sign-ins before an account is locked, and for how long. */
export const MAX_FAILED_ATTEMPTS = 10;
export const LOCK_MINUTES = 15;
export const SESSION_DAYS = 14;
export const SESSION_COOKIE = "assurance_session";

/** As lib/invitations.ts normalizes invitation emails. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function unbase64url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
/** Constant-time comparison of two byte strings. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** `pbkdf2-sha256$<iterations>$<salt>$<hash>`, base64url parts. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return [
    "pbkdf2-sha256",
    PBKDF2_ITERATIONS,
    base64url(salt),
    base64url(hash),
  ].join("$");
}

/** Whether `password` matches a hash from hashPassword(). */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, rounds, saltText, hashText] = stored.split("$");
  const iterations = Number(rounds);
  const salt = unbase64url(saltText ?? ""),
    expected = unbase64url(hashText ?? "");
  if (
    scheme !== "pbkdf2-sha256" ||
    !Number.isInteger(iterations) ||
    iterations < 10_000 ||
    iterations > PBKDF2_ITERATIONS ||
    !salt?.length ||
    expected?.length !== 32
  )
    return false;
  return equalBytes(await pbkdf2(password, salt, iterations), expected);
}

/** A reason the password is not acceptable, or null. */
export function passwordProblem(password: string, email = ""): string | null {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase())
    return "Do not use your email address as the password.";
  return null;
}

export type LocalAccount = {
  user_id: string;
  email: string;
  name: string;
  password_hash: string;
  owner: number;
  failed_attempts: number;
  locked_until: string | null;
};

export async function accountCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM local_accounts")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function accountByEmail(
  db: D1Database,
  email: string,
): Promise<LocalAccount | null> {
  return db
    .prepare("SELECT * FROM local_accounts WHERE email=?")
    .bind(normalizeEmail(email))
    .first<LocalAccount>();
}

/**
 * Creates an account. The owner is the first account only: the unique index
 * on owner=1 refuses a second, even when two setups race. Returns null when
 * the email (or the owner seat) is already taken.
 */
export async function createAccount(
  db: D1Database,
  input: { email: string; name: string; password: string; owner: boolean },
): Promise<{ userId: string } | null> {
  const userId = "local-" + crypto.randomUUID();
  const at = new Date().toISOString();
  try {
    await db
      .prepare(
        "INSERT INTO local_accounts(user_id,email,name,password_hash,owner,created_at,password_changed_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        userId,
        normalizeEmail(input.email),
        input.name.trim().slice(0, 120),
        await hashPassword(input.password),
        input.owner ? 1 : 0,
        at,
        at,
      )
      .run();
  } catch (error) {
    if (/UNIQUE/i.test(String(error))) return null;
    throw error;
  }
  return { userId };
}

/** Hashed once so that unknown emails cost as much as wrong passwords. */
let dummyHash: Promise<string> | undefined;

export type SignInResult =
  | { ok: true; account: LocalAccount }
  | { ok: false; reason: "invalid" | "locked" };

/**
 * Checks an email and password. Ten consecutive failures lock the account for
 * fifteen minutes; a success resets the count.
 */
export async function checkCredentials(
  db: D1Database,
  email: string,
  password: string,
): Promise<SignInResult> {
  const account = await accountByEmail(db, email);
  if (!account) {
    dummyHash ??= hashPassword("not a real password");
    await verifyPassword(password, await dummyHash);
    return { ok: false, reason: "invalid" };
  }
  const at = new Date();
  if (account.locked_until && account.locked_until > at.toISOString())
    return { ok: false, reason: "locked" };
  if (await verifyPassword(password, account.password_hash)) {
    if (account.failed_attempts || account.locked_until)
      await db
        .prepare(
          "UPDATE local_accounts SET failed_attempts=0,locked_until=NULL WHERE user_id=?",
        )
        .bind(account.user_id)
        .run();
    return { ok: true, account };
  }
  const failures = account.failed_attempts + 1;
  const lock = failures >= MAX_FAILED_ATTEMPTS;
  await db
    .prepare(
      "UPDATE local_accounts SET failed_attempts=?,locked_until=? WHERE user_id=?",
    )
    .bind(
      lock ? 0 : failures,
      lock
        ? new Date(at.getTime() + LOCK_MINUTES * 60_000).toISOString()
        : null,
      account.user_id,
    )
    .run();
  return { ok: false, reason: lock ? "locked" : "invalid" };
}

/** Starts a session; returns the cookie token (stored only as its hash). */
export async function createSession(
  db: D1Database,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const at = new Date();
  const expiresAt = new Date(
    at.getTime() + SESSION_DAYS * 86_400_000,
  ).toISOString();
  await db.batch([
    // Expired sessions of this user are removed as new ones start.
    db
      .prepare("DELETE FROM local_sessions WHERE user_id=? AND expires_at<=?")
      .bind(userId, at.toISOString()),
    db
      .prepare(
        "INSERT INTO local_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
      )
      .bind(await sha256Hex(token), userId, at.toISOString(), expiresAt),
  ]);
  return { token, expiresAt };
}

/** The account of a live session token, or null. */
export async function sessionAccount(
  db: D1Database,
  token: string,
): Promise<LocalAccount | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return db
    .prepare(
      "SELECT a.* FROM local_sessions s JOIN local_accounts a ON a.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
    )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<LocalAccount>();
}

export async function endSession(db: D1Database, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await db
    .prepare("DELETE FROM local_sessions WHERE token_hash=?")
    .bind(await sha256Hex(token))
    .run();
}

/** Changes a password and ends every other session of the account. */
export async function changePassword(
  db: D1Database,
  userId: string,
  password: string,
  keepToken: string,
) {
  await db.batch([
    db
      .prepare(
        "UPDATE local_accounts SET password_hash=?,password_changed_at=?,failed_attempts=0,locked_until=NULL WHERE user_id=?",
      )
      .bind(await hashPassword(password), new Date().toISOString(), userId),
    db
      .prepare("DELETE FROM local_sessions WHERE user_id=? AND token_hash<>?")
      .bind(userId, await sha256Hex(keepToken)),
  ]);
}

/** Whether the user is the owner account (who may provision a practice). */
export async function isLocalOwner(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  return !!(await db
    .prepare("SELECT 1 FROM local_accounts WHERE user_id=? AND owner=1")
    .bind(userId)
    .first());
}

// --- Sign-up links ----------------------------------------------------------
// A link names a pending invitation and carries an HMAC over it, keyed from
// DOSSIER_KEK, so only a practice administrator (who sees the link) can hand
// it out, and it stops working once the invitation is accepted, cancelled or
// expired. Without DOSSIER_KEK there are no links.

async function linkKey(secret: string | undefined): Promise<CryptoKey | null> {
  let raw: Uint8Array<ArrayBuffer> | null = null;
  try {
    // DOSSIER_KEK: 32 random bytes in standard base64.
    if (secret?.trim())
      raw = Uint8Array.from(atob(secret.trim()), (c) => c.charCodeAt(0));
  } catch {
    raw = null;
  }
  if (!raw || raw.length < 32) return null;
  const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode("ai-assurance sign-up link v1"),
    },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/** The sign-up token for an invitation, or null without DOSSIER_KEK. */
export async function signupToken(
  secret: string | undefined,
  tenantId: string,
  invitationId: string,
): Promise<string | null> {
  const key = await linkKey(secret);
  if (!key) return null;
  const payload = encoder.encode(tenantId + "\n" + invitationId);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
  return base64url(payload) + "." + base64url(mac);
}

/** The invitation a sign-up token names, when its signature holds. */
export async function readSignupToken(
  secret: string | undefined,
  token: string,
): Promise<{ tenantId: string; invitationId: string } | null> {
  const key = await linkKey(secret);
  const [payloadText, macText, extra] = token.split(".");
  if (!key || extra !== undefined || token.length > 600) return null;
  const payload = unbase64url(payloadText ?? ""),
    mac = unbase64url(macText ?? "");
  if (!payload || !mac) return null;
  if (!(await crypto.subtle.verify("HMAC", key, mac, payload))) return null;
  const [tenantId, invitationId, more] = new TextDecoder()
    .decode(payload)
    .split("\n");
  if (!tenantId || !invitationId || more !== undefined) return null;
  return { tenantId, invitationId };
}

/** The pending, unexpired invitation a sign-up token names. */
export async function signupInvitation(
  db: D1Database,
  secret: string | undefined,
  token: string,
): Promise<{ email: string; displayName: string | null } | null> {
  const named = await readSignupToken(secret, token);
  if (!named) return null;
  const row = await db
    .prepare(
      "SELECT email,display_name FROM invitations WHERE tenant_id=? AND id=? AND status='pending' AND expires_at>?",
    )
    .bind(named.tenantId, named.invitationId, new Date().toISOString())
    .first<{ email: string; display_name: string | null }>();
  return row ? { email: row.email, displayName: row.display_name } : null;
}
