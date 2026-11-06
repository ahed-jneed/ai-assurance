// Whether an external worker run decides by the model's own class-label
// output rather than by the frozen decision threshold. The worker applies
// the threshold to P(favourable label) only when the model returns
// probabilities. ONNX returns class labels unless predictionKind is
// "probability" (the engine's default is "label"), and PMML always does
// (engine/optional_adapters.py: ONNXAdapter and PMMLAdapter call
// note_label_output(); engine/WORKER.md, "Binary decision rule").
export function usesModelLabelOutput(
  modelFormat: string | null,
  predictionKind: string | null,
): boolean {
  return (
    modelFormat === "PMML" ||
    (modelFormat === "ONNX" && predictionKind !== "probability")
  );
}
