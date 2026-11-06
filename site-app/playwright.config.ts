import { defineConfig, devices } from "@playwright/test";

// Persona end-to-end suite (e2e/README.md). It runs against the built Worker
// in trusted-headers mode on a fresh local database: run `npm run build`
// first, then `npm run test:e2e`.
const port = Number(process.env.E2E_PORT ?? 8790);
const baseURL = `http://127.0.0.1:${port}`;
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  // The specs share one seeded practice and its engagement versions, so they
  // run one at a time, in file order, for a deterministic result.
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results",
  reporter: ci
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-GB",
    timezoneId: "UTC",
  },
  projects: [
    { name: "seed", testMatch: /seed\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["seed"],
    },
  ],
  webServer: {
    command: `node e2e/server.mjs ${port}`,
    url: `${baseURL}/`,
    reuseExistingServer: !ci,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
