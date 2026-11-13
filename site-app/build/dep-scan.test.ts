// The development dependency scan (#145): vinext's entries plus ours, globbed
// the way Vite globs them (tinyglobby, from the package root), reach no test
// file and no file that imports schemas/validate-criteria.mjs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { glob } from "tinyglobby";
import { describe, expect, it } from "vitest";
import { DEP_SCAN_EXCLUDE, depScanEnvironments } from "./dep-scan";

const root = fileURLToPath(new URL("..", import.meta.url));
// vinext's App Router entry (vinext/dist/index.js, optimizeEntries).
const VINEXT_ENTRIES = ["app/**/*.{tsx,ts,jsx,js}"];
const scan = (patterns: string[]) =>
  glob(patterns, {
    cwd: root,
    ignore: ["**/dist/**", "**/node_modules/**"],
  });

describe("the dependency-scan entries", () => {
  it("add the exclusion to every environment vinext scans", () => {
    for (const name of ["rsc", "ssr", "client"])
      expect(depScanEnvironments[name].optimizeDeps.entries).toEqual(
        DEP_SCAN_EXCLUDE,
      );
  });

  it("leave out test files and keep the app's own files", async () => {
    const without = await scan(VINEXT_ENTRIES),
      withExclusion = await scan([...VINEXT_ENTRIES, ...DEP_SCAN_EXCLUDE]);
    // The failure this fixes: a test under app/ reaches the validator.
    expect(without).toContain("app/report/report-render.test.tsx");
    expect(withExclusion.some((f) => /\.test\.[jt]sx?$/.test(f))).toBe(false);
    expect(withExclusion).toContain("app/genai-evidence.tsx");
    expect(withExclusion.length).toBe(
      without.filter((f) => !/\.test\.[jt]sx?$/.test(f)).length,
    );
  });

  it("reach no file that imports the criteria validator directly", async () => {
    for (const file of await scan([...VINEXT_ENTRIES, ...DEP_SCAN_EXCLUDE]))
      expect(
        readFileSync(root + file, "utf8").includes('validate-criteria.mjs"'),
        file,
      ).toBe(false);
  });
});
