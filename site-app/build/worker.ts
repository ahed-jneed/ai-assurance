import handler from "vinext/server/fetch-handler";
import { trackRequestBody } from "../lib/http";
import {
  authRoute,
  authenticate,
  identityConfig,
  runWithIdentity,
} from "../lib/identity";
import { withResponseStatus } from "../lib/response-status";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    // The identity is settled before the app sees the request: IDENTITY_MODE
    // picks the one trusted credential, and inbound identity headers are always
    // removed (docs/security/identity.md). The `dev` mode exists only on the
    // development server. The sign-in routes are answered after
    // authentication: behind Cloudflare Access, sign-in returns only a
    // verified caller to the page.
    const config = identityConfig(env, { devServer: import.meta.env.DEV });
    // Whatever answers, a request body left unread is discarded before the
    // response goes out, so the connection stays usable (#209).
    const tracked = trackRequestBody(request);
    try {
      const caller = await authenticate(tracked.request, config);
      const route = authRoute(tracked.request, config, caller.identity);
      if (route) return withSecurityHeaders(route);
      // A page may record its own status (lib/response-status.ts, #216).
      return withSecurityHeaders(
        await withResponseStatus(() =>
          runWithIdentity(caller.identity, () =>
            handler.fetch(caller.request, env, ctx),
          ),
        ),
      );
    } finally {
      await tracked.settle();
    }
  },
};

/**
 * Security headers on every Worker response; a header the app set itself (an
 * evidence download's sandbox CSP, for one) is kept. No page may be framed by
 * another site (clickjacking).
 */
const securityHeaders: [string, string][] = [
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  [
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  ],
  ["X-Frame-Options", "DENY"],
  [
    "Content-Security-Policy",
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  ],
];
function withSecurityHeaders(response: Response): Response {
  if (response.status === 101) return response;
  const secured = new Response(response.body, response);
  for (const [name, value] of securityHeaders)
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  return secured;
}
