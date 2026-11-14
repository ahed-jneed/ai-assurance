// Source guards for the browser's API consumers (#178): the JSON readers and
// commands go through fetchJson, which checks the status before parsing, and
// the browser code asks lib/permissions.ts instead of comparing role names
// itself.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roles } from "@/lib/domain";

const source = (path: string) =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8");

// Every consumer moved to fetchJson. A raw fetch() here would parse a 413 or
// a 502 page as JSON again.
const fetchJsonConsumers = [
  "app/assurance-record-search.tsx",
  "app/access-log.tsx",
  "app/assurance-workbench/workbench.tsx",
  "app/audit-trail.tsx",
  "app/dataset-registry.tsx",
  "app/dossier-controls.tsx",
  "app/evidence-details.tsx",
  "app/genai-evidence.tsx",
  "app/operator/operator-console.tsx",
  "app/package-integrity.tsx",
  "app/power-check.tsx",
  "app/testing-lab/use-lab-setup.ts",
  "app/work-inbox.tsx",
  "app/workspace/views/criteria-coverage.tsx",
  "lib/assurance-query.ts",
  "lib/assurance-store-client.ts",
  "lib/event-log-queries.ts",
];

// Role names belong to lib/permissions.ts. The browser code below asks it
// (can, canSee, decisionState, isClientRole, canBeAssigned, duties) instead
// of comparing role names; the server keeps its own guards.
const roleScan = ["app", "components", "hooks", "lib"];
const serverCode = [
  // Routes and the server-side command, workflow and read-model layers.
  /^app\/api\//,
  /^lib\/commands\//,
  /^lib\/workflow\//,
  /^lib\/read-models\//,
  // The domain types, which define the roles, and the map itself.
  /^lib\/domain\//,
  /^lib\/permissions\.ts$/,
  // Repository, tenancy and request-service modules. The browser never loads
  // engagement-repo.ts, tenancy.ts or test-storage.ts. It does import pure
  // helpers from evidence-requests.ts and client-projection.ts, but their
  // role comparisons sit in server-side functions that take the request
  // context (ctx.role): they guard commands and reads on the server and
  // decide nothing in the browser.
  /^lib\/(client-projection|engagement-repo|evidence-requests|tenancy|test-storage)\.ts$/,
];
// Role pickers and role descriptions: they name each role to offer it, not
// to decide what the person in that role may see or do. The count keeps a
// new comparison from slipping into an allowlisted file.
const rolePickers: Record<string, { literals: number; why: string }> = {
  "app/management-views.tsx": {
    literals: 7,
    why: "role descriptions table and the invite form's default role",
  },
  "app/member-onboarding.tsx": {
    literals: 12,
    why: "role picker, its default and the description of the chosen role",
  },
  "app/client-portal.tsx": {
    literals: 1,
    why: "the grant form's field label",
  },
};

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
    const counts: Record<string, number> = {};
    for (const dir of roleScan)
      for (const file of readdirSync(new URL("../" + dir, import.meta.url), {
        recursive: true,
      }) as string[]) {
        const path = dir + "/" + file.replaceAll("\\", "/");
        if (
          !/\.tsx?$/.test(path) ||
          /\.test\.tsx?$/.test(path) ||
          /test-fixtures\.ts$/.test(path) ||
          serverCode.some((pattern) => pattern.test(path))
        )
          continue;
        const text = source(path),
          found = roles.reduce(
            (n, role) => n + text.split(JSON.stringify(role)).length - 1,
            0,
          );
        if (found) counts[path] = found;
      }
    const expected = Object.fromEntries(
      Object.entries(rolePickers).map(([path, { literals }]) => [
        path,
        literals,
      ]),
    );
    expect(counts).toEqual(expected);
  });
});
