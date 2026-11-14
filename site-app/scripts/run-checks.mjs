// Runs every scripts/*-check.mjs harness in sequence and reports a summary.
// The integration harnesses load the Worker bundle, so run `npm run build`
// first (`npm run check` does). Python-backed checks use
// ASSURANCE_TEST_PYTHON when it is set.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
// Moves to the project root, where the harnesses resolve their inputs, and
// picks the short Windows temp directory once for every harness it starts.
import "./harness/env.mjs";

if (!existsSync("dist/server/index.js")) {
  console.error("dist/server/index.js is missing; run `npm run build` first.");
  process.exit(1);
}

const harnesses = readdirSync("scripts")
  .filter((name) => name.endsWith("-check.mjs"))
  .sort();
const failed = [];
for (const name of harnesses) {
  const started = Date.now();
  console.log(`\n> ${name}`);
  const result = spawnSync(process.execPath, [path.join("scripts", name)], {
    stdio: "inherit",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status === 0) {
    console.log(`ok ${name} (${seconds}s)`);
  } else {
    failed.push(name);
    console.log(
      `FAILED ${name}: exit ${result.status ?? result.signal ?? result.error?.message} (${seconds}s)`,
    );
  }
}

if (failed.length) {
  console.error(
    `\n${failed.length} of ${harnesses.length} harnesses failed: ${failed.join(", ")}`,
  );
  process.exit(1);
}
console.log(`\nAll ${harnesses.length} harnesses passed.`);
