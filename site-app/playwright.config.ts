import { defineConfig, devices } from "@playwright/test";

// End-to-end suite (e2e/README.md): run `npm run build` first, then
// `npm run test:e2e`. The persona projects (`seed`, `chromium`) run against
// the built Worker in trusted-headers mode on a fresh local database. The
// `auth-pages` project runs against a second server in the default built-in
// account mode, on its own port and its own fresh database (#273).
const port = Number(process.env.E2E_PORT ?? 8790);
const baseURL = `http://127.0.0.1:${port}`;
const authPort = Number(process.env.E2E_AUTH_PORT ?? 8791);
const authBaseURL = `http://127.0.0.1:${authPort}`;
const authSpec = /auth-pages\.spec\.ts$/;
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  // e2e/*.test.ts are Vitest unit tests of the e2e tooling (vitest.config.ts).
  testIgnore: /\.test\.ts$/,
  // The specs share one seeded practice and its engagement versions, so they
  // run one at a time, in file order, for a deterministic result.
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  // No retries, locally or in CI: a flaky spec fails the run and is fixed at
  // its cause (wait for the specific response, never a timer), not hidden.
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
      // Every persona spec, but not the built-in account pages.
      testIgnore: [/\.test\.ts$/, authSpec],
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["seed"],
    },
    {
      name: "auth-pages",
      testMatch: authSpec,
      use: { ...devices["Desktop Chrome"], baseURL: authBaseURL },
    },
  ],
  webServer: [
    {
      command: `node e2e/server.mjs ${port}`,
      url: `${baseURL}/`,
      reuseExistingServer: !ci,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `node e2e/auth-server.mjs ${authPort}`,
      url: `${authBaseURL}/auth/sign-in`,
      reuseExistingServer: !ci,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
