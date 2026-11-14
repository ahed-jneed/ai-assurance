import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { trackRequestBody } from "../lib/http";
import {
  authRoute,
  authenticate,
  identityConfig,
  runWithIdentity,
} from "../lib/identity";
import { withResponseStatus } from "../lib/response-status";

/** "sites" in the Sites build, else undefined (`define` in vite.config.ts). */
declare const __SITES_IDENTITY_DEFAULT__: "sites" | undefined;

export default {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>,
  ) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt)
            return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return {
              status: "request_context_expired",
              message: "This request has expired. Please try again.",
            };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    // The identity is settled before the app sees the request: IDENTITY_MODE
    // picks the one trusted credential (while it is unset, the Sites build
    // uses `sites`), and the oai-* headers are removed unless Sites dispatch
    // set them (docs/security/identity.md). The `dev` mode exists only on the
    // development server. The sign-in routes are answered after
    // authentication: behind Cloudflare Access, sign-in returns only a
    // verified caller to the page.
    const config = identityConfig(env, {
      devServer: import.meta.env.DEV,
      defaultMode: __SITES_IDENTITY_DEFAULT__,
    });
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
            runWithConnectorBinding(binding, () =>
              handler.fetch(caller.request, env, ctx),
            ),
          ),
        ),
      );
    } finally {
      await tracked.settle();
    }
  },
};

/**
 * Baseline security headers on every Worker response; a header the app set
 * itself (an evidence download's sandbox CSP, for one) is kept. Framing is not
 * restricted because hosted previews may embed the app, and a script CSP needs
 * nonces for the RSC bootstrap first.
 */
const securityHeaders: [string, string][] = [
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  [
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  ],
  ["Content-Security-Policy", "object-src 'none'; base-uri 'self'"],
];
function withSecurityHeaders(response: Response): Response {
  if (response.status === 101) return response;
  const secured = new Response(response.body, response);
  for (const [name, value] of securityHeaders)
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  return secured;
}
