// Runs `npm run build` and fails when its output reports a warning, so the
// warning-free build cannot regress. CI's Build step and `npm run check` use it.
import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

// vinext's route legend ("? Unknown", "? Some routes could not be classified")
// is informational and matches none of these patterns.
const WARNINGS = [
  /\(!\)/, // Vite, e.g. "(!) Some chunks are larger than 500 kB"
  /\[[A-Z][A-Z0-9_]{2,}\]/, // Rolldown log codes, e.g. [PLUGIN_TIMINGS], [EVAL]
  /\bwarn(?:ing)?s?\b/i, // "Warning:", "[WARNING]", "npm warn", ...
];

const build = spawn("npm run build", {
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
});
// Echo both streams as they arrive; keep them apart so lines stay whole.
const captured = [build.stdout, build.stderr].map((stream, index) => {
  const chunks = [];
  stream.on("data", (chunk) => {
    (index ? process.stderr : process.stdout).write(chunk);
    chunks.push(chunk);
  });
  return chunks;
});
build.on("close", (code, signal) => {
  if (code !== 0) {
    console.error(`\nThe build failed (${code ?? signal}).`);
    process.exit(code || 1);
  }
  const warnings = captured
    .flatMap((chunks) =>
      stripVTControlCharacters(Buffer.concat(chunks).toString("utf8")).split(
        /\r?\n|\r/,
      ),
    )
    .filter((line) => WARNINGS.some((pattern) => pattern.test(line)));
  if (warnings.length) {
    console.error(
      `\nThe build reported ${warnings.length} warning line(s):\n` +
        warnings.map((line) => `  ${line.trim()}`).join("\n"),
    );
    process.exit(1);
  }
  console.log("\nThe build reported no warnings.");
});
