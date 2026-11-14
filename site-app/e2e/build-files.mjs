// Whether dist/server holds a complete build for e2e/server.mjs to serve
// (#199). An interrupted build (on Windows, `EBUSY` while it empties dist/)
// can leave wrangler.json beside missing or stale modules; Miniflare then
// fails late, or the suite runs against half a build. This checks the files
// the Worker actually loads: the build's wrangler.json, its entry module,
// every module the entry reaches through relative static or dynamic imports,
// the static assets directory and the client assets the RSC manifest names.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// A relative module specifier in `from "./x.js"`, `import "./x.js"` or
// `import("./x.js")`, as the build writes them (minified, and dynamic imports
// as template literals without substitutions). On a complete build these
// reach every module in dist/server from the entry.
const relativeImport =
  /(?:\bfrom|\bimport)\s*\(?\s*(["'`])(\.{1,2}\/[^"'`$\n]+?\.m?js)\1/g;
// A client asset path in the RSC assets manifest. Backslashes end the path:
// in `"bootstrapScriptContent":"import(\"/_next/static/x.js\")"` it sits
// between escaped quotes, and the `\` before the closing quote is not part of
// it (on POSIX it would be a literal character of the file name).
const clientAsset = /"(\/_next\/static\/[^"\\\n]+?)\\?"/g;

const isFile = (file) => existsSync(file) && statSync(file).isFile();

/**
 * The problems that make `serverDir` (dist/server) unusable, as short
 * sentences; an empty list when the build is complete.
 */
export function buildProblems(serverDir) {
  const config = path.join(serverDir, "wrangler.json");
  if (!isFile(config)) return ["dist/server/wrangler.json is missing"];
  let wrangler;
  try {
    wrangler = JSON.parse(readFileSync(config, "utf8"));
  } catch {
    return ["dist/server/wrangler.json is not valid JSON"];
  }
  const problems = [],
    assets = wrangler.assets?.directory,
    assetsRoot = assets && path.resolve(serverDir, assets);
  if (assetsRoot && !existsSync(assetsRoot))
    problems.push(
      `the static assets directory ${assets} named by wrangler.json is missing`,
    );
  const main = path.resolve(serverDir, wrangler.main ?? "index.js");
  if (!isFile(main))
    return [`the Worker entry ${relative(serverDir, main)} is missing`];
  // Every module the entry reaches.
  const seen = new Set([main]),
    queue = [main];
  while (queue.length) {
    const file = queue.shift();
    for (const [, , specifier] of readFileSync(file, "utf8").matchAll(
      relativeImport,
    )) {
      const target = path.resolve(path.dirname(file), specifier);
      if (seen.has(target)) continue;
      seen.add(target);
      if (isFile(target)) queue.push(target);
      else
        problems.push(
          `${relative(serverDir, target)}, imported by ${relative(serverDir, file)}, is missing`,
        );
    }
  }
  const manifest = path.join(serverDir, "__vite_rsc_assets_manifest.js");
  if (assetsRoot && existsSync(assetsRoot) && isFile(manifest)) {
    for (const asset of new Set(
      [...readFileSync(manifest, "utf8").matchAll(clientAsset)].map(
        (m) => m[1],
      ),
    ))
      if (!isFile(path.join(assetsRoot, asset)))
        problems.push(`the client asset ${asset} is missing`);
  }
  return problems;
}

const relative = (from, to) => path.relative(from, to).replaceAll("\\", "/");
