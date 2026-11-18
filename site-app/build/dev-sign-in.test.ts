import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import { describe, expect, it, vi } from "vitest";
import devPersonas from "../fixtures/dev-personas.json";
import { localAuthMiddleware } from "./dev-sign-in";

const forged = {
  "X-Assurance-User-Id": "forged-admin",
  "x-assurance-user-email": "forged@attacker.invalid",
  "x-assurance-user-name": "Forged%20Admin",
};
const auditor = devPersonas.personas.find((p) => p.id === "qa-auditor")!;
const lead = devPersonas.personas.find((p) => p.id === "qa-lead")!;

/** The identity headers the mock sets for `who`. */
function signedIn(who: { userId: string; email: string; name: string }) {
  return {
    "x-assurance-user-id": who.userId,
    "x-assurance-user-email": who.email,
    "x-assurance-user-name": encodeURIComponent(who.name),
  };
}

/**
 * Runs the middleware on a fake request that reached the dev server listening
 * on `port` from `remoteAddress`.
 */
function call({
  path = "/api/workspace",
  method = "GET",
  headers = {},
  port = 5184,
  remoteAddress = "127.0.0.1",
  secure = false,
}: {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  port?: number;
  remoteAddress?: string;
  secure?: boolean;
} = {}) {
  const sent = { host: `127.0.0.1:${port}`, ...headers };
  const request = {
    url: path,
    method,
    headers: Object.fromEntries(
      Object.entries(sent).map(([name, value]) => [name.toLowerCase(), value]),
    ),
    rawHeaders: Object.entries(sent).flat(),
    socket: { remoteAddress, localPort: port },
  } as unknown as IncomingMessage;
  const answer = new Map<string, unknown>();
  let body: string | undefined;
  let ended = false;
  const response = {
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      answer.set(name.toLowerCase(), value);
    },
    end(chunk?: string) {
      ended = true;
      body = chunk;
    },
  } as unknown as ServerResponse;
  const next = vi.fn();
  localAuthMiddleware({ secure })(
    request as Connect.IncomingMessage,
    response,
    next,
  );
  return {
    /** Handed on to the app rather than answered by the mock. */
    passed: next.mock.calls.length === 1 && !ended,
    status: response.statusCode,
    location: answer.get("location"),
    setCookie: answer.get("set-cookie"),
    body,
    /** The identity headers the app receives. */
    identity: Object.fromEntries(
      Object.entries(request.headers).filter(([name]) =>
        name.startsWith("x-assurance-user-"),
      ),
    ),
    rawIdentity: request.rawHeaders.filter((value, index) =>
      index % 2 === 0 ? /^x-assurance-user-/i.test(value) : false,
    ),
    cookie: request.headers.cookie,
  };
}

