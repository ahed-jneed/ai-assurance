// What every check harness assumes about its environment, made explicit so a
// harness runs the same from any working directory and outside CI (F-16).
// Import it first: importing it moves the process to the site-app root, which
// the harnesses' relative paths (dist/server, drizzle, ../engine) start from,
// and gives the process a short temp directory on Windows (below).
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The site-app directory. */
export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(projectRoot);

/**
 * The Python interpreter for the Python-backed checks: ASSURANCE_TEST_PYTHON,
 * then PYTHON (as scripts/sync-generated.mjs reads it), then the platform's
 * usual name. It needs engine/requirements-dev.txt installed.
 */
export const python =
  process.env.ASSURANCE_TEST_PYTHON ||
  process.env.PYTHON ||
  (process.platform === "win32" ? "python" : "python3");

/**
 * The longest temp directory the harnesses accept on Windows (#204). Miniflare
 * keeps each unpersisted D1 database as an SQLite file about 150 characters
 * below os.tmpdir() (miniflare-<32 hex>\d1\miniflare-D1DatabaseObject\<64
 * hex>.sqlite), and workerd cannot open a path past Windows' 260-character
 * limit: a temp directory of about 110 characters or more fails with
 * SQLITE_CANTOPEN, a longer one with "The Workers runtime failed to start".
 */
export const MAX_TEMP_LENGTH = 100;

/** Whether `directory` can be created and written to. */
function writable(directory) {
  try {
    mkdirSync(directory, { recursive: true });
    rmSync(mkdtempSync(path.join(directory, "probe-")), {
      recursive: true,
      force: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * On Windows, points TEMP and TMP (which os.tmpdir() reads) at a short
 * directory when the inherited one is too long: ASSURANCE_HARNESS_TEMP if set,
 * else %LOCALAPPDATA%\Temp\aa-harness, else %SystemDrive%\aa-harness-tmp.
 * Child processes (Python, nested harnesses) inherit it. Exits with a message
 * naming the fix when no short directory is writable.
 */
function ensureShortTemp() {
  const requested = process.env.ASSURANCE_HARNESS_TEMP;
  if (process.platform !== "win32") return;
  if (!requested && os.tmpdir().length <= MAX_TEMP_LENGTH) return;
  const candidates = requested
    ? [path.resolve(requested)]
    : [
        process.env.LOCALAPPDATA &&
          path.join(process.env.LOCALAPPDATA, "Temp", "aa-harness"),
        path.join(`${process.env.SystemDrive || "C:"}\\`, "aa-harness-tmp"),
      ].filter(Boolean);
  const chosen = candidates.find(
    (directory) => directory.length <= MAX_TEMP_LENGTH && writable(directory),
  );
  if (!chosen) {
    console.error(
      [
        `The check harnesses need a temp directory of at most ${MAX_TEMP_LENGTH} characters on Windows:`,
        `workerd keeps its SQLite files there and fails with SQLITE_CANTOPEN past the path-length limit.`,
        requested
          ? `ASSURANCE_HARNESS_TEMP (${requested}) is too long or not writable.`
          : `TEMP is ${os.tmpdir()} (${os.tmpdir().length} characters), and none of ${candidates.join(", ")} is writable.`,
        `Set ASSURANCE_HARNESS_TEMP to a short writable directory, for example C:\\tmp, and run again.`,
      ].join("\n"),
    );
    process.exit(1);
  }
  if (path.resolve(os.tmpdir()) === chosen) return;
  if (!requested)
    console.log(
      `Temp directory ${os.tmpdir()} is too long for workerd on Windows; the harnesses use ${chosen}.`,
    );
  process.env.TEMP = chosen;
  process.env.TMP = chosen;
}
ensureShortTemp();
