// Why the evaluation setup cannot leave its current step: each step's first
// unmet condition, in the order the wizard checks them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@/lib/domain";
import type { Plan } from "@/lib/statistics";
import { emptyDraft, type Draft, type Inspection } from "./drafts";
import { stepError, type StepState } from "./step-error";

const shortfalls = vi.hoisted(() => ({ count: 0 }));
// The power check is computed elsewhere (power-check.test); here only
// whether it reports a shortfall matters.
vi.mock("../power-check", () => ({
  powerShortfalls: () => Array.from({ length: shortfalls.count }, () => ({})),
}));

const model = (over: Partial<Model> = {}) =>
  ({
    id: "model-1",
    name: "Credit scorer",
    version: "3.2",
    task: "Binary classification",
    format: "Prediction file",
    status: "registered",
    ...over,
  }) as Model;

const inspection = (
  columns: Partial<Inspection["columns"][number]>[] = [
    { name: "actual" },
    { name: "predicted" },
    { name: "group" },
  ],
): Inspection => ({
  artifactId: "artifact-1",
  sha256: "a".repeat(64),
  rowCount: 100,
  columns: columns.map((c) => ({
    name: "",
    type: "numeric",
    missing: 0,
    uniqueCount: 2,
    ...c,
  })),
});

/** A draft complete for every step of a binary classification protocol. */
function readyDraft(over: (d: Draft) => void = () => {}): Draft {
  const d = emptyDraft();
  d.name = "Credit scoring performance";
  d.rationale = "Persona thresholds";
  d.config = {
    ...d.config,
    labelColumn: "actual",
    predictionColumn: "predicted",
    groupColumn: "group",
    positiveLabel: "1",
    negativeLabel: "0",
  };
  d.datasetContext = {
    ...d.datasetContext,
    population: "Synthetic applicants",
    predictionProvenance: "Saved predictions",
    independence: "Synthetic example",
    sensitiveDataBasis: "Synthetic groups",
  };
  over(d);
  return d;
}

const plan = { criteria: [] } as unknown as Plan;
function state(over: Partial<StepState> = {}): StepState {
  return {
    step: 0,
    model: model(),
    draft: readyDraft(),
    inspect: inspection(),
    fair: false,
    locked: false,
    planned: { plan, error: "" },
    saveOnly: false,
    special: false,
    hostedRoute: false,
    acknowledged: false,
    ...over,
  };
}

beforeEach(() => {
  shortfalls.count = 0;
});

describe("step 0: the model", () => {
  it("needs a registered saved-prediction model", () => {
    expect(stepError(state({ model: undefined }))).toBe(
      "Choose a registered saved-prediction model.",
    );
  });
  it("names what a model that is not ready lacks", () => {
    expect(stepError(state({ model: model({ format: "ONNX" }) }))).toBe(
      "External adapter required",
    );
    expect(stepError(state({ model: model({ task: "Classical NLP" }) }))).toBe(
      "Define a classification task to evaluate predictions",
    );
  });
  it("needs the protocol and model tasks to match", () => {
    expect(stepError(state({ model: model({ task: "Regression" }) }))).toBe(
      "Protocol and model tasks must match.",
    );
  });
  it("passes a ready model of the protocol's task", () => {
    expect(stepError(state())).toBe("");
  });
});

describe("step 1: the dataset", () => {
  const step1 = (over: Partial<StepState> = {}) =>
    stepError(state({ step: 1, ...over }));
  it("needs an inspected dataset", () => {
    expect(step1({ inspect: null })).toBe(
      "Inspect the dataset before continuing.",
    );
  });
  it("needs each required column mapped to a present column", () => {
    expect(step1({ inspect: inspection([{ name: "actual" }]) })).toBe(
      "Map each required column.",
    );
    // The group column is required only for a fairness suite.
    expect(
      step1({
        inspect: inspection([{ name: "actual" }, { name: "predicted" }]),
      }),
    ).toBe("");
    expect(
      step1({
        fair: true,
        inspect: inspection([{ name: "actual" }, { name: "predicted" }]),
      }),
    ).toBe("Map each required column.");
  });
  it("needs distinct target, prediction and group columns", () => {
    expect(
      step1({
        draft: readyDraft((d) => (d.config.predictionColumn = "actual")),
      }),
    ).toBe("Target, prediction and group must use different columns.");
  });
  it("refuses mapped columns with missing values", () => {
    expect(
      step1({
        inspect: inspection([
          { name: "actual" },
          { name: "predicted", missing: 3 },
        ]),
      }),
    ).toBe(
      "Mapped columns contain missing values. Correct and register a new prediction artifact.",
    );
  });
  it("needs numeric target and prediction for regression", () => {
    const regression = readyDraft((d) => (d.task = "Regression"));
    expect(
      step1({
        model: model({ task: "Regression" }),
        draft: regression,
        inspect: inspection([
          { name: "actual" },
          { name: "predicted", type: "categorical" },
        ]),
      }),
    ).toBe("Regression requires numeric target and prediction columns.");
  });
  it("needs the dataset context recorded", () => {
    for (const key of [
      "population",
      "predictionProvenance",
      "independence",
    ] as const)
      expect(
        step1({ draft: readyDraft((d) => (d.datasetContext[key] = "  ")) }),
      ).toBe("Record population, prediction provenance and independence.");
  });
  it("needs the favourable and a distinct other class label", () => {
    expect(
      step1({ draft: readyDraft((d) => (d.config.positiveLabel = " ")) }),
    ).toBe("Record the favourable class label.");
    expect(
      step1({ draft: readyDraft((d) => (d.config.negativeLabel = "1")) }),
    ).toBe("Record the other class label, distinct from the favourable label.");
    expect(
      step1({ draft: readyDraft((d) => (d.config.negativeLabel = "")) }),
    ).toBe("Record the other class label, distinct from the favourable label.");
  });
  it("takes a reused protocol's frozen other class label as it is", () => {
    expect(
      step1({
        locked: true,
        draft: readyDraft((d) => (d.config.negativeLabel = "")),
      }),
    ).toBe("");
  });
  it("passes a complete mapping", () => {
    expect(step1({ fair: true })).toBe("");
  });
});

