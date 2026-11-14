import { describe, expect, it } from "vitest";
import {
  runnerCapabilities,
  runnerCapabilityInfo,
} from "@/lib/runner-capabilities";
import { executionFields } from "./execution-fields";
import {
  adapterFormatLabel,
  attemptsLabel,
  enrolmentFormats,
  predictionOptionLabel,
  telemetryText,
} from "./types";

describe("workbench labels (#202)", () => {
  it("names the adapter formats without spelling acronyms out", () => {
    expect(enrolmentFormats.map(adapterFormatLabel)).toEqual([
      "Provided predictions",
      "ONNX",
      "XGBoost",
      "LightGBM",
      "PMML",
      "GenAI evidence ingest",
      "Client-local worker",
    ]);
    expect(adapterFormatLabel("client_local")).toBe("Client-local worker");
    expect(adapterFormatLabel("genai_ingest")).toBe("GenAI evidence ingest");
    expect(adapterFormatLabel("someFormat")).toBe("Some format");
  });

  it("offers every capability the server accepts, each with help text (#211)", () => {
    // The dialog's list is the server's list (lib/runner-capabilities.ts),
    // which lib/commands/assurance/workers.test.ts enrols one by one.
    expect(enrolmentFormats).toBe(runnerCapabilities);
    for (const f of enrolmentFormats)
      expect(runnerCapabilityInfo[f].help.length, f).toBeGreaterThan(20);
  });

  it("says the runner image digest is lowercase hexadecimal (#211)", () => {
    const digest = executionFields({
      lead: true,
      artifactOptions: () => [],
      models: [],
      profiles: [],
      procedures: [],
      options: () => [],
      members: [],
      workers: [],
      activeJobs: [],
    } as never).enrollWorker.find((f) => f.name === "imageDigest");
    expect(digest?.help).toBe(
      "sha256: followed by the 64-character digest in lowercase hexadecimal (0-9, a-f).",
    );
  });

  it("pluralises the execution telemetry (#211)", () => {
    expect(
      telemetryText({ total: 1, queued: 1, running: 0, stalled: 1 }, 1),
    ).toBe("1 request · 1 queued · 0 running · 1 expired lease");
    expect(
      telemetryText({ total: 1200, queued: 3, running: 2, stalled: 0 }, 50),
    ).toBe(
      "1,200 requests · 3 queued · 2 running · 0 expired leases · listing the 50 most recent",
    );
    expect(
      telemetryText({ total: 2, queued: 0, running: 0, stalled: 2 }, 1),
    ).toBe(
      "2 requests · 0 queued · 0 running · 2 expired leases · listing the most recent",
    );
  });

  it("counts a job's real attempts, not its lease fence (#233)", () => {
    // A job cancelled after one attempt has fence 2 but one attempt.
    expect(attemptsLabel(1)).toBe("1 attempt");
    expect(attemptsLabel(3)).toBe("3 attempts");
    expect(attemptsLabel(0)).toBe("not yet attempted");
    expect(attemptsLabel(undefined)).toBe("not yet attempted");
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
