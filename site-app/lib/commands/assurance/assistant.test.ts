import { describe, expect, it } from "vitest";
import type { Paper } from "../../domain";
import { ApiError } from "../../http";
import { engagement, paper } from "../../workflow/test-fixtures";
import { caller } from "../test-fixtures";
import { assistant } from "./assistant";
import type { AssuranceTarget } from "./target";

const refusal =
  "Select a supplementary draft paper; compiled procedure work must be recorded in its source procedure";
/** Stands in for the D1 lookup that follows the target paper's checks. */
const pastChecks = new Error("past the paper checks");

/** Runs acceptAssistant into `target`, with an uncited assistant draft. */
async function accept(target: Paper) {
  const e = engagement({ papers: [target] });
  const scope = {
    e,
    find: async () => ({
      id: "assistant-1",
      kind: "assistant",
      sha256: "a".repeat(64),
      body: { citations: [] },
    }),
    lookup: async () => {
      throw pastChecks;
    },
    accepted: () => {
      throw pastChecks;
    },
  } as unknown as AssuranceTarget;
  try {
    await assistant.run(
      scope,
      "acceptAssistant",
      {
        assistantId: "assistant-1",
        editedText: "Cited draft text",
        paperId: target.id,
      },
      caller("Auditor"),
    );
  } catch (error) {
    return error;
  }
  throw new Error("Expected acceptAssistant to stop");
}

describe("acceptAssistant target paper (#94)", () => {
  it("refuses a limitation memo retired by reopening its request", async () => {
    const memo = paper({
      id: "memo",
      kind: "memo",
      templateId: "MEM-LS-01",
      required: false,
      retired: {
        requestId: "REQ-1",
        actor: "lead",
        at: "2026-11-04T10:00:00.000Z",
        reason: "Request reopened",
      },
    });
    const error = await accept(memo);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: refusal });
    // Nothing was written into the retired memo.
    expect(memo.revision).toBe(1);
    expect(memo.history).toEqual([]);
  });

  it("refuses a superseded paper and a release-time record", async () => {
    for (const target of [
      paper({ supersededBy: "paper-2" }),
      paper({ kind: "memo", templateId: "MEM-SO-01", required: false }),
    ])
      expect(await accept(target)).toMatchObject({
        status: 409,
        message: refusal,
      });
  });

  it("goes on to check the citations for a current supplementary draft", async () => {
    expect(await accept(paper({ required: false }))).toBe(pastChecks);
  });
});
