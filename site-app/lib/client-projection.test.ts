import { describe, expect, it } from "vitest";
import { paperAudience, sanitize } from "./client-projection";
import { caller, stored } from "./commands/test-fixtures";
import type { Report } from "./domain";
import { packageStatusLabel } from "./report-presentation";
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

  it("defaults memos to internal and working papers to client", () => {
    expect(paperAudience(paper({ kind: "memo" }))).toBe("internal");
    expect(paperAudience(paper({ kind: "working_paper" }))).toBe("client");
    expect(paperAudience(paper({ kind: "memo", audience: "client" }))).toBe(
      "client",
    );
  });
});
