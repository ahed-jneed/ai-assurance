import { describe, expect, it } from "vitest";
import { authenticate, identityConfig } from "./identity";
import { signupToken } from "./local-auth";
import { localAuthRoute, sessionToken } from "./local-auth-pages";
import { sqliteD1 } from "./test-d1";

const origin = "http://127.0.0.1:8787";
const secret = Buffer.alloc(32, 5).toString("base64");
const password = "correct horse battery";

function setup() {
  const db = sqliteD1().db as unknown as D1Database;
  const call = async (
    path: string,
    {
      form,
      cookie,
      headers = {},
    }: {
      form?: Record<string, string>;
      cookie?: string;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const body = form ? new URLSearchParams(form).toString() : undefined;
    const request = new Request(origin + path, {
      method: form ? "POST" : "GET",
      body,
      redirect: "manual",
      headers: {
        ...(form
          ? {
              "Content-Type": "application/x-www-form-urlencoded",
              "Content-Length": String(body!.length),
              Origin: origin,
            }
          : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
    });
    const response = await localAuthRoute(request, db, secret);
    const setCookie = response?.headers.get("set-cookie") ?? "";
    return {
      response: response!,
      status: response?.status,
      location: response?.headers.get("location"),
      cookie: setCookie.split(";")[0],
      setCookie,
      text: response ? await response.text() : "",
    };
  };
  return { db, call };
}

const owner = {
  name: "Olive Owner",
  email: "olive@practice.example",
  password,
  confirm: password,
};

describe("first-run setup", () => {
  it("sends sign-in to setup until the owner exists, then never again", async () => {
    const { call } = setup();
    expect(await call("/auth/sign-in")).toMatchObject({
      status: 302,
      location: "/auth/setup",
    });
    expect((await call("/auth/setup")).text).toContain(
      "Create the owner account",
    );
    const created = await call("/auth/setup", { form: owner });
    expect(created).toMatchObject({ status: 303, location: "/" });
    expect(created.setCookie).toMatch(
      /^assurance_session=[\w-]{43}; Path=\/; Max-Age=1209600; HttpOnly; SameSite=Lax$/,
    );
    // A second setup cannot create another owner.
    expect(await call("/auth/setup")).toMatchObject({
      status: 302,
      location: "/auth/sign-in",
    });
    expect(
      await call("/auth/setup", {
        form: { ...owner, email: "mallory@attacker.example" },
      }),
    ).toMatchObject({ status: 303, location: "/auth/sign-in" });
  });

  it("checks the setup form", async () => {
    const { call } = setup();
    expect(
      (
        await call("/auth/setup", {
          form: { ...owner, confirm: "different!!!!" },
        })
      ).text,
    ).toContain("do not match");
    expect(
      (
        await call("/auth/setup", {
          form: { ...owner, password: "short", confirm: "short" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("/auth/setup", { form: { ...owner, email: "not-an-email" } }))
        .status,
    ).toBe(400);
  });

  it("marks the cookie Secure over HTTPS or behind a TLS proxy", async () => {
    const { call } = setup();
    const created = await call("/auth/setup", {
      form: owner,
      headers: { "X-Forwarded-Proto": "https" },
    });
    expect(created.setCookie).toMatch(/; Secure$/);
  });
});

describe("sign-in and sign-out", () => {
  it("signs in with the right password only, and returns to a safe path", async () => {
    const { call, db } = setup();
    await call("/auth/setup", { form: owner });
    const wrong = await call("/auth/sign-in", {
      form: {
        email: owner.email,
        password: "wrong password!!",
        return_to: "/",
      },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.text).toContain("email or password is incorrect");
    const ok = await call("/auth/sign-in", {
      form: {
        email: owner.email,
        password,
        return_to: "https://evil.example/",
      },
    });
    expect(ok).toMatchObject({ status: 303, location: "/" });
    const deep = await call("/auth/sign-in", {
      form: { email: owner.email, password, return_to: "/?view=Findings" },
    });
    expect(deep.location).toBe("/?view=Findings");

    const out = await call("/auth/sign-out", { cookie: ok.cookie });
    expect(out).toMatchObject({ status: 302, location: "/auth/sign-in" });
    expect(out.setCookie).toMatch(/Max-Age=0/);
    // The ended session no longer signs anyone in.
    const after = await authenticate(
      new Request(origin + "/api/workspace", {
        headers: { Cookie: ok.cookie },
      }),
      identityConfig({ DB: db }, { devServer: false }),
    );
    expect(after.identity).toBeNull();
  });

  it("refuses a cross-site form post", async () => {
    const { call } = setup();
    await call("/auth/setup", { form: owner });
    const forged = await call("/auth/sign-in", {
      form: { email: owner.email, password },
      headers: { Origin: "https://evil.example" },
    });
    expect(forged.status).toBe(403);
  });
});

describe("invited sign-up", () => {
  async function invited() {
    const ctx = setup();
    await ctx.call("/auth/setup", { form: owner });
    const at = new Date().toISOString(),
      later = new Date(Date.now() + 86_400_000).toISOString();
    await ctx.db.batch([
      ctx.db
        .prepare("INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)")
        .bind("tenant-1", "Practice", at),
      ctx.db
        .prepare(
          "INSERT INTO invitations(tenant_id,id,email,display_name,role,status,invited_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          "tenant-1",
          "INV-1",
          "ava@practice.example",
          "Ava Auditor",
          "Auditor",
          "pending",
          "local-owner",
          at,
          later,
        ),
    ]);
    return { ...ctx, token: (await signupToken(secret, "tenant-1", "INV-1"))! };
  }

  it("creates the invitee's account from a valid link only", async () => {
    const { call, token } = await invited();
    expect((await call("/auth/sign-up?invite=bogus")).status).toBe(404);
    const form = await call("/auth/sign-up?invite=" + token);
    expect(form.text).toContain("ava@practice.example");
    const created = await call("/auth/sign-up", {
      form: { invite: token, name: "Ava", password, confirm: password },
    });
    expect(created).toMatchObject({ status: 303, location: "/" });
    expect(created.cookie).toMatch(/^assurance_session=/);
    // The account exists now: the link offers sign-in instead.
    expect((await call("/auth/sign-up?invite=" + token)).text).toContain(
      "already have an account",
    );
  });

  it("cannot be used to choose another email", async () => {
    const { call, token, db } = await invited();
    await call("/auth/sign-up", {
      form: {
        invite: token,
        name: "Mallory",
        email: "mallory@attacker.example",
        password,
        confirm: password,
      },
    });
    const emails = (
      await db.prepare("SELECT email FROM local_accounts ORDER BY email").all<{
        email: string;
      }>()
    ).results.map((r) => r.email);
    expect(emails).toEqual(["ava@practice.example", "olive@practice.example"]);
  });
});

describe("password change", () => {
  it("needs the current password", async () => {
    const { call } = setup();
    const created = await call("/auth/setup", { form: owner });
    expect((await call("/auth/password")).location).toMatch(/^\/auth\/sign-in/);
    const wrong = await call("/auth/password", {
      cookie: created.cookie,
      form: {
        current: "wrong password!!",
        password: "a brand new password",
        confirm: "a brand new password",
      },
    });
    expect(wrong.status).toBe(401);
    const ok = await call("/auth/password", {
      cookie: created.cookie,
      form: {
        current: password,
        password: "a brand new password",
        confirm: "a brand new password",
      },
    });
    expect(ok).toMatchObject({ status: 303, location: "/" });
  });
});

describe("local identity mode", () => {
  it("is the default and trusts only a live session cookie", async () => {
    const { db, call } = setup();
    const config = identityConfig({ DB: db }, { devServer: false });
    expect(config.mode).toBe("local");
    expect(identityConfig({}, { devServer: false })).toMatchObject({
      mode: "none",
    });
    const created = await call("/auth/setup", { form: owner });
    const signedIn = await authenticate(
      new Request(origin + "/api/workspace", {
        headers: {
          Cookie: created.cookie,
          "x-assurance-user-id": "forged",
          "x-assurance-user-email": "forged@attacker.example",
        },
      }),
      config,
    );
    expect(signedIn.identity).toMatchObject({
      email: "olive@practice.example",
      displayName: "Olive Owner",
    });
    expect(signedIn.request.headers.get("x-assurance-user-id")).toBeNull();
    const forged = await authenticate(
      new Request(origin + "/api/workspace", {
        headers: {
          "x-assurance-user-id": "forged",
          "x-assurance-user-email": "forged@attacker.example",
        },
      }),
      config,
    );
    expect(forged.identity).toBeNull();
    expect(
      sessionToken(
        new Request(origin, { headers: { Cookie: "a=1; " + created.cookie } }),
      ),
    ).toBe(created.cookie.split("=")[1]);
  });
});
