// Loads app TypeScript modules into the check harnesses without a bundler.
// Each module is transpiled on its own and imported as a data: URL, with its
// relative imports rewritten to the data: URLs of their own transpiled
// sources, so entry points such as the lib/domain.ts barrel load with every
// module behind them. Type-only imports disappear in transpilation; package
// and JSON imports are not resolved.
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const modules = new Map();

/** The data: URL of a TypeScript module (relative to the working directory). */
export async function sourceURL(file) {
  const filename = path.resolve(file);
  if (modules.has(filename)) return modules.get(filename);
  let output = ts.transpileModule(await fs.readFile(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  for (const match of [...output.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)]) {
    const dependency = path.resolve(path.dirname(filename), match[2] + ".ts");
    output = output.replace(
      match[0],
      "from " + JSON.stringify(await sourceURL(dependency)),
    );
  }
  const url =
    "data:text/javascript;base64," +
    Buffer.from(output, "utf8").toString("base64");
  modules.set(filename, url);
  return url;
}
