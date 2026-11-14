import { describe, expect, it } from "vitest";
import { ApiError } from "../http";
import { papers } from "./papers";
import { paper } from "../workflow/test-fixtures";
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

describe("signPaper on a signed paper (#201)", () => {
  const signed = () =>
    paper({
      id: "WP-S",
      status: "signed",
      authorId: "user-auditor",
      reviews: [{ userId: "user-reviewer", revision: 1, at: "2026-11-05" }],
      signatures: [
        { userId: "user-lead", revision: 1, at: "2026-11-05", hash: "h" },
      ],
    });

  it("says the paper is already signed and changes nothing", async () => {
    const e = stored();
    e.papers = [signed()];
    const before = structuredClone(e);
    expect(
      await status(() =>
        papers.run(e, "signPaper", { paperId: "WP-S" }, caller()),
      ),
    ).toEqual([409, "This paper is already signed"]);
    expect(e).toEqual(before);
  });

  it("still asks for independent review of an unreviewed paper", async () => {
    const e = stored();
    e.papers = [
      { ...signed(), status: "in_review", reviews: [], signatures: [] },
    ];
    expect(
      await status(() =>
        papers.run(e, "signPaper", { paperId: "WP-S" }, caller()),
      ),
    ).toEqual([400, "Independent review of the current revision is required"]);
  });
});