describe("localAuthMiddleware (the dev server's persona sign-in)", () => {
  it("strips inbound x-assurance-user-* headers from every request", () => {
    for (const remoteAddress of ["127.0.0.1", "::1", "192.0.2.10"]) {
      const anonymous = call({ headers: forged, remoteAddress });
      expect(anonymous.passed, remoteAddress).toBe(true);
      expect(anonymous.identity, remoteAddress).toEqual({});
      expect(anonymous.rawIdentity, remoteAddress).toEqual([]);
    }
    const persona = call({
      headers: { ...forged, cookie: "__dev_sign_in_5184=qa-auditor" },
    });
    expect(persona.identity).toEqual(signedIn(auditor));
  });

  it("signs in as a fixture persona and returns to the deep link", () => {
    const deepLink = "/?view=Findings&engagement=ENG-1";
    const signIn = call({
      path:
        "/auth/sign-in?" +
        new URLSearchParams({ as: "qa-auditor", return_to: deepLink }),
    });
    expect(signIn).toMatchObject({ passed: false, status: 302 });
    expect(signIn.location).toBe(deepLink);
    expect(signIn.setCookie).toBe(
      "__dev_sign_in_5184=qa-auditor; Path=/; HttpOnly; SameSite=Lax",
    );
    expect(
      call({ path: "/auth/sign-in?return_to=//evil.example" }),
    ).toMatchObject({
      location: "/",
      setCookie: "__dev_sign_in_5184=1; Path=/; HttpOnly; SameSite=Lax",
    });
    expect(
      call({ path: "/auth/sign-in?as=qa-lead", secure: true }).setCookie,
    ).toBe(
      "__dev_sign_in_5184=qa-lead; Path=/; HttpOnly; SameSite=Lax; Secure",
    );

    const app = call({
      headers: { cookie: "__dev_sign_in_5184=qa-auditor" },
    });
    expect(app.passed).toBe(true);
    expect(app.identity).toEqual(signedIn(auditor));
    expect(app.cookie, "the app never sees the sign-in cookie").toBe(undefined);
    expect(
      call({ headers: { cookie: "__dev_sign_in_5184=1" } }).identity,
    ).toEqual(signedIn(devPersonas.defaultIdentity));
  });

  it("answers an unknown persona with 400 and sets no cookie", () => {
    for (const persona of ["qa-admin", "", "__proto__", "QA-LEAD"]) {
      const response = call({
        path: "/auth/sign-in?" + new URLSearchParams({ as: persona }),
      });
      expect(response.status, persona).toBe(400);
      expect(response.passed, persona).toBe(false);
      expect(response.setCookie, persona).toBe(undefined);
      expect(response.body, persona).toContain(
        "Unknown persona. Choose one of: qa-lead, qa-auditor,",
      );
    }
  });

  it("leaves a cookie value outside the fixture anonymous", () => {
    for (const cookie of [
      "__dev_sign_in_5184=qa-admin",
      "__dev_sign_in_5184=persona-qa-lead",
      "__dev_sign_in_5184=",
      "__dev_sign_in_5184=__proto__",
      "__dev_sign_in_5184=constructor",
      "__dev_sign_in_5184=QA-LEAD",
      "__dev_sign_in_5184=qa-lead; __dev_sign_in_5184=qa-lead",
    ]) {
      const response = call({ headers: { ...forged, cookie } });
      expect(response.passed, cookie).toBe(true);
      expect(response.identity, cookie).toEqual({});
    }
  });

  it("answers sign-in from a non-loopback socket with 403 and sets no identity", () => {
    for (const remoteAddress of [
      "192.0.2.10",
      "127.0.0.2",
      "::ffff:10.0.0.8",
    ]) {
      const signIn = call({
        path: "/auth/sign-in?as=qa-lead&return_to=/",
        remoteAddress,
      });
      expect(signIn.status, remoteAddress).toBe(403);
      expect(signIn.setCookie, remoteAddress).toBe(undefined);
      expect(call({ path: "/auth/sign-out", remoteAddress }).status).toBe(403);
      const app = call({
        headers: { ...forged, cookie: "__dev_sign_in_5184=qa-lead" },
        remoteAddress,
      });
      expect(app.passed, remoteAddress).toBe(true);
      expect(app.identity, remoteAddress).toEqual({});
    }
    // A loopback socket does not help a request addressed to another host.
    const proxied = call({
      path: "/auth/sign-in?as=qa-lead",
      headers: { host: "audit.example:5184" },
    });
    expect(proxied.status).toBe(403);
  });

  it("reads and clears only the sign-in cookie of its own port", () => {
    const jar = [
      "theme=dark",
      "__dev_sign_in=qa-lead",
      "__dev_sign_in_5194=qa-lead",
      "__dev_sign_in_5184=qa-auditor",
    ].join("; ");
    const here = call({ port: 5184, headers: { cookie: jar } });
    expect(here.identity).toEqual(signedIn(auditor));
    expect(here.cookie, "no sign-in cookie reaches the app").toBe("theme=dark");
    expect(call({ port: 5194, headers: { cookie: jar } }).identity).toEqual(
      signedIn(lead),
    );
    for (const cookie of [
      "__dev_sign_in_5194=qa-lead",
      "__dev_sign_in=qa-lead",
      "__dev_sign_in_51840=qa-lead",
    ])
      expect(
        call({ port: 5184, headers: { cookie } }).identity,
        cookie,
      ).toEqual({});

    const signOut = call({
      port: 5184,
      path: "/auth/sign-out?return_to=%2F%3Fview%3DOverview",
      headers: { cookie: jar },
    });
    expect(signOut).toMatchObject({ status: 302, location: "/?view=Overview" });
    expect(signOut.setCookie).toBe(
      "__dev_sign_in_5184=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    );
    expect(
      call({ port: 5194, path: "/auth/sign-in?as=qa-lead" }).setCookie,
    ).toBe("__dev_sign_in_5194=qa-lead; Path=/; HttpOnly; SameSite=Lax");
  });
});
