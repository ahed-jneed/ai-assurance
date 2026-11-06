// Vendored from @openai/sites-vite-plugin 0.2.0 (openai/sites#9).
// See sites-vite-plugin.LICENSE for the upstream MIT license.
// Local changes: test personas (`/signin-with-chatgpt?as=<id>`) from
// fixtures/dev-personas.json, a sign-in cookie per dev server port, shared
// return-path checks, the middleware exported for its tests, and hosting.json
// staying optional. The mock runs only in the development server, never in a
// build; the Worker trusts its headers in IDENTITY_MODE=dev (lib/identity.ts).
import { access, cp, mkdir, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Connect, Plugin } from "vite";
import devPersonas from "../fixtures/dev-personas.json";
import {
  CALLBACK_PATH,
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  isAuthPath,
  safeReturnPath,
} from "../lib/auth-paths";

type LocalIdentity = { userId: string; email: string; name: string };
// Cookies ignore the port, so dev servers on one host would share a single
// sign-in cookie and sign each other in and out. Each server reads and sets
// only the cookie named for its own port. Upstream's unsuffixed name and other
// ports' cookies are never read, and no local sign-in cookie reaches the app.
const localCookiePrefix = "__sites_local_auth";
const localCookiePattern = /^__sites_local_auth(?:_\d+)?=/;
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const localAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
// Cookie value "1" is the default identity (as upstream); a persona id selects
// that persona. Any other value signs nobody in.
const personas = new Map<string, LocalIdentity>(
  devPersonas.personas.map((persona) => [persona.id, persona]),
);
function localIdentity(cookie: string): LocalIdentity | undefined {
  return cookie === "1" ? devPersonas.defaultIdentity : personas.get(cookie);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * The development server's sign-in mock. It answers the reserved sign-in
 * routes for loopback requests and turns this server's sign-in cookie into the
 * oai-authenticated-user-* headers that IDENTITY_MODE=dev trusts. Inbound
 * copies of those headers are removed from every request first.
 */
export function localAuthMiddleware({
  secure,
}: {
  secure: boolean;
}): Connect.NextHandleFunction {
  return (request, response, next) => {
    for (const name of Object.keys(request.headers)) {
      if (name.startsWith("oai-authenticated-user-")) {
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
    // Local change: the port this server accepted the connection on names its
    // sign-in cookie.
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

    if (url.pathname === CALLBACK_PATH) {
      respond(response, 501);
      return;
    }

    const signIn = url.pathname === SIGN_IN_PATH;
    const signOut = url.pathname === SIGN_OUT_PATH;
    if (!signIn && !signOut) {
      const identity =
        signInCookies.length === 1
          ? localIdentity(signInCookies[0])
          : undefined;
      if (identity) {
        setHeader(request, "oai-authenticated-user-id", identity.userId);
        setHeader(request, "oai-authenticated-user-email", identity.email);
        setHeader(
          request,
          "oai-authenticated-user-full-name",
          encodeURIComponent(identity.name),
        );
        setHeader(
          request,
          "oai-authenticated-user-full-name-encoding",
          "percent-encoded-utf-8",
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

    // Local change: `?as=<id>` signs in as a persona from the fixture.
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

export function sites({ mockAuth = true } = {}): Plugin {
  let root = process.cwd();
  let command: "build" | "serve" = "build";

  return {
    name: "sites",
    configResolved(config) {
      root = config.root;
      command = config.command;
    },
    configureServer(server) {
      if (!mockAuth) return;
      const secure = Boolean(server.config.server.https);

      server.config.logger.info(
        `Sites local sign-in: ${devPersonas.defaultIdentity.email}; personas: ${SIGN_IN_PATH}?as=<${[...personas.keys()].join("|")}>`,
      );
      server.middlewares.use(localAuthMiddleware({ secure }));
    },
    async closeBundle() {
      if (command !== "build") return;

      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      // Local change: hosting.json is checkout-local, so clean clones and CI
      // build without it (vite.config.ts then uses the default bindings).
      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      }
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }
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
