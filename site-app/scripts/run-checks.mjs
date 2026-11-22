// Runs every scripts/*-check.mjs harness in sequence and reports a summary.
// Name one or more harnesses to run only those, with or without the
// "-check.mjs" suffix: `npm run check:harnesses -- identity access-lifecycle`.
// The integration harnesses load the Worker bundle, so run `npm run build`
// first (`npm run check` does). Python-backed checks use
// ASSURANCE_TEST_PYTHON when it is set.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
// Moves to the project root, where the harnesses resolve their inputs, and
// picks the short Windows temp directory once for every harness it starts.
import "./harness/env.mjs";

const SUFFIX = "-check.mjs";
const available = readdirSync("scripts")
  .filter((name) => name.endsWith(SUFFIX))
  .sort();

const requested = process.argv
  .slice(2)
  .map((arg) => (arg.endsWith(SUFFIX) ? arg : `${arg}${SUFFIX}`));
const unknown = requested.filter((name) => !available.includes(name));
if (unknown.length) {
  console.error(
    [
      `Unknown harness: ${unknown.map((name) => name.slice(0, -SUFFIX.length)).join(", ")}`,
      "Valid names (the -check.mjs suffix is optional):",
      ...available.map((name) => `  ${name.slice(0, -SUFFIX.length)}`),
    ].join("\n"),
  );
  process.exit(1);
}
// Runs in the usual sorted order, each named harness once.
const harnesses = requested.length
  ? available.filter((name) => requested.includes(name))
  : available;

if (!existsSync("dist/server/index.js")) {
  console.error("dist/server/index.js is missing; run `npm run build` first.");
  process.exit(1);
}

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
