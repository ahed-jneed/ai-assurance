import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ll144RunGates } from "./capture-gates";

const appDir = join(__dirname, "..", "..", "app");
/** The app's source files, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("final capture gates (#202)", () => {
  it("lists one gate per partly approved LL144 run, with the server's message", () => {
    const audit = (status: "draft" | "approved", runId: string) => ({
      status,
      classification: { runId, group: "g", groups: ["g", "h"] },
    });
    const gates = ll144RunGates({
      ll144Audits: [
        audit("approved", "R1"),
        audit("draft", "R1"),
        audit("draft", "R2"),
      ] as never,
    });
    expect(gates).toEqual([
      {
        id: "ll144:R1",
        kind: "ll144",
        recordId: "R1",
        title: "Approve every group of LL144 run R1 (1 of 2 approved)",
        message: expect.stringMatching(
          /^Approve every group of LL144 run R1 before final capture \(1 of 2 approved\)/,
        ),
      },
    ]);
    expect(ll144RunGates({})).toEqual([]);
  });

  it("is the only gate list the UI shows for final capture", () => {
    // The server's createReport refuses on captureGates; a UI list built on
    // finalReportGates alone would leave out the incomplete LL144 runs.
    const files = sources(appDir),
      direct = files.filter((f) =>
        /\bfinalReportGates\b/.test(readFileSync(f, "utf8")),
      ),
      shared = files
        .filter((f) => /\bcaptureGates\(/.test(readFileSync(f, "utf8")))
        .map((f) => relative(appDir, f).replaceAll("\\", "/"))
        .sort();
    expect(direct).toEqual([]);
    expect(shared).toEqual([
      "audit-gates.tsx",
      "report-workspace.tsx",
      "workspace/modals/report.tsx",
      "workspace/model-context-tools.ts",
    ]);
  });
});
