import { describe, expect, it } from "vitest";
import type { Engagement, EvaluationProfile, Model, Run } from "@/lib/domain";
import type { Workflow } from "@/lib/workflow-types";
import {
  labIntentReducer,
  resolveLabIntent,
  type PendingLabIntent,
} from "./lab-intent";

const evaluate = (
  overrides: Partial<Extract<PendingLabIntent, { kind: "evaluate" }>> = {},
): PendingLabIntent => ({
  kind: "evaluate",
  engagementId: "ENG-A",
  procedureId: "PROC-1",
  datasetCardRecordId: "CARD-1",
  ...overrides,
});

/** The parts of an engagement the lab reads to resolve an intent. */
function engagement(runs: Partial<Run>[] = []): Engagement {
  return {
    id: "ENG-A",
    models: [{ id: "MODEL-1", artifactId: "EV-1" } as Model],
    evaluationProfiles: [{ id: "PROTOCOL-1" } as EvaluationProfile],
    workflow: {
      procedures: [
        {
          id: "PROC-1",
          modelId: "MODEL-1",
          datasetId: "EV-1",
          profileId: "PROTOCOL-1",
        },
        { id: "PROC-2" },
      ],
    } as unknown as Workflow,
    runs: runs as Run[],
  } as Engagement;
}

describe("labIntentReducer", () => {
  it("holds a request until the lab consumes that request", () => {
    const intent = evaluate();
    const pending = labIntentReducer(null, { type: "request", intent });
    expect(pending).toBe(intent);
    expect(labIntentReducer(pending, { type: "consume", intent })).toBeNull();
  });

  it("keeps a newer request when the lab consumes an older one", () => {
    const older = evaluate(),
      newer = evaluate({ procedureId: "PROC-2" });
    expect(labIntentReducer(newer, { type: "consume", intent: older })).toBe(
      newer,
    );
  });

  it("drops a pending request on clear (engagement or practice change)", () => {
    expect(labIntentReducer(evaluate(), { type: "clear" })).toBeNull();
  });
});

describe("resolveLabIntent", () => {
  it("opens the setup for the approved procedure with its handed-over card", () => {
    expect(resolveLabIntent(evaluate(), engagement())).toMatchObject({
      kind: "evaluate",
      procedureId: "PROC-1",
      datasetCardRecordId: "CARD-1",
      model: { id: "MODEL-1" },
      profile: { id: "PROTOCOL-1" },
    });
  });

  it("shows a planned evaluation already queued instead of queueing a duplicate", () => {
    const queued = {
      id: "RUN-1",
      state: "queued",
      procedureBinding: { procedureId: "PROC-1" },
    } as Partial<Run>;
    expect(resolveLabIntent(evaluate(), engagement([queued]))).toEqual({
      kind: "showRun",
      run: queued,
    });
    const done = { ...queued, state: "succeeded" } as Partial<Run>;
    expect(resolveLabIntent(evaluate(), engagement([done])).kind).toBe(
      "evaluate",
    );
  });

  it("shows the run the audit program queued", () => {
    const queued = { id: "RUN-2", state: "queued" } as Partial<Run>;
    expect(
      resolveLabIntent(
        { kind: "showRun", engagementId: "ENG-A", runId: "RUN-2" },
        engagement([queued]),
      ),
    ).toEqual({ kind: "showRun", run: queued });
  });

  it("ignores an intent for another engagement or without runnable pins", () => {
    expect(
      resolveLabIntent(evaluate({ engagementId: "ENG-B" }), engagement()),
    ).toEqual({ kind: "none" });
    expect(
      resolveLabIntent(evaluate({ procedureId: "PROC-2" }), engagement()),
    ).toEqual({ kind: "none" });
    expect(
      resolveLabIntent(
        { kind: "showRun", engagementId: "ENG-A", runId: "gone" },
        engagement(),
      ),
    ).toEqual({ kind: "none" });
  });
});
