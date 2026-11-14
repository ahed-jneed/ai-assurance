import { describe, expect, it } from "vitest";
import {
  paperAudience,
  sanitize,
  withdrawnSuccessor,
} from "./client-projection";
import { caller, stored } from "./commands/test-fixtures";
import type { Report } from "./domain/types";
import {
  clientNotices,
  clientStillReads,
  packageGuidance,
  packageStatusLabel,
} from "./report-presentation";
import { isWithdrawable } from "./workflow-state";
import { paper } from "./workflow/test-fixtures";

const at = "2026-11-05T10:00:00.000Z";
function report(id: string, release: Report["release"]): Report {
  return {
    id,
    kind: "final",
    createdAt: at,
    actor: "user-lead",
    sha256: id + "-internal",
    snapshot: { opinion: "Adverse conclusion", internalOnly: true },
    clientSnapshot: { opinion: "Adverse conclusion" },
    clientSha256: id + "-client",
    release,
  };
}

describe("client projection of released reports", () => {
  it("keeps superseded reports readable, labelled with their successor", () => {
    const e = stored();
    e.reports = [
      report("REPORT-1", {
        state: "superseded",
        releasedAt: at,
        supersededBy: "REPORT-3",
        history: [],
      }),
      report("REPORT-2", {
        state: "superseded",
        releasedAt: at,
        supersededBy: "REPORT-3",
        history: [],
      }),
      report("REPORT-3", {
        state: "released",
        releasedAt: at,
        supersedes: "REPORT-2",
        history: [{ actor: "user-lead", at, action: "release", reason: "" }],
      }),
    ];
    const client = sanitize(e, caller("Client Viewer", false));
    expect(client.reports).toEqual([
      {
        id: "REPORT-1",
        kind: "final",
        createdAt: at,
        releasedAt: at,
        actor: "",
        sha256: "REPORT-1-client",
        snapshot: { opinion: "Adverse conclusion" },
        replaces: [],
        supersededBy: "REPORT-3",
      },
      {
        id: "REPORT-2",
        kind: "final",
        createdAt: at,
        releasedAt: at,
        actor: "",
        sha256: "REPORT-2-client",
        snapshot: { opinion: "Adverse conclusion" },
        replaces: [],
        supersededBy: "REPORT-3",
      },
      {
        id: "REPORT-3",
        kind: "final",
        createdAt: at,
        releasedAt: at,
        actor: "",
        sha256: "REPORT-3-client",
        snapshot: { opinion: "Adverse conclusion" },
        replaces: ["REPORT-1", "REPORT-2"],
      },
    ]);
    expect(packageStatusLabel(client.reports[0], true)).toBe(
      "Superseded by REPORT-3",
    );
    expect(packageStatusLabel(client.reports[2], true)).toBe(
      "Released to client",
    );
  });

  it("does not name a successor the client cannot read", () => {
    const e = stored();
    e.reports = [
      report("REPORT-1", {
        state: "superseded",
        releasedAt: at,
        supersededBy: "REPORT-2",
        history: [],
      }),
      report("REPORT-2", {
        state: "withdrawn",
        releasedAt: at,
        supersedes: "REPORT-1",
        history: [],
      }),
    ];
    const client = sanitize(e, caller("Client Viewer", false));
    expect(client.reports.map((r) => [r.id, r.supersededBy])).toEqual([
      ["REPORT-1", withdrawnSuccessor],
    ]);
    expect(JSON.stringify(client.reports)).not.toContain("REPORT-2");
    expect(packageStatusLabel(client.reports[0], true)).toBe(
      "Superseded by a later report, since withdrawn",
    );
  });

  it("tells staff what the client sees once the successor is withdrawn (#226)", () => {
    const e = stored();
    e.reports = [
      report("REPORT-1", {
        state: "superseded",
        releasedAt: at,
        supersededBy: "REPORT-2",
        history: [],
      }),
      report("REPORT-2", {
        state: "withdrawn",
        releasedAt: at,
        supersedes: "REPORT-1",
        history: [],
      }),
    ];
    e.reports[1].createdAt = "2026-11-06T10:00:00.000Z";
    // The client still reads REPORT-1 ...
    const client = sanitize(e, caller("Client Viewer", false));
    expect(client.reports.map((r) => r.id)).toEqual(["REPORT-1"]);
    // ... and the record sheet and the banner say so, not "superseded by a
    // newer released report".
    const notice =
      "Its successor REPORT-2 was withdrawn. The client still reads this report.";
    expect(packageGuidance(e.reports[0], e)).toBe(notice);
    expect(clientStillReads(e.reports)).toEqual({
      report: e.reports[0],
      notice: "REPORT-1: " + notice,
    });
    expect(isWithdrawable(e.reports[0])).toBe(true);
    // While the successor is released, the client reads the successor.
    e.reports[1].release!.state = "released";
    e.reports[1].release!.supersedes = undefined;
    expect(packageGuidance(e.reports[0], e)).toBe(
      "Superseded by a newer released report. It stays readable as it was issued.",
    );
    expect(clientStillReads(e.reports)).toBeUndefined();
  });

  it("never calls the latest released report superseded (#234 item 4)", () => {
    const notify = { actor: "user-lead", at, action: "notify_client" as const };
    const e = stored();
    e.reports = [
      report("REPORT-1", {
        state: "superseded",
        releasedAt: at,
        supersededBy: "REPORT-2",
        recipientScope: "Acme board",
        history: [{ ...notify, reason: "" }],
      }),
      report("REPORT-2", {
        state: "released",
        releasedAt: at,
        supersedes: "REPORT-1",
        recipientScope: "Acme board",
        history: [{ ...notify, reason: "" }],
      }),
    ];
    e.reports[1].createdAt = "2026-11-06T10:00:00.000Z";
    // The latest released report: the staff guidance and the client's
    // notice say it is current, not that a newer report supersedes it.
    expect(packageGuidance(e.reports[1], e)).toBe(
      "Released to the client as its current report. A Lead Auditor can withdraw it.",
    );
    const notices = (reports: Report[]) =>
      clientNotices(reports).map((n) => [n.reportId, n.text]);
    expect(
      notices(sanitize(e, caller("Client Viewer", false)).reports),
    ).toEqual([
      ["REPORT-1", expect.stringContaining("superseded by REPORT-2")],
      [
        "REPORT-2",
        "Report REPORT-2 was released to Acme board; it replaces REPORT-1.",
      ],
    ]);
    // Its successor withdrawn, REPORT-1 is the client's latest released
    // report again: its notice no longer says it has been superseded.
    e.reports[1].release!.state = "withdrawn";
    const client = sanitize(e, caller("Client Viewer", false));
    expect(notices(client.reports)).toEqual([
      [
        "REPORT-1",
        "Report REPORT-1 was released to Acme board. Its successor was withdrawn, so it is the current report again.",
      ],
    ]);
    for (const text of notices(client.reports).map(([, t]) => t))
      expect(text).not.toMatch(/has since been superseded/);
  });

  it("does not call an older report current once a later one is released (#234 review)", () => {
    // R1 released, R2 released (superseding R1), R2 withdrawn, R3 released:
    // R1 keeps supersededBy = R2, but R3 is the client's current report.
    const notice = (day: string) => ({
      actor: "user-lead",
      at: "2026-11-0" + day + "T10:00:00.000Z",
      action: "notify_client" as const,
      reason: "",
    });
    const e = stored();
    e.reports = [
      report("REPORT-1", {
        state: "superseded",
        releasedAt: "2026-11-05T10:00:00.000Z",
        supersededBy: "REPORT-2",
        recipientScope: "Acme board",
        history: [notice("5")],
      }),
      report("REPORT-2", {
        state: "withdrawn",
        releasedAt: "2026-11-06T10:00:00.000Z",
        supersedes: "REPORT-1",
        recipientScope: "Acme board",
        history: [notice("6")],
      }),
      report("REPORT-3", {
        state: "released",
        releasedAt: "2026-11-07T10:00:00.000Z",
        recipientScope: "Acme board",
        history: [notice("7")],
      }),
    ];
    e.reports[1].createdAt = "2026-11-06T10:00:00.000Z";
    e.reports[2].createdAt = "2026-11-07T10:00:00.000Z";
    const notices = (reports: Report[]) =>
      clientNotices(reports).map((n) => [n.reportId, n.text]);
    const client = sanitize(e, caller("Client Viewer", false));
    expect(notices(client.reports)).toEqual([
      ["REPORT-3", "Report REPORT-3 was released to Acme board."],
      [
        "REPORT-1",
        "Report REPORT-1 was released to Acme board. Its successor was withdrawn; the current report is REPORT-3.",
      ],
    ]);
    for (const text of notices(client.reports).map(([, t]) => t))
      expect(text).not.toMatch(/current report again/);
    // The staff guidance on a report still in state "released" whose
    // successor was withdrawn says the same.
    e.reports[0].release!.state = "released";
    expect(packageGuidance(e.reports[0], e)).toBe(
      "Released to the client. Its successor was withdrawn; the current report is REPORT-3.",
    );
    // Without the later release, REPORT-1 is current again.
    e.reports.pop();
    expect(packageGuidance(e.reports[0], e)).toBe(
      "Released to the client. Its successor was withdrawn, so it is the current report again.",
    );
    expect(
      notices(sanitize(e, caller("Client Viewer", false)).reports),
    ).toEqual([
      [
        "REPORT-1",
        "Report REPORT-1 was released to Acme board. Its successor was withdrawn, so it is the current report again.",
      ],
    ]);
  });

  it("keeps the predecessor client-visible after a later release (#226 review)", () => {
    // R1 released, R2 released (superseding R1), R2 withdrawn, R3 released.
    // releaseReport supersedes only reports in state "released", so R1, which
    // is already "superseded", keeps supersededBy = R2 and stays readable: the
    // client holds R1 and R3, R3 names no replaced report, and the notice
    // stays on R1.
    const e = stored();
    e.reports = [
      report("REPORT-1", {
        state: "superseded",
        releasedAt: at,
        supersededBy: "REPORT-2",
        history: [],
      }),
      report("REPORT-2", {
        state: "withdrawn",
        releasedAt: at,
        supersedes: "REPORT-1",
        history: [],
      }),
      report("REPORT-3", { state: "released", releasedAt: at, history: [] }),
    ];
    e.reports[1].createdAt = "2026-11-06T10:00:00.000Z";
    e.reports[2].createdAt = "2026-11-07T10:00:00.000Z";
    const client = sanitize(e, caller("Client Viewer", false));
    expect(
      client.reports.map((r) => [r.id, r.supersededBy, r.replaces]),
    ).toEqual([
      ["REPORT-1", withdrawnSuccessor, []],
      ["REPORT-3", undefined, []],
    ]);
    expect(clientStillReads(e.reports)?.notice).toBe(
      "REPORT-1: Its successor REPORT-2 was withdrawn. The client still reads this report.",
    );
    expect(isWithdrawable(e.reports[0])).toBe(true);
  });

  it("does not name a predecessor withdrawn after it was superseded (#201)", () => {
    const e = stored();
    e.reports = [
      report("REPORT-1", {
        state: "withdrawn",
        releasedAt: at,
        supersededBy: "REPORT-2",
        history: [],
      }),
      report("REPORT-2", {
        state: "released",
        releasedAt: at,
        supersedes: "REPORT-1",
        history: [],
      }),
    ];
    const client = sanitize(e, caller("Client Viewer", false));
    expect(client.reports.map((r) => [r.id, r.replaces])).toEqual([
      ["REPORT-2", []],
    ]);
    expect(JSON.stringify(client.reports)).not.toContain("REPORT-1");
  });

  it("names no replaced report for a first release", () => {
    const e = stored();
    e.reports = [
      report("REPORT-1", { state: "released", releasedAt: at, history: [] }),
    ];
    const [only] = sanitize(e, caller("Client Viewer", false)).reports;
    expect(only.replaces).toEqual([]);
    expect(only.release).toBeUndefined();
    expect(only.supersededBy).toBeUndefined();
  });

  it("shows the client when a release notified it, without the internal note (#94)", () => {
    const e = stored();
    const later = "2026-11-06T09:00:00.000Z";
    e.reports = [
      report("REPORT-1", {
        state: "released",
        releasedAt: later,
        recipientScope: "Authorized members of Fixture Bank AG",
        releasedBy: "user-lead",
        history: [
          { actor: "user-lead", at: later, action: "release", reason: "Go" },
          {
            actor: "user-lead",
            at: later,
            action: "notify_client",
            reason:
              "Released to Authorized members of Fixture Bank AG. Notify the recipients that this report is available.",
          },
        ],
      }),
      // Released before releases recorded a notification.
      report("REPORT-0", { state: "superseded", releasedAt: at, history: [] }),
    ];
    const client = sanitize(e, caller("Client Viewer", false));
    expect(client.reports.map((r) => [r.id, r.notification])).toEqual([
      [
        "REPORT-1",
        { at: later, recipients: "Authorized members of Fixture Bank AG" },
      ],
      ["REPORT-0", undefined],
    ]);
    const json = JSON.stringify(client.reports);
    expect(json).not.toContain("user-lead");
    expect(json).not.toContain("Notify the recipients");
    // The audit team keeps the full record.
    expect(sanitize(e, caller()).reports[0].notification).toBeUndefined();
  });

  it("shows clients no internal, approved or withdrawn package", () => {
    const e = stored();
    e.reports = [
      report("REPORT-1", { state: "internal", history: [] }),
      report("REPORT-2", { state: "approved", history: [] }),
      report("REPORT-3", { state: "withdrawn", releasedAt: at, history: [] }),
      // Superseded without ever being released: not issued to the client.
      report("REPORT-4", { state: "superseded", history: [] }),
    ];
    expect(sanitize(e, caller("Client Viewer", false)).reports).toEqual([]);
  });
});

