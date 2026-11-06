// schemas/fixtures/hosted-runs.v1.4.json: hosted 1.4 runs made by the real
// queue and evaluation path, with deterministic identifiers and times.
// schemas/validate-run-schema.mjs checks them against the run schema and the
// section 11.6 bindings; this test keeps the committed file equal to what the
// runner produces. It includes an explicit plan whose criterion ids differ
// from the suite names, an exploratory criterion, a legacy 1.0 protocol with
// a derived plan, and multiclass and regression runs.
//
// Regenerate with: UPDATE_HOSTED_FIXTURES=1 npx vitest run lib/hosted-runs-fixture.test.ts
import { env } from "cloudflare:workers";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluate } from "./diagnostics";
import type { Artifact, Engagement, Model, Run } from "./domain";
import {
  executionCSV,
  queueEvaluation,
  registerProfile,
} from "./evaluation-service";

vi.mock("./ids", async (original) => {
  let counter = 0;
  return {
    ...(await original<typeof import("./ids")>()),
    id: (prefix: string) => `${prefix}-FX${String(++counter).padStart(4, "0")}`,
    now: () => "2026-11-06T09:00:00.000Z",
  };
});

const FIXTURE = new URL(
  "../../schemas/fixtures/hosted-runs.v1.4.json",
  import.meta.url,
);
const objects = new Map<string, Uint8Array>();
afterEach(() => {
  delete env.BUCKET;
});

const rows = (lines: [string, string, string, number][]) =>
  lines.flatMap(([a, p, g, n]) => Array<string>(n).fill(`${a},${p},${g}`));
const DATASETS: Record<string, { task: string; csv: string }> = {
  binary: {
    task: "Binary classification",
    csv:
      "actual,predicted,group\n" +
      rows([
        ["1", "1", "A", 90],
        ["0", "1", "A", 10],
        ["1", "0", "A", 10],
        ["0", "0", "A", 90],
        ["1", "1", "B", 85],
        ["0", "1", "B", 12],
        ["1", "0", "B", 15],
        ["0", "0", "B", 88],
      ]).join("\n"),
  },
  multiclass: {
    task: "Multiclass classification",
    csv:
      "actual,predicted\n" +
      ["a", "b", "c"]
        .flatMap((label, i) => [
          ...Array<string>(52).fill(`${label},${label}`),
          ...Array<string>(8).fill(`${label},${["b", "c", "a"][i]}`),
        ])
        .join("\n"),
  },
  regression: {
    task: "Regression",
    csv:
      "actual,predicted\n" +
      Array.from({ length: 60 }, (_, i) => {
        const target = 10 + (i % 12);
        return `${target},${target + ((i % 5) - 2) * 0.25}`;
      }).join("\n"),
  },
};

