import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

// Node has no Worker runtime, so every test resolves `cloudflare:workers` to
// this stand-in. Its `env` has no bindings: db() and bucket() answer 503 until
// a test assigns a fake, for example `env.DB = fakeD1`.
const workerRuntime: Plugin = {
  name: "cloudflare-workers-stub",
  resolveId: (source) =>
    source === "cloudflare:workers" ? "\0cloudflare:workers" : undefined,
  load: (id) =>
    id === "\0cloudflare:workers" ? "export const env = {};" : undefined,
};

// Unit tests. Kept separate from vite.config.ts so tests do not load the
// Vinext and Cloudflare plugins.
export default defineConfig({
  plugins: [workerRuntime],
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: [
      "lib/**/*.test.ts",
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
      "build/**/*.test.ts",
    ],
    environment: "node",
  },
});
