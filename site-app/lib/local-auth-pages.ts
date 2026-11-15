// The pages of the built-in accounts (`local` identity mode): first-run owner
// setup, sign-in, invited sign-up, password change and sign-out. Plain HTML
// forms served by the Worker entry before the app, so they work without
// JavaScript. Every POST must come from this origin (CSRF), and the session
// cookie is HttpOnly and SameSite=Lax. docs/security/identity.md.
import {
  PASSWORD_PATH,
  SETUP_PATH,
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  SIGN_UP_PATH,
  safeReturnPath,
} from "./auth-paths";
import {
  LOCK_MINUTES,
  MIN_PASSWORD_LENGTH,
  SESSION_COOKIE,
  SESSION_DAYS,
  accountByEmail,
  accountCount,
  changePassword,
  checkCredentials,
  createAccount,
  createSession,
  normalizeEmail,
  endSession,
  passwordProblem,
  sessionAccount,
  signupInvitation,
  verifyPassword,
} from "./local-auth";

const MAX_FORM_BYTES = 16_384;
const routes = new Set([
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  SETUP_PATH,
  SIGN_UP_PATH,
  PASSWORD_PATH,
]);

/** The session token in the request's cookie, or null. */
export function sessionToken(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || null;
  }
  return null;
}

/** HTTPS directly, or behind a proxy that says so. */
function secure(request: Request): boolean {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https"
  );
}
function sessionCookie(request: Request, token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure(request) ? "; Secure" : ""}`;
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

function page(
  title: string,
  body: string,
  {
    status = 200,
    headers = {},
  }: { status?: number; headers?: HeadersInit } = {},
) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · AI Assurance</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f5;--card:#fff;--text:#37352f;--muted:#6b6a66;--line:#e3e2de;--accent:#37352f;--accent-text:#fff;--error:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#191919;--card:#232323;--text:#e9e9e7;--muted:#a3a29e;--line:#373737;--accent:#e9e9e7;--accent-text:#191919;--error:#f97066}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 "Segoe UI",Arial,sans-serif;padding:16px}
main{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:28px}
h1{font-size:1.35rem;margin:0 0 6px}p{margin:0 0 16px;color:var(--muted)}label{display:block;font-weight:600;margin:14px 0 4px}
input{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}small{color:var(--muted)}
button{margin-top:20px;width:100%;padding:10px;border:0;border-radius:6px;background:var(--accent);color:var(--accent-text);font:inherit;font-weight:600;cursor:pointer}
.error{color:var(--error);border:1px solid var(--error);border-radius:6px;padding:8px 10px;margin:0 0 12px}a{color:inherit}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...headers,
    },
  });
}
const errorBox = (message?: string) =>
  message ? `<p class="error" role="alert">${escape(message)}</p>` : "";
const hidden = (name: string, value: string) =>
  `<input type="hidden" name="${name}" value="${escape(value)}">`;
const passwordFields = (autocomplete: string) => `
<label for="password">Password</label>
<input id="password" name="password" type="password" required minlength="${MIN_PASSWORD_LENGTH}" maxlength="200" autocomplete="${autocomplete}" aria-describedby="password-hint">
<small id="password-hint">At least ${MIN_PASSWORD_LENGTH} characters.</small>
<label for="confirm">Repeat the password</label>
<input id="confirm" name="confirm" type="password" required minlength="${MIN_PASSWORD_LENGTH}" maxlength="200" autocomplete="${autocomplete}">`;

function redirect(location: string, request: Request, cookie?: string) {
  return new Response(null, {
    status: request.method === "POST" ? 303 : 302,
    headers: {
      Location: location,
      "Cache-Control": "private, no-store",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
}

/** A same-origin form POST of a bounded size, or the response refusing it. */
async function readForm(request: Request): Promise<URLSearchParams | Response> {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin)
    return page(
      "Request refused",
      "<h1>Request refused</h1><p>The form must be sent from this site.</p>",
      { status: 403 },
    );
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!(length >= 0 && length <= MAX_FORM_BYTES))
    return page(
      "Request refused",
      "<h1>Request refused</h1><p>The form is empty or too large.</p>",
      { status: 413 },
    );
  const text = await request.text();
  if (text.length > MAX_FORM_BYTES)
    return page("Request refused", "<h1>Request refused</h1>", {
      status: 413,
    });
  return new URLSearchParams(text);
}

function signInPage(returnTo: string, message?: string, status = 200) {
  return page(
    "Sign in",
    `<h1>Sign in</h1><p>AI Assurance workspace</p>${errorBox(message)}