describe("step 2: the procedures and criteria", () => {
  const step2 = (over: Partial<StepState> = {}) =>
    stepError(state({ step: 2, ...over }));
  it("needs distinct, present and complete fairness columns", () => {
    expect(
      step2({
        fair: true,
        draft: readyDraft((d) => (d.config.groupColumn = "actual")),
      }),
    ).toBe("Target, prediction and protected-group columns must be distinct.");
    expect(
      step2({
        fair: true,
        inspect: inspection([
          { name: "actual" },
          { name: "predicted" },
          { name: "group", missing: 1 },
        ]),
      }),
    ).toBe("Fairness mappings need present, nonmissing columns.");
    expect(step2({ fair: true, inspect: null })).toBe(
      "Fairness mappings need present, nonmissing columns.",
    );
  });
  it("needs at least one procedure", () => {
    expect(step2({ draft: readyDraft((d) => (d.suite = [])) })).toBe(
      "Choose at least one available procedure.",
    );
  });
  it("needs the protocol name, version and rationale", () => {
    for (const key of ["name", "version", "rationale"] as const)
      expect(step2({ draft: readyDraft((d) => (d[key] = " ")) })).toBe(
        "Name the protocol, version and rationale for its criteria.",
      );
  });
  it("needs the handling basis for a fairness suite", () => {
    expect(
      step2({
        fair: true,
        draft: readyDraft((d) => (d.datasetContext.sensitiveDataBasis = "")),
      }),
    ).toBe("Fairness requires a protected-group column and handling basis.");
  });
  it("reports an invalid plan unless the protocol is reused", () => {
    const planned = { plan: null, error: "Confidence level is invalid." };
    expect(step2({ planned })).toBe("Confidence level is invalid.");
    expect(step2({ planned, locked: true })).toBe("");
  });
  it("needs a rationale for a coverage below 100%", () => {
    const partial = readyDraft((d) => {
      d.plan.minimumCoverage = 0.9;
      d.plan.coverageRationale = "";
    });
    expect(step2({ draft: partial })).toBe(
      "Record why a coverage below 100% is acceptable.",
    );
    expect(step2({ draft: partial, locked: true })).toBe("");
  });
  it("keeps special-category fairness client-side unless chosen otherwise", () => {
    const refusal =
      "Special-category fairness tests run client-side by default: save the protocol only and queue it for the external worker or the runtime package, or choose the hosted route with the client's recorded basis.";
    expect(step2({ special: true })).toBe(refusal);
    expect(step2({ special: true, saveOnly: true })).toBe("");
    expect(step2({ special: true, hostedRoute: true })).toBe("");
  });
  it("passes a complete protocol", () => {
    expect(step2({ fair: true })).toBe("");
  });
});

describe("step 3: the review", () => {
  const step3 = (over: Partial<StepState> = {}) =>
    stepError(state({ step: 3, ...over }));
  it("needs a power shortfall acknowledged", () => {
    shortfalls.count = 1;
    expect(step3()).toBe(
      "Acknowledge the power shortfall before saving the protocol.",
    );
    expect(
      step3({
        draft: readyDraft((d) => (d.plan.acknowledgement = "Accepted.")),
      }),
    ).toBe("");
    // A reused protocol's plan was acknowledged when it was saved.
    expect(step3({ locked: true })).toBe("");
    expect(step3({ planned: { plan: null, error: "Invalid" } })).toBe("");
  });
  it("needs special-category processing on the platform acknowledged", () => {
    expect(step3({ special: true })).toBe(
      "Acknowledge that this run processes special-category data on the platform.",
    );
    expect(step3({ special: true, acknowledged: true })).toBe("");
    expect(step3({ special: true, saveOnly: true })).toBe("");
  });
  it("passes without a shortfall or special-category data", () => {
    expect(step3()).toBe("");
  });
});
