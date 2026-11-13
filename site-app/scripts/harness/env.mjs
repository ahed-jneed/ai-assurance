// What every check harness assumes about its environment, made explicit so a
// harness runs the same from any working directory and outside CI (F-16).
// Import it first: importing it moves the process to the site-app root, which
// the harnesses' relative paths (dist/server, drizzle, ../engine) start from.
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
