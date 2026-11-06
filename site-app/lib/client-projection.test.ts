import { describe, expect, it } from "vitest";
import { sanitize } from "./client-projection";
import { caller, stored } from "./commands/test-fixtures";
import type { Report } from "./domain";

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
  it("names the earlier reports a released report replaced", () => {
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
        id: "REPORT-3",
        kind: "final",
        createdAt: at,
        actor: "",
        sha256: "REPORT-3-client",
        snapshot: { opinion: "Adverse conclusion" },
        replaces: ["REPORT-1", "REPORT-2"],
      },
    ]);
  });

  it("names no replaced report for a first release", () => {
    const e = stored();
    e.reports = [
      report("REPORT-1", { state: "released", releasedAt: at, history: [] }),
    ];
    const [only] = sanitize(e, caller("Client Viewer", false)).reports;
    expect(only.replaces).toEqual([]);
    expect(only.release).toBeUndefined();
  });
});