describe("client projection of the live engagement", () => {
  it("strips internal user ids and classification working notes", () => {
    const e = stored();
    e.classification = {
      ...e.classification,
      approvedBy: "user-reviewer",
      rationale: "Internal reasoning",
      intendedPurpose: "Internal notes",
    };
    const client = sanitize(e, caller("Client Viewer", false));
    expect(client.classification).not.toHaveProperty("approvedBy");
    expect(client.classification).toMatchObject({
      rationale: "",
      intendedPurpose: "",
    });
    expect(client.papers).toEqual([]);
  });

  it("strips user ids and evidence from classification v2 answers and history", () => {
    const e = stored();
    e.classification = {
      ...e.classification,
      model: 2,
      approvedBy: "user-reviewer",
      answers: {
        smeStatus: {
          value: "no",
          evidence: "Internal register extract",
          legalVersion: "32024R1689",
          rulePackVersion: "2026.11.1",
          answeredAt: "2026-11-05T10:00:00.000Z",
          answeredBy: "user-answerer",
        },
      },
      history: [
        {
          action: "approved",
          at: "2026-11-05T10:00:00.000Z",
          by: "user-reviewer",
          label: "Minimal risk",
          legalVersion: "32024R1689",
        },
      ],
    };
    const client = sanitize(e, caller("Client Viewer", false));
    const json = JSON.stringify(client.classification);
    for (const id of ["user-reviewer", "user-answerer"])
      expect(json).not.toContain(id);
    expect(json).not.toContain("Internal register extract");
    expect(client.classification.answers?.smeStatus.value).toBe("no");
    expect(client.classification.history?.[0].label).toBe("Minimal risk");
    // The stored record keeps its actors.
    expect(e.classification.history?.[0].by).toBe("user-reviewer");
  });

  it("defaults memos to internal and working papers to client", () => {
    expect(paperAudience(paper({ kind: "memo" }))).toBe("internal");
    expect(paperAudience(paper({ kind: "working_paper" }))).toBe("client");
    expect(paperAudience(paper({ kind: "memo", audience: "client" }))).toBe(
      "client",
    );
  });
});
