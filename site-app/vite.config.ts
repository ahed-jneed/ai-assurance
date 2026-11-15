import vinext from "vinext";
import { defineConfig } from "vite";
import { depScanEnvironments } from "./build/dep-scan";
import { devSignIn } from "./build/dev-sign-in";
import { ssrErrorLog } from "./build/ssr-error-log";

// Local D1 and R2 bindings (cloudflare-env.d.ts). The database ID is a local
// placeholder; a deployment supplies its own wrangler configuration.
const localBindingConfig = {
  main: "./build/worker.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
    {
      binding: "DB",
      database_name: "assurance-d1",
      database_id: "00000000-0000-4000-8000-000000000000",
    },
  ],
  r2_buckets: [{ binding: "BUCKET", bucket_name: "assurance-r2" }],
};

export default defineConfig(async ({ command }) => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  // Identity (docs/security/identity.md). The Worker trusts no identity unless
  // IDENTITY_MODE names one: the development server uses the loopback persona
  // sign-in (build/dev-sign-in.ts), and a build answers 401 until the
  // deployment sets IDENTITY_MODE (cloudflare-access in production).
  const devServer = command === "serve";
  const identityVars: Record<string, string> = devServer
    ? { IDENTITY_MODE: "dev" }
    : {};

  return {
    // vinext scans every app/**/*.{tsx,ts,jsx,js} for dependencies to
    // pre-bundle, tests included. Test fixtures import ../schemas/*.mjs,
    // outside the project root, which the scanner cannot load: the scan then
    // fails, the development server skips pre-bundling and reloads pages under
    // it (#121, #145). Tests are never served, so the development server
    // leaves them out (build/dep-scan.ts); Vite appends vinext's entries.
    ...(command === "serve" ? { environments: depScanEnvironments } : {}),
    build: {
      // Rolldown's [PLUGIN_TIMINGS] notice is informational and depends on host
      // load, so it made `npm run build` output non-deterministic.
      rolldownOptions: { checks: { pluginTimings: false } },
    },
    plugins: [
      vinext(),
      // Development only: SSR errors reach the log instead of a silent 500 (#204).
      ssrErrorLog(),
      devSignIn({ enabled: devServer }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: { ...localBindingConfig, vars: identityVars },
      }),
    ],
  };
});
