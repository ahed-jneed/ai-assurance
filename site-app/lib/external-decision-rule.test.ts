import { describe, expect, it } from "vitest";
import { usesModelLabelOutput } from "./external-decision-rule";

describe("usesModelLabelOutput", () => {
  it("is true for ONNX with class-label output", () => {
    expect(usesModelLabelOutput("ONNX", "label")).toBe(true);
  });
  it("is true for ONNX without a frozen prediction kind (engine default)", () => {
    expect(usesModelLabelOutput("ONNX", null)).toBe(true);
  });
  it("is false for ONNX with probability output", () => {
    expect(usesModelLabelOutput("ONNX", "probability")).toBe(false);
  });
  it("is true for PMML whatever prediction kind was queued", () => {
    expect(usesModelLabelOutput("PMML", "probability")).toBe(true);
    expect(usesModelLabelOutput("PMML", "label")).toBe(true);
    expect(usesModelLabelOutput("PMML", null)).toBe(true);
  });
  it("is false for XGBoost and LightGBM, which output probabilities", () => {
    expect(usesModelLabelOutput("XGBoost", "probability")).toBe(false);
    expect(usesModelLabelOutput("XGBoost", "label")).toBe(false);
    expect(usesModelLabelOutput("LightGBM", "label")).toBe(false);
  });
  it("is false when no model format is frozen", () => {
    expect(usesModelLabelOutput(null, null)).toBe(false);
  });
});
