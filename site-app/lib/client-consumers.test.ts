// Source guards for the browser's API consumers (#178): the JSON readers and
// commands go through fetchJson, which checks the status before parsing, and
// the view-visibility and decision callers ask lib/permissions.ts instead of
// comparing role names themselves.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roles } from "@/lib/domain";

const source = (path: string) =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8");

// Every consumer moved to fetchJson. A raw fetch() here would parse a 413 or
// a 502 page as JSON again.
const fetchJsonConsumers = [
  "app/assurance-record-search.tsx",
  "app/assurance-workbench.tsx",
  "app/dataset-registry.tsx",
  "app/dossier-controls.tsx",
  "app/evidence-details.tsx",
  "app/genai-evidence.tsx",
  "app/operator/operator-console.tsx",
  "app/package-integrity.tsx",
  "app/power-check.tsx",
  "app/testing-lab.tsx",
  "app/work-inbox.tsx",
  "app/workspace/views/criteria-coverage.tsx",
  "lib/assurance-query.ts",
  "lib/assurance-store-client.ts",
];

// Files whose role decisions come from canSee, actionState or decisionState.
const roleNeutral = ["app/work-inbox.tsx", "app/workspace/use-url-state.ts"];

describe("browser API consumers", () => {
  it("read and write through fetchJson", () => {
    const raw = fetchJsonConsumers.filter((path) =>
      /(?<![\w.])fetch\(/.test(source(path)),
    );
    expect(raw).toEqual([]);
  });

  it("call no /api/assurance endpoint with a raw fetch anywhere in the browser code", () => {
    const offenders = ["app", "hooks", "lib"].flatMap((dir) =>
      (
        readdirSync(new URL("../" + dir, import.meta.url), {
          recursive: true,
        }) as string[]
      )
        .map((file) => dir + "/" + file.replaceAll("\\", "/"))
        .filter(
          (path) =>
            /\.tsx?$/.test(path) &&
            !/\.test\.tsx?$/.test(path) &&
            !path.startsWith("app/api/") &&
            /(?<![\w.])fetch\(\s*["'`]\/api\/assurance/.test(source(path)),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("leave role names to the permission map", () => {
    const literals = roleNeutral.flatMap((path) =>
      roles
        .filter((role) => source(path).includes(JSON.stringify(role)))
        .map((role) => path + ": " + role),
    );
    expect(literals).toEqual([]);
  });
});
