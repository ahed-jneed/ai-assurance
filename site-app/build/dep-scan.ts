// Entries for Vite's dependency scan in development. vinext scans every file
// under app/ ("app/**/*.{tsx,ts,jsx,js}") for dependencies to pre-bundle,
// test files included. Some tests import schemas/validate-criteria.mjs, which
// lies outside this package; the scanner's bundler cannot load it and the
// whole scan failed ("Failed to run dependency scan. Skipping dependency
// pre-bundling"). Vite concatenates these entries with vinext's, and the
// scanner's glob reads a "!" pattern as an exclusion, so tests are dropped.
export const DEP_SCAN_EXCLUDE = ["!**/*.test.{ts,tsx,js,jsx}"];

/** The optimizeDeps entries each Vite environment adds to vinext's. */
export const depScanEnvironments = Object.fromEntries(
  ["rsc", "ssr", "client"].map((name) => [
    name,
    { optimizeDeps: { entries: [...DEP_SCAN_EXCLUDE] } },
  ]),
);
