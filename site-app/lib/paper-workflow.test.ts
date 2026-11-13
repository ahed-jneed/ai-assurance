import { describe, expect, it } from "vitest";
import { paperHistoryNotice, paperNextAction } from "./paper-workflow";
import { paper } from "./workflow/test-fixtures";

const draft = paper({
  body: {
    objective: "o",
    scope: "s",
    criteria: "c",
    procedures: "p",
    sampling: "",
    results: "r",
    limitations: "",
    conclusion: "Supported",
    conclusionStatus: "supported",
  },
});
const superseded = paper({
  status: "signed",
  supersededBy: "paper-2",
  supersededAt: "2026-11-03T10:00:00.000Z",
});
const retired = paper({
  kind: "memo",
  templateId: "MEM-LS-01",
  retired: {
    requestId: "REQ-1",
    actor: "lead",
    at: "2026-11-04T10:00:00.000Z",
    reason: "The client sent a new extract",
  },
});
const releaseTime = paper({ kind: "memo", templateId: "MEM-SO-01" });

describe("the paper editor's history notice (#94)", () => {
  it("names the paper that superseded a paper", () => {
    expect(paperHistoryNotice(superseded)).toMatchObject({
      kind: "superseded",
      title: "Superseded paper",
    });
    expect(paperHistoryNotice(superseded)!.text).toContain(
      "Superseded by paper-2 on 2026-11-03",
    );
  });

  it("names the reopened request that retired a memo", () => {
    expect(paperHistoryNotice(retired)).toMatchObject({
      kind: "retired",
      title: "Retired memo",
    });
    expect(paperHistoryNotice(retired)!.text).toContain(
      "Retired on 2026-11-04: its evidence request REQ-1 was reopened (The client sent a new extract)",
    );
  });

  it("explains that the release records WP-RP-02 and MEM-SO-01", () => {
    for (const templateId of ["WP-RP-02", "MEM-SO-01"])
      expect(paperHistoryNotice(paper({ templateId }))).toMatchObject({
        kind: "release_time",
        title: "Recorded at release",
      });
  });

  it("shows no notice on a paper that can still change", () => {
    expect(paperHistoryNotice(draft)).toBeNull();
    expect(paperHistoryNotice(paper({ status: "signed" }))).toBeNull();
  });

  it("offers no command on these papers, which the server refuses", () => {
    for (const p of [superseded, retired, releaseTime])
      for (const role of ["Lead Auditor", "Auditor", "Reviewer"] as const) {
        const action = paperNextAction({
          paper: p,
          artifacts: [],
          role,
          userId: "lead",
          dirty: true,
        });
        expect(action.op).toBeNull();
        expect(action.enabled).toBe(false);
        expect(action.reason).toBe(paperHistoryNotice(p)!.text);
      }
    // A signed current paper can still be reopened by the Lead.
    expect(
      paperNextAction({
        paper: paper({ status: "signed" }),
        artifacts: [],
        role: "Lead Auditor",
        userId: "lead",
      }).op,
    ).toBe("reopenPaper");
  });
});