async function digest(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

async function engagement() {
  const e = {
    id: "ENG-FIXTURE",
    artifacts: [],
    models: [],
    evaluationProfiles: [],
    runs: [],
  } as unknown as Engagement;
  for (const [name, { task, csv }] of Object.entries(DATASETS)) {
    const bytes = new TextEncoder().encode(csv);
    const sha256 = await digest(bytes);
    objects.set(`fixture/${name}.csv`, bytes);
    e.artifacts.push({
      id: `EV-${name.toUpperCase()}`,
      name: `${name}.csv`,
      category: "Dataset",
      status: "accepted",
      key: `fixture/${name}.csv`,
      size: bytes.byteLength,
      sha256,
    } as Artifact);
    e.models.push({
      id: `MODEL-${name.toUpperCase()}`,
      name: `${name} scorer`,
      version: "1",
      format: "Prediction file",
      task,
      intendedPurpose: "Hosted 1.4 contract fixture",
      artifactId: `EV-${name.toUpperCase()}`,
      status: "registered",
      sourceSha256: sha256,
    } as Model);
  }
  env.BUCKET = {
    async get(key: string) {
      const bytes = objects.get(key);
      return bytes
        ? { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }
        : null;
    },
  } as unknown as R2Bucket;
  return e;
}

const context = {
  split: "test" as const,
  population: "Synthetic applicants",
  predictionProvenance: "Exported by the provider",
  independence: "Holdout declared by the provider",
  sensitiveDataBasis: "Synthetic groups; no personal data",
};
const columns = {
  labelColumn: "actual",
  predictionColumn: "predicted",
  groupColumn: "group",
  positiveLabel: "1",
  negativeLabel: "0",
};

async function execute(e: Engagement, run: Run) {
  const { csv } = await executionCSV(e, run);
  const { results, evaluation } = evaluate(run, csv);
  Object.assign(run, {
    state: "succeeded",
    startedAt: "2026-11-06T09:00:00.000Z",
    completedAt: "2026-11-06T09:00:00.000Z",
    results,
    outcome: evaluation.overallOutcome,
    overallOutcome: evaluation.overallOutcome,
    reviewFlags: evaluation.reviewFlags,
    paperIds: [...new Set(results.map((r) => r.article))].map(
      (article) => `PAPER-${run.id}-A${article}`,
    ),
  });
  return run;
}

async function fixtureRuns() {
  const e = await engagement();
  const planned = registerProfile(
    e,
    {
      name: "Planned screen",
      version: "1.0",
      task: "Binary classification",
      config: columns,
      statistics: {
        confidenceLevel: 0.95,
        criteria: [
          {
            id: "accuracy-gate",
            kind: "performance",
            members: [
              { metric: "accuracy", band: { lower: 0.8 } },
              { metric: "recall", band: { lower: 0.7 } },
            ],
          },
          {
            id: "parity-screen",
            kind: "group_comparison",
            metric: "selection_rate_difference",
            libraryEntry: { id: "policy.eu-aia.selection-rate-difference" },
          },
          {
            id: "impact-screen",
            kind: "group_comparison",
            metric: "selection_rate_ratio",
            role: "exploratory",
            libraryEntry: { id: "screen.us.four-fifths" },
          },
        ],
      },
      datasetContext: context,
      rationale: "Pre-registered acceptance rules for the fixture",
    },
    "fixture-auditor",
  );
  const legacy = registerProfile(
    e,
    {
      name: "Legacy acceptance",
      version: "1.0",
      task: "Binary classification",
      suite: ["performance", "equalized_odds"],
      config: {
        labelColumn: "actual",
        predictionColumn: "predicted",
        groupColumn: "group",
        positiveLabel: "1",
        minimumGroupSize: 20,
        maximumParityGap: 0.1,
        minimumImpactRatio: 0.8,
        minimumAccuracy: 0.8,
      },
      datasetContext: context,
      rationale: "Legacy thresholds; the plan is derived per run",
    },
    "fixture-auditor",
  );
  const multiclass = registerProfile(
    e,
    {
      name: "Multiclass acceptance",
      version: "1.0",
      task: "Multiclass classification",
      config: { labelColumn: "actual", predictionColumn: "predicted" },
      statistics: {
        criteria: [
          {
            id: "performance",
            kind: "multiclass_performance",
            members: [
              { metric: "accuracy", band: { lower: 0.7 } },
              { metric: "balanced_accuracy", band: { lower: 1 / 3 } },
              { metric: "macro_f1", band: { lower: 0.6 } },
            ],
          },
        ],
      },
      datasetContext: { ...context, sensitiveDataBasis: "" },
      rationale: "Pre-registered multiclass criteria",
    },
    "fixture-auditor",
  );
  const regression = registerProfile(
    e,
    {
      name: "Regression acceptance",
      version: "1.0",
      task: "Regression",
      suite: ["regression"],
      config: {
        labelColumn: "actual",
        predictionColumn: "predicted",
        groupColumn: "",
        positiveLabel: "",
        minimumGroupSize: 30,
        maximumParityGap: 0.1,
        minimumImpactRatio: 0.8,
        minimumAccuracy: 0.8,
        maximumRmse: 0.5,
      },
      datasetContext: { ...context, sensitiveDataBasis: "" },
      rationale: "Legacy regression threshold",
    },
    "fixture-auditor",
  );
  const queue = (model: string, profile: string) =>
    queueEvaluation(
      e,
      {
        modelId: model,
        datasetId: model.replace("MODEL", "EV"),
        profileId: profile,
      },
      "fixture-auditor",
    );
  const runs: Run[] = [];
  runs.push(await execute(e, await queue("MODEL-BINARY", planned.id)));
  runs.push(await execute(e, await queue("MODEL-BINARY", legacy.id)));
  runs.push(await execute(e, await queue("MODEL-MULTICLASS", multiclass.id)));
  runs.push(await execute(e, await queue("MODEL-REGRESSION", regression.id)));
  runs.push(structuredClone(await queue("MODEL-BINARY", planned.id)));
  return JSON.parse(JSON.stringify(runs)) as Run[];
}

describe("hosted 1.4 run fixtures", () => {
  it("equal what the queue and evaluation path produce", async () => {
    const runs = await fixtureRuns();
    expect(runs.map((r) => [r.contractVersion, r.state])).toEqual([
      ["1.4", "succeeded"],
      ["1.4", "succeeded"],
      ["1.4", "succeeded"],
      ["1.4", "succeeded"],
      ["1.4", "queued"],
    ]);
    // The explicit plan's criterion ids differ from the suite names.
    expect(runs[0].suite).toEqual([
      "performance",
      "demographic_parity",
      "disparate_impact",
    ]);
    expect(runs[0].results.map((r) => r.testId)).toEqual([
      "accuracy-gate",
      "parity-screen",
      "impact-screen",
    ]);
    const text = JSON.stringify(runs, null, 2) + "\n";
    if (process.env.UPDATE_HOSTED_FIXTURES) writeFileSync(FIXTURE, text);
    expect(existsSync(FIXTURE)).toBe(true);
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(text));
  });
});