<form method="post" action="${SIGN_IN_PATH}">${hidden("return_to", returnTo)}
<label for="email">Email</label><input id="email" name="email" type="email" required maxlength="320" autocomplete="username" autofocus>
<label for="password">Password</label><input id="password" name="password" type="password" required maxlength="200" autocomplete="current-password">
<button type="submit">Sign in</button></form>
<p style="margin-top:16px"><small>Forgot your password? Ask the person who runs this installation to reset it.</small></p>`,
    { status },
  );
}

function setupPage(message?: string, status = 200) {
  return page(
    "Set up",
    `<h1>Create the owner account</h1><p>This installation has no accounts yet. The owner leads the first practice and invites everyone else.</p>${errorBox(message)}
<form method="post" action="${SETUP_PATH}">
<label for="name">Your name</label><input id="name" name="name" required maxlength="120" autocomplete="name" autofocus>
<label for="email">Email</label><input id="email" name="email" type="email" required maxlength="320" autocomplete="username">
${passwordFields("new-password")}
<button type="submit">Create the owner account</button></form>`,
    { status },
  );
}

function signUpPage(
  token: string,
  invite: { email: string; displayName: string | null },
  message?: string,
  status = 200,
) {
  return page(
    "Create your account",
    `<h1>Create your account</h1><p>You were invited as <b>${escape(invite.email)}</b>.</p>${errorBox(message)}
<form method="post" action="${SIGN_UP_PATH}">${hidden("invite", token)}
<label for="name">Your name</label><input id="name" name="name" required maxlength="120" autocomplete="name" value="${escape(invite.displayName ?? "")}" autofocus>
${passwordFields("new-password")}
<button type="submit">Create account</button></form>`,
    { status },
  );
}

function passwordPage(message?: string, status = 200) {
  return page(
    "Change password",
    `<h1>Change your password</h1><p>Your other sessions are signed out.</p>${errorBox(message)}
