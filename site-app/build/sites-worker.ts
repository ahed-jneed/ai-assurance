import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import {
  authRoute,
  authenticate,
  identityConfig,
  runWithIdentity,
} from "../lib/identity";

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
    // picks the one trusted credential, and the oai-* headers are removed
    // unless Sites dispatch set them (docs/security/identity.md). The `dev`
    // mode exists only on the development server.
    const identity = identityConfig(env, { devServer: import.meta.env.DEV });
    const route = authRoute(request, identity);
    if (route) return route;
    const caller = await authenticate(request, identity);
    return runWithIdentity(caller.identity, () =>
      runWithConnectorBinding(binding, () =>
        handler.fetch(caller.request, env, ctx),
      ),
    );
  },
};
