// Seeds the demo practice (scripts/seed-demo.mjs) into the fresh database of
// the suite's Worker before any spec runs, and checks that seeding is
// idempotent.
import { execFileSync } from "node:child_process";
import { test as setup, expect } from "@playwright/test";

const seed = (baseURL: string) =>
  execFileSync(
    process.execPath,
    ["scripts/seed-demo.mjs", "--trusted-headers", baseURL],
    { encoding: "utf8" },
  );

setup("seed the demo practice", async ({ baseURL }) => {
  const first = seed(baseURL!);
  expect(first).toMatch(/Practice tenant-\w+, client Acme/);
  expect(seed(baseURL!)).toContain("The demo practice was already seeded.");
});
