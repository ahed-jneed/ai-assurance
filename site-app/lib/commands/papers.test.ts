import { describe, expect, it } from "vitest";
import { ApiError } from "../http";
import { papers } from "./papers";
import { caller, stored } from "./test-fixtures";

async function status(run: () => unknown) {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return [error.status, error.message];
    throw error;
  }
  return [200, ""];
}

describe("release-time records in the paper commands", () => {
  it("refuses to create, prepare, review, sign or reopen WP-RP-02 and MEM-SO-01", async () => {
    const e = stored(),
      ctx = caller();
    for (const templateId of ["WP-RP-02", "MEM-SO-01"]) {
      const [code, message] = await status(() =>
        papers.run(e, "createPaper", { templateId }, ctx),
      );
      expect(code).toBe(409);
      expect(message).toContain(templateId + " is recorded at release");
    }
    const record = e.papers.find((p) => p.templateId === "WP-RP-02")!;
    for (const op of [
      "submitPaper",
      "reviewPaper",
      "signPaper",
      "reopenPaper",
    ]) {
      const [code, message] = await status(() =>
        papers.run(e, op, { paperId: record.id }, ctx),
      );
      expect([op, code]).toEqual([op, 409]);
      expect(message).toContain("is recorded at release");
    }
    const [code] = await status(() =>
      papers.run(
        e,
        "editPaper",
        {
          paperId: record.id,
          body: { ...record.body, conclusionStatus: "supported" },
          evidenceIds: [],
          required: true,
        },
        ctx,
      ),
    );
    expect(code).toBe(409);
    expect(record.revision).toBe(1);
    expect(record.status).toBe("draft");
  });

  it("still runs the commands for other papers", async () => {
    const e = stored(),
      ctx = caller();
    await papers.run(e, "createPaper", { templateId: "WP-A10-01" }, ctx);
    const paper = e.papers.at(-1)!;
    const [code, message] = await status(() =>
      papers.run(e, "submitPaper", { paperId: paper.id }, ctx),
    );
    expect(code).toBe(400);
    expect(message).toContain("Record results");
  });
});
