// The build check e2e/server.mjs runs before it starts the Worker (#199): a
// complete dist/server passes, and each file an interrupted build can leave
// out is named. A Vitest test (Playwright runs only e2e/*.spec.ts).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProblems } from "./build-files.mjs";

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A small build shaped like the real one, written under a fresh directory. */
function build(files: Record<string, string | null> = {}) {
  root = mkdtempSync(path.join(tmpdir(), "e2e-build-"));
  const all: Record<string, string | null> = {
    "server/wrangler.json": JSON.stringify({
      main: "index.js",
      assets: { directory: "../client" },
    }),
    "server/index.js":
      'import{a}from"./_next/static/shared-A1.js";' +
      'import"./__vite_rsc_assets_manifest.js";' +
      "const ssr=()=>import(`./ssr/index.js`);",
    "server/_next/static/shared-A1.js":
      "export const a=1;const page=()=>import('./page-B2.js');",
    "server/_next/static/page-B2.js": "export default 1;",
    "server/ssr/index.js": 'export*from"../_next/static/shared-A1.js";',
    "server/__vite_rsc_assets_manifest.js":
      'export default {"js":["/_next/static/chunks/index-C3.js"]};',
    "client/_next/static/chunks/index-C3.js": "",
    "client/favicon.svg": "<svg/>",
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    if (text === null) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return path.join(root, "server");
}

describe("buildProblems", () => {
  it("passes a complete build", () => {
    expect(buildProblems(build())).toEqual([]);
  });

  it.each([
    [
      "wrangler.json",
      { "server/wrangler.json": null },
      ["dist/server/wrangler.json is missing"],
    ],
    [
      "a readable wrangler.json",
      { "server/wrangler.json": '{"main":' },
      ["dist/server/wrangler.json is not valid JSON"],
    ],
    [
      "the entry module",
      { "server/index.js": null },
      ["the Worker entry index.js is missing"],
    ],
    [
      "a module the entry imports",
      { "server/_next/static/shared-A1.js": null },
      // Named once, for the first module that imports it.
      ["_next/static/shared-A1.js, imported by index.js, is missing"],
    ],
    [
      "a module loaded by a dynamic import in a template literal",
      { "server/ssr/index.js": null },
      ["ssr/index.js, imported by index.js, is missing"],
    ],
    [
      "a module loaded by a dynamic import further down the graph",
      { "server/_next/static/page-B2.js": null },
      [
        "_next/static/page-B2.js, imported by _next/static/shared-A1.js, is missing",
      ],
    ],
    [
      "a client asset the RSC manifest names",
      { "client/_next/static/chunks/index-C3.js": null },
      ["the client asset /_next/static/chunks/index-C3.js is missing"],
    ],
  ])("names a missing %s", (_, files, problems) => {
    expect(buildProblems(build(files))).toEqual(problems);
  });

  it("names a missing static assets directory", () => {
    const server = build();
    rmSync(path.join(root, "client"), { recursive: true });
    expect(buildProblems(server)).toEqual([
      "the static assets directory ../client named by wrangler.json is missing",
    ]);
  });
});