<form method="post" action="${PASSWORD_PATH}">
<label for="current">Current password</label><input id="current" name="current" type="password" required maxlength="200" autocomplete="current-password" autofocus>
${passwordFields("new-password")}
<button type="submit">Change password</button></form>
<p style="margin-top:16px"><a href="/">Back to the workspace</a></p>`,
    { status },
  );
}

/** The password and its repetition, or why they are refused. */
function newPassword(form: URLSearchParams, email: string) {
  const password = form.get("password") ?? "",
    confirm = form.get("confirm") ?? "";
  if (password !== confirm) return { problem: "The passwords do not match." };
  const problem = passwordProblem(password, email);
  return problem ? { problem } : { password };
}

const validEmail = (email: string) =>
  email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Answers the built-in account routes in `local` mode, or null for any other
 * path. `secret` is DOSSIER_KEK, which keys the sign-up links.
 */
export async function localAuthRoute(
  request: Request,
  db: D1Database,
  secret: string | undefined,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!routes.has(url.pathname)) return null;
  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  const post = method === "POST";
  const token = sessionToken(request);
  const current = token ? await sessionAccount(db, token) : null;
  const accounts = await accountCount(db);

  switch (url.pathname) {
    case SETUP_PATH: {
      if (accounts > 0) return redirect(SIGN_IN_PATH, request);
      if (!post) return setupPage();
      const form = await readForm(request);
      if (form instanceof Response) return form;
      const name = (form.get("name") ?? "").trim(),
        email = normalizeEmail(form.get("email") ?? "");
      if (!name) return setupPage("Enter your name.", 400);
      if (!validEmail(email)) return setupPage("Enter a valid email.", 400);
      const chosen = newPassword(form, email);
      if (!chosen.password) return setupPage(chosen.problem, 400);
      const created = await createAccount(db, {
        email,
        name,
        password: chosen.password,
        owner: true,
      });
      // Another setup won the race: this installation has its owner.
      if (!created) return redirect(SIGN_IN_PATH, request);
      const session = await createSession(db, created.userId);
      return redirect(
        "/",
        request,
        sessionCookie(request, session.token, SESSION_DAYS * 86_400),
      );
    }
    case SIGN_IN_PATH: {
      if (accounts === 0) return redirect(SETUP_PATH, request);
      const returnTo = safeReturnPath(
        post ? null : url.searchParams.get("return_to"),
      );
      if (!post)
        return current ? redirect(returnTo, request) : signInPage(returnTo);
      const form = await readForm(request);
      if (form instanceof Response) return form;
      const target = safeReturnPath(form.get("return_to"));
      const result = await checkCredentials(
        db,
        form.get("email") ?? "",
        form.get("password") ?? "",
      );
      if (!result.ok)
        return signInPage(
          target,
          result.reason === "locked"
            ? `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`
            : "The email or password is incorrect.",
          401,
        );
      if (token) await endSession(db, token);
      const session = await createSession(db, result.account.user_id);
      return redirect(
        target,
        request,
        sessionCookie(request, session.token, SESSION_DAYS * 86_400),
      );
    }
    case SIGN_UP_PATH: {
      const inviteToken = (post ? null : url.searchParams.get("invite")) ?? "";
      if (!post) {
        const invite = await signupInvitation(db, secret, inviteToken);
        if (!invite)
          return page(
            "Link not valid",
            `<h1>This sign-up link is not valid</h1><p>It may have expired, been cancelled or already been used. Ask a practice administrator for a new invitation.</p><p><a href="${SIGN_IN_PATH}">Sign in</a></p>`,
            { status: 404 },
          );
        if (await accountByEmail(db, invite.email))
          return page(
            "Account exists",
            `<h1>You already have an account</h1><p>Sign in as ${escape(invite.email)} to accept the invitation.</p><p><a href="${SIGN_IN_PATH}">Sign in</a></p>`,
          );
        return signUpPage(inviteToken, invite);
      }
      const form = await readForm(request);
      if (form instanceof Response) return form;
      const formToken = form.get("invite") ?? "";
      const invite = await signupInvitation(db, secret, formToken);
      if (!invite)
        return page(
          "Link not valid",
          "<h1>This sign-up link is not valid</h1><p>Ask a practice administrator for a new invitation.</p>",
          { status: 404 },
        );
      const name = (form.get("name") ?? "").trim();
      if (!name) return signUpPage(formToken, invite, "Enter your name.", 400);
      const chosen = newPassword(form, invite.email);
      if (!chosen.password)
        return signUpPage(formToken, invite, chosen.problem, 400);
      const created = await createAccount(db, {
        email: invite.email,
        name,
        password: chosen.password,
        owner: false,
      });
      if (!created)
        return page(
          "Account exists",
          `<h1>You already have an account</h1><p><a href="${SIGN_IN_PATH}">Sign in</a> to accept the invitation.</p>`,
          { status: 409 },
        );
      const session = await createSession(db, created.userId);
      // The invitation is accepted on the first request (lib/tenancy.ts).
      return redirect(
        "/",
        request,
        sessionCookie(request, session.token, SESSION_DAYS * 86_400),
      );
    }
    case PASSWORD_PATH: {
      if (!current || !token)
        return redirect(
          SIGN_IN_PATH + "?return_to=" + encodeURIComponent(PASSWORD_PATH),
          request,
        );
      if (!post) return passwordPage();
      const form = await readForm(request);
      if (form instanceof Response) return form;
      if (
        !(await verifyPassword(
          form.get("current") ?? "",
          current.password_hash,
        ))
      )
        return passwordPage("The current password is incorrect.", 401);
      const chosen = newPassword(form, current.email);
      if (!chosen.password) return passwordPage(chosen.problem, 400);
      await changePassword(db, current.user_id, chosen.password, token);
      return redirect("/", request);
    }
    case SIGN_OUT_PATH: {
      // Sign-out is also a plain link in the account menu (GET).
      if (post) {
        const form = await readForm(request);
        if (form instanceof Response) return form;
      }
      if (token) await endSession(db, token);
      return redirect(SIGN_IN_PATH, request, sessionCookie(request, "", 0));
    }
  }
  return null;
}
