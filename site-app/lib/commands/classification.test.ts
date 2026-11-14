// The classification commands beyond their role check: approving once
// (#226 item 1).
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../http";
import { classification } from "./classification";
import { caller, fakeD1, stored } from "./test-fixtures";

async function refusal(run: () => unknown) {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return [error.status, error.message];
    throw error;
  }
  return [200, ""];
}

afterEach(() => {
  delete env.DB;
});

describe("approveClassification", () => {
  it("refuses an approved classification with 409 and keeps its approval", async () => {
    const e = stored();
    e.classification = {
      ...e.classification,
      status: "approved",
      approvedBy: "user-reviewer",
      approvedAt: "2026-11-05T00:00:00.000Z",
    };
    const queries: string[] = [];
    env.DB = fakeD1((sql) => {
      queries.push(sql);
      return { actor: "user-classifier" };
    }).db;
    const before = structuredClone(e);
    expect(
      await refusal(() =>
        classification.run(e, "approveClassification", {}, caller("Reviewer")),
      ),
    ).toEqual([409, "This classification is already approved"]);
    expect(e).toEqual(before);
    expect(queries).toEqual([]);
  });

  it("still asks an unapproved classification for an independent reviewer", async () => {
    const e = stored();
    env.DB = fakeD1(() => ({ actor: "user-lead" })).db;
    expect(
      await refusal(() =>
        classification.run(e, "approveClassification", {}, caller("Reviewer")),
      ),
    ).toEqual([
      403,
      "An independent reviewer must approve a completed classification",
    ]);
  });
});
