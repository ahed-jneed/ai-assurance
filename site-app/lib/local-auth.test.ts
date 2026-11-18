import { describe, expect, it } from "vitest";
import {
  MAX_FAILED_ATTEMPTS,
  accountCount,
  changePassword,
  checkCredentials,
  createAccount,
  createSession,
  endSession,
  hashPassword,
  isLocalOwner,
  passwordProblem,
  readSignupToken,
  sessionAccount,
  signupInvitation,
  signupToken,
  verifyPassword,
} from "./local-auth";
import { sqliteD1 } from "./test-d1";

const secret = Buffer.alloc(32, 9).toString("base64");
const password = "correct horse battery";

function freshDb() {
  return sqliteD1().db as unknown as D1Database;
}

describe("passwords", () => {
  it("hashes with a fresh salt and verifies only the right password", async () => {
    const a = await hashPassword(password),
      b = await hashPassword(password);
    expect(a).toMatch(/^pbkdf2-sha256\$100000\$[\w-]{22}\$[\w-]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword(password + "!", a)).toBe(false);
  });

  it("refuses malformed or weakened hashes", async () => {
    const good = await hashPassword(password);
    const [, , salt, hash] = good.split("$");
    for (const stored of [
      "",
      "plain",
      `md5$100000$${salt}$${hash}`,
      `pbkdf2-sha256$1000$${salt}$${hash}`,
      `pbkdf2-sha256$100000$$${hash}`,
      `pbkdf2-sha256$100000$${salt}$short`,
    ])
      expect(await verifyPassword(password, stored), stored).toBe(false);
  });

  it("asks for a usable password", () => {
    expect(passwordProblem("short")).toMatch(/at least 12/);
    expect(passwordProblem("x".repeat(201))).toMatch(/at most 200/);
    expect(
      passwordProblem("Lea@Practice.example", "lea@practice.example"),
    ).toMatch(/email/);
    expect(passwordProblem(password, "lea@practice.example")).toBeNull();
  });
});

describe("accounts", () => {
  it("allows exactly one owner and one account per email", async () => {
    const db = freshDb();
    const owner = await createAccount(db, {
      email: " Owner@Practice.example ",
      name: "Owner",
      password,
      owner: true,
    });
    expect(owner).not.toBeNull();
    expect(
      await createAccount(db, {
        email: "second@practice.example",
        name: "Second",
        password,
        owner: true,
      }),
    ).toBeNull();
    expect(
      await createAccount(db, {
        email: "owner@practice.example",
        name: "Duplicate",
        password,
        owner: false,
      }),
    ).toBeNull();
    expect(await accountCount(db)).toBe(1);
    expect(await isLocalOwner(db, owner!.userId)).toBe(true);
    const member = await createAccount(db, {
      email: "member@practice.example",
      name: "Member",
      password,
      owner: false,
    });
    expect(await isLocalOwner(db, member!.userId)).toBe(false);
  });

  it("locks an account after repeated failures and resets on success", async () => {
    const db = freshDb();
    await createAccount(db, {
      email: "lea@practice.example",
      name: "Lea",
      password,
      owner: true,
    });
    expect(
      await checkCredentials(db, "nobody@practice.example", password),
    ).toEqual({ ok: false, reason: "invalid" });
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++)
      expect(
        (await checkCredentials(db, "lea@practice.example", "wrong password!"))
          .ok,
      ).toBe(false);
    expect(
      (await checkCredentials(db, "LEA@practice.example", password)).ok,
    ).toBe(true);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++)
      await checkCredentials(db, "lea@practice.example", "wrong password!");
    // Locked: even the right password is refused until the lock expires.
    expect(
      await checkCredentials(db, "lea@practice.example", password),
    ).toEqual({ ok: false, reason: "locked" });
  });
});

describe("sessions", () => {
  it("stores only the token's hash and ends sessions", async () => {
    const db = freshDb();
    const { userId } = (await createAccount(db, {
      email: "lea@practice.example",
      name: "Lea",
      password,
      owner: true,
    }))!;
    const session = await createSession(db, userId);
    expect(session.token).toMatch(/^[\w-]{43}$/);
    const rows = (
      await db
        .prepare("SELECT token_hash FROM local_sessions")
        .all<{ token_hash: string }>()
    ).results;
    expect(rows.map((r) => r.token_hash)).not.toContain(session.token);
    expect((await sessionAccount(db, session.token))?.user_id).toBe(userId);
    expect(await sessionAccount(db, "x".repeat(43))).toBeNull();
    expect(await sessionAccount(db, "not a token")).toBeNull();
    await endSession(db, session.token);
    expect(await sessionAccount(db, session.token)).toBeNull();
  });

  it("refuses an expired session", async () => {
    const db = freshDb();
    const { userId } = (await createAccount(db, {
      email: "lea@practice.example",
      name: "Lea",
      password,
      owner: true,
    }))!;
    const session = await createSession(db, userId);
    await db
      .prepare("UPDATE local_sessions SET expires_at=?")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    expect(await sessionAccount(db, session.token)).toBeNull();
  });

  it("ends every other session when the password changes", async () => {
    const db = freshDb();
    const { userId } = (await createAccount(db, {
      email: "lea@practice.example",
      name: "Lea",
      password,
      owner: true,
    }))!;
    const kept = await createSession(db, userId),
      other = await createSession(db, userId);
    await changePassword(db, userId, "a new long password", kept.token);
    expect(await sessionAccount(db, kept.token)).not.toBeNull();
    expect(await sessionAccount(db, other.token)).toBeNull();
    expect(
      (
        await checkCredentials(
          db,
          "lea@practice.example",
          "a new long password",
        )
      ).ok,
    ).toBe(true);
  });
});

describe("sign-up links", () => {
  it("round-trips and refuses tampering or a missing secret", async () => {
    const token = (await signupToken(secret, "tenant-1", "INV-abc"))!;
    expect(await readSignupToken(secret, token)).toEqual({
      tenantId: "tenant-1",
      invitationId: "INV-abc",
    });
    const [payload, mac] = token.split(".");
    const forged = Buffer.from("tenant-1\nINV-other").toString("base64url");
    expect(await readSignupToken(secret, forged + "." + mac)).toBeNull();
    expect(
      await readSignupToken(secret, payload + "." + mac + ".x"),
    ).toBeNull();
    expect(
      await readSignupToken(Buffer.alloc(32, 1).toString("base64"), token),
    ).toBeNull();
    expect(await signupToken(undefined, "tenant-1", "INV-abc")).toBeNull();
    expect(await signupToken("too-short", "tenant-1", "INV-abc")).toBeNull();
    expect(await readSignupToken(undefined, token)).toBeNull();
  });

  it("names only a pending, unexpired invitation", async () => {
    const db = freshDb();
    const at = new Date().toISOString(),
      later = new Date(Date.now() + 86_400_000).toISOString();
    await db.batch([
      db
        .prepare("INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)")
        .bind("tenant-1", "Practice", at),
      db
        .prepare(
          "INSERT INTO invitations(tenant_id,id,email,display_name,role,status,invited_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          "tenant-1",
          "INV-1",
          "ava@practice.example",
          "Ava",
          "Auditor",
          "pending",
          "local-owner",
          at,
          later,
        ),
    ]);
    const token = (await signupToken(secret, "tenant-1", "INV-1"))!;
    expect(await signupInvitation(db, secret, token)).toEqual({
      email: "ava@practice.example",
      displayName: "Ava",
    });
    await db.prepare("UPDATE invitations SET status='cancelled'").run();
    expect(await signupInvitation(db, secret, token)).toBeNull();
  });
});
