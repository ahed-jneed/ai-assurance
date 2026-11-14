import { describe, expect, it } from "vitest";
import type { AssuranceRecord } from "@/lib/assurance-core";
import { submitValues, type FormState } from "./submit-values";
import { emptyFeature, emptyRelation } from "./types";

const state = (over: Partial<FormState> = {}): FormState => ({
  fields: [
    { name: "name", label: "Name", required: true },
    { name: "note", label: "Note" },
  ],
  known: new Map(),
  sourceIds: [],
  features: [emptyFeature()],
  relations: [],
  exclusions: [],
  affectedIds: [],
  preset: {},
  revision: null,
  ...over,
});
const formData = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe("workbench form values", () => {
  it("drops empty optional fields and keeps empty required ones", () => {
    expect(
      submitValues(
        "importPacket",
        formData([
          ["name", ""],
          ["note", ""],
        ]),
        state(),
      ),
    ).toEqual({ values: { name: "" } });
  });

  it("builds the outputs and feature contract of a system revision", () => {
    const result = submitValues(
      "registerSystem",
      formData([
        ["name", "Scorer"],
        ["modelId", "m1"],
        ["semantics", "Default risk"],
        ["classOrder", " good, bad ,"],
        ["threshold", "0.5"],
        ["pipelineArtifactId", ""],
        ["deploymentArtifactId", ""],
      ]),
      state(),
    );
    expect(result).toEqual({
      values: {
        name: "Scorer",
        pipelineArtifactId: undefined,
        deploymentArtifactId: undefined,
        modelIds: ["m1"],
        features: [emptyFeature()],
        outputs: {
          semantics: "Default risk",
          classOrder: ["good", "bad"],
          threshold: 0.5,
        },
      },
    });
  });

  it("refuses an assertion with an unchosen source relationship", () => {
    expect(
      submitValues(
        "addAssertion",
        formData([["statement", "Claim"]]),
        state({ relations: [emptyRelation()] }),
      ),
    ).toEqual({
      error:
        "Choose the precise source of each source relationship, or remove it.",
    });
  });

  it("collects the adapter formats and names the revised record", () => {
    expect(
      submitValues(
        "enrollWorker",
        formData([
          ["name", "Runner"],
          ["formats", "ONNX"],
          ["formats", "PMML"],
        ]),
        state({ revision: { id: "r1" } as AssuranceRecord }),
      ),
    ).toEqual({
      values: { name: "Runner", formats: ["ONNX", "PMML"], supersedesId: "r1" },
    });
  });
});
