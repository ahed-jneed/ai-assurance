import { existsSync, readFileSync } from "node:fs";
import vinext from "vinext";
import { defineConfig } from "vite";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";
import { connectorPreview } from "./build/connector-preview-plugin.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// `.openai/hosting.json` is checkout-local (Git ignores `.openai/`). Clean
// clones and CI fall back to the bindings declared in cloudflare-env.d.ts.
const hostingConfigFile = new URL("./.openai/hosting.json", import.meta.url);
const sitesProject = existsSync(hostingConfigFile);
const { d1, r2 }: { d1?: string; r2?: string } = sitesProject
  ? JSON.parse(readFileSync(hostingConfigFile, "utf8"))
  : { d1: "DB", r2: "BUCKET" };

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "./build/sites-worker.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
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
  // mock, the Sites build (a checkout with .openai/hosting.json) trusts Sites
  // dispatch, and any other build answers 401 until the deployment sets it.
  // The Sites build also compiles `sites` in as the default for an unset
  // IDENTITY_MODE, in case the Sites publisher does not apply the vars of
  // dist/server/wrangler.json. An explicit IDENTITY_MODE still wins. The
  // browser reads the same define only to label the sign-in button.
  const mockAuth = command === "serve" && !managedLinux;
  const sitesBuild = command === "build" && sitesProject;
  const identityVars: Record<string, string> = mockAuth
    ? { IDENTITY_MODE: "dev" }
    : sitesBuild
      ? { IDENTITY_MODE: "sites" }
      : {};

  return {
    define: {
      __SITES_IDENTITY_DEFAULT__: sitesBuild
        ? JSON.stringify("sites")
        : "undefined",
    },
    build: {
      // Rolldown's [PLUGIN_TIMINGS] notice is informational and depends on host
      // load, so it made `npm run build` output non-deterministic.
      rolldownOptions: { checks: { pluginTimings: false } },
    },
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...localBindingConfig,
          vars: identityVars,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./build/connector-preview-worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
