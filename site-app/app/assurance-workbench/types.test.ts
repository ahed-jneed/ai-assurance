import { describe, expect, it } from "vitest";
import {
  adapterFormatLabel,
  enrolmentFormats,
  predictionOptionLabel,
} from "./types";

describe("workbench labels (#202)", () => {
  it("names the adapter formats without spelling acronyms out", () => {
    expect(enrolmentFormats.map(adapterFormatLabel)).toEqual([
      "Provided predictions",
      "ONNX",
      "XGBoost",
      "LightGBM",
      "PMML",
    ]);
    expect(adapterFormatLabel("client_local")).toBe("Client-local worker");
    expect(adapterFormatLabel("genai_ingest")).toBe("GenAI evidence ingest");
  });

  it("labels a prediction lineage by dataset, model version and date, not its id", () => {
    const e = {
      artifacts: [{ id: "EV-1", name: "applicants-2026.csv" }],
      models: [{ id: "M-1", name: "Credit scorer", version: "4.2" }],
    } as never;
    expect(
      predictionOptionLabel(
        {
          createdAt: "2026-11-03T09:00:00.000Z",
          body: {
            datasetId: "EV-1",
            modelId: "M-1",
            producedAt: "2026-10-30T12:00:00.000Z",
          },
        },
        e,
      ),
    ).toBe("applicants-2026.csv · Credit scorer 4.2 · 2026-10-30");
    // A dataset or model no longer in the engagement still reads as a label.
    expect(
      predictionOptionLabel(
        { createdAt: "2026-11-03T09:00:00.000Z", body: {} },
        e,
      ),
    ).toBe("Predictions · 2026-11-03");
  });
});
