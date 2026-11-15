// The development server's sign-in: the default identity or a test persona
// (`/auth/sign-in?as=<id>`) from fixtures/dev-personas.json, held in a sign-in
// cookie per dev server port. It runs only in the development server, never in
// a build, and only for loopback requests; the Worker trusts the headers it
// sets only in IDENTITY_MODE=dev (lib/identity.ts).
// Derived from the MIT-licensed @openai/sites-vite-plugin 0.2.0; see
// dev-sign-in.LICENSE.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import devPersonas from "../fixtures/dev-personas.json" with { type: "json" };
import {
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  isAuthPath,
  safeReturnPath,
} from "../lib/auth-paths.ts";
import {
  IDENTITY_HEADER_PREFIX,
  USER_EMAIL_HEADER,
  USER_FULL_NAME_HEADER,
  USER_ID_HEADER,
} from "../lib/identity.ts";

type LocalIdentity = { userId: string; email: string; name: string };
// Cookies ignore the port, so dev servers on one host would share a single
// sign-in cookie and sign each other in and out. Each server reads and sets
// only the cookie named for its own port. Other ports' cookies are never read,
// and no local sign-in cookie reaches the app.
const localCookiePrefix = "__dev_sign_in";
const localCookiePattern = /^__dev_sign_in(?:_\d+)?=/;
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const localAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
// Cookie value "1" is the default identity; a persona id selects that persona. Any other value signs nobody in.
const personas = new Map<string, LocalIdentity>(
  devPersonas.personas.map((persona) => [persona.id, persona]),
);
function localIdentity(cookie: string): LocalIdentity | undefined {
  return cookie === "1" ? devPersonas.defaultIdentity : personas.get(cookie);
}

/**
 * The development server's sign-in middleware. It answers the sign-in routes
 * for loopback requests and turns this server's sign-in cookie into the
 * x-assurance-user-* headers that IDENTITY_MODE=dev trusts. Inbound copies of
 * those headers are removed from every request first.
 */
export function localAuthMiddleware({
  secure,
}: {
  secure: boolean;
}): Connect.NextHandleFunction {
  return (request, response, next) => {
    for (const name of Object.keys(request.headers)) {
      if (name.startsWith(IDENTITY_HEADER_PREFIX)) {
        removeHeader(request, name);
      }
    }

    let authority: URL;
    let url: URL;
    try {
      authority = new URL(
        `${secure ? "https" : "http"}://${request.headers.host}`,
      );
      url = new URL(request.url ?? "/", authority);
    } catch {
      if (isAuthPath((request.url ?? "/").split("?")[0])) {
        respond(response, 403);
      } else {
        next();
      }
      return;
    }

    const hostname = authority.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    // The port this server accepted the connection on names its sign-in cookie.
    const port = request.socket.localPort;
    if (
      !localHosts.has(hostname) ||
      !localAddresses.has(request.socket.remoteAddress ?? "") ||
      !port ||
      url.origin !== authority.origin
    ) {
      if (isAuthPath(url.pathname)) respond(response, 403);
      else next();
      return;
    }

    const localCookieName = `${localCookiePrefix}_${port}`;
    const cookies = (request.headers.cookie ?? "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean);
    const signInCookies = cookies
      .filter((cookie) => cookie.startsWith(`${localCookieName}=`))
      .map((cookie) => cookie.slice(localCookieName.length + 1));
    const applicationCookies = cookies.filter(
      (cookie) => !localCookiePattern.test(cookie),
    );
    if (applicationCookies.length !== cookies.length) {
      removeHeader(request, "cookie");
      if (applicationCookies.length) {
        setHeader(request, "cookie", applicationCookies.join("; "));
      }
    }

    const signIn = url.pathname === SIGN_IN_PATH;
    const signOut = url.pathname === SIGN_OUT_PATH;
    if (!signIn && !signOut) {
      const identity =
        signInCookies.length === 1
          ? localIdentity(signInCookies[0])
          : undefined;
      if (identity) {
        setHeader(request, USER_ID_HEADER, identity.userId);
        setHeader(request, USER_EMAIL_HEADER, identity.email);
        setHeader(
          request,
          USER_FULL_NAME_HEADER,
          encodeURIComponent(identity.name),
        );
      }
      next();
      return;
    }

    if (
      (request.headers.origin && request.headers.origin !== url.origin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    ) {
      respond(response, 403);
      return;
    }

    if (
      request.headers["next-router-prefetch"] !== undefined ||
      request.headers["x-middleware-prefetch"] === "1" ||
      [request.headers.purpose, request.headers["sec-purpose"]].some(
        (value) =>
          typeof value === "string" &&
          value
            .split(/[;,]/)
            .some((part) => part.trim().toLowerCase() === "prefetch"),
      )
    ) {
      respond(response, 204);
      return;
    }

    if (request.method !== "GET" && (!signOut || request.method !== "POST")) {
      response.setHeader("Allow", signIn ? "GET" : "GET, POST");
      respond(response, 405);
      return;
    }

    // `?as=<id>` signs in as a persona from the fixture.
    const persona = signIn ? url.searchParams.get("as") : null;
    if (persona !== null && !personas.has(persona)) {
      response.statusCode = 400;
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(
        `Unknown persona. Choose one of: ${[...personas.keys()].join(", ")}.\n`,
      );
      return;
    }

    response.statusCode = request.method === "POST" ? 303 : 302;
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader(
      "Location",
      safeReturnPath(url.searchParams.get("return_to")),
    );
    response.setHeader(
      "Set-Cookie",
      `${localCookieName}=${signIn ? (persona ?? "1") : ""}; Path=/; ${
        signOut ? "Max-Age=0; " : ""
      }HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
    );
    response.end();
  };
}

/** The development server's sign-in (never part of a build). */
export function devSignIn({ enabled = true } = {}): Plugin {
  return {
    name: "dev-sign-in",
    apply: "serve",
    configureServer(server) {
      if (!enabled) return;
      const secure = Boolean(server.config.server.https);
      server.config.logger.info(
        `Development sign-in: ${devPersonas.defaultIdentity.email}; personas: ${SIGN_IN_PATH}?as=<${[...personas.keys()].join("|")}>`,
      );
      server.middlewares.use(localAuthMiddleware({ secure }));
    },
  };
}

function removeHeader(request: IncomingMessage, name: string): void {
  delete request.headers[name];
  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      request.rawHeaders.splice(index, 2);
    }
  }
}

function setHeader(
  request: IncomingMessage,
  name: string,
  value: string,
): void {
  removeHeader(request, name);
  request.headers[name] = value;
  request.rawHeaders.push(name, value);
}

function respond(response: ServerResponse, status: number): void {
  response.statusCode = status;
  response.setHeader("Cache-Control", "private, no-store");
  response.end();
}
