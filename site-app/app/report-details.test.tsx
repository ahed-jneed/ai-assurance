// The in-app report sheet's results by criterion (#241): the client's own
// report sheet and the staff Client package preview render the client
// snapshot through FrozenReportDetails, so a row that an internal-only High
// finding opens must read as it does in the /report print view.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Engagement, Report } from "@/lib/domain/types";
import { successorLabel } from "@/lib/workflow-state";
import { FrozenReportDetails } from "./report-details";
import { RecordDetails } from "./record-details";

const row = {
  criterion: "EU AI Act (amended) Art. 50",
  procedures: 0,
  supported: 0,
  exceptions: 0,
  notEvaluated: 0,
  openFindings: 0,
  openHighFindings: 0,
  withheldHighFindings: 1,
  result: "exceptions",
};

const cells = (criteria: unknown[]) => {
  const html = renderToStaticMarkup(
    <FrozenReportDetails
      value={{
        id: "R-1",
        kind: "final",
        createdAt: "2026-11-01T09:00:00.000Z",
        snapshot: {
          engagement: { id: "ENG-1", title: "Credit scoring audit" },
          contractVersion: "2.0",
          reportTitle: "Independent limited assurance report",
          terms: {
            engagementType: "attestation",
            assuranceLevel: "limited",
            conclusion: "unmodified",
          },
          conclusionStatement: {
            heading: "Conclusion",
            text: "Based on the procedures performed…",
          },
          elements: [],
          criteria,
          summary: "Final",
          papers: [],
          findings: [],
          evidence: [],
        },
      }}
    />,
  );
  const body = html.slice(html.indexOf(">Criterion<"));
  return [...body.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) =>
    m[1].replace(/<!-- -->/g, "").replace(/<[^>]+>/g, ""),
  );
};

describe("the in-app results by criterion (#241)", () => {
  it("says an unevaluated criterion was not evaluated and the High finding is withheld", () => {
    const [criterion, procedures, exceptions, result] = cells([row]);
    expect(criterion).toBe(row.criterion);
    expect(procedures).toBe("0");
    expect(exceptions).toBe("None evaluated");
    expect(exceptions).not.toBe("0");
    expect(result).toMatch(
      /^Exceptions Open findings withheld\. A High or Critical finding for internal use decides this result/,
    );
  });

  it("shows plain counts when no finding is withheld", () => {
    const [, procedures, exceptions, result] = cells([
      { ...row, procedures: 2, exceptions: 1, withheldHighFindings: 0 },
    ]);
    expect([procedures, exceptions]).toEqual(["2", "1"]);
    expect(result).not.toContain("withheld");
  });

  it("renders a snapshot captured before withheldHighFindings as before", () => {
    const { withheldHighFindings: _omitted, ...older } = row;
    void _omitted;
    const [, , exceptions, result] = cells([{ ...older, procedures: 1 }]);
    expect(exceptions).toBe("0");
    expect(result).not.toContain("withheld");
  });
});

describe("the in-app successor line (#246)", () => {
  const release = (state: string, extra: Record<string, unknown> = {}) => ({
    state,
    history: [],
    ...extra,
  });
  const r1 = {
      id: "REPORT-1",
      kind: "final",
      createdAt: "2026-11-01T09:00:00.000Z",
      actor: "user-lead",
      release: release("superseded", { supersededBy: "REPORT-2" }),
      snapshot: { engagement: { id: "ENG-1", title: "Credit scoring audit" } },
    },
    successor = (state: string) =>
      ({
        id: "REPORT-2",
        kind: "final",
        createdAt: "2026-11-02T09:00:00.000Z",
        actor: "user-lead",
        release: release(state, { supersedes: "REPORT-1" }),
      }) as unknown as Report;
  const line = (reports: Report[]) =>
    renderToStaticMarkup(
      <FrozenReportDetails value={r1} reports={reports} />,
    ).replace(/<!-- -->/g, "");

  it("says since withdrawn when the successor was withdrawn, as the print view does", () => {
    const reports = [r1 as unknown as Report, successor("withdrawn")];
    expect(line(reports)).toContain(
      "Superseded by REPORT-2, since withdrawn. This report",
    );
    expect(line(reports)).toContain(
      "Superseded by " + successorLabel("REPORT-2", reports) + ".",
    );
  });

  it("names a live successor plainly", () => {
    const html = line([r1 as unknown as Report, successor("released")]);
    expect(html).toContain("Superseded by REPORT-2. This report");
    expect(html).not.toContain("since withdrawn");
  });

  it("passes the engagement's reports through the record sheet", () => {
    const html = renderToStaticMarkup(
      <RecordDetails
        value={r1}
        engagement={
          { reports: [r1, successor("withdrawn")] } as unknown as Engagement
        }
        onPaper={() => {}}
        resolve={(id) => id}
      />,
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("Superseded by REPORT-2, since withdrawn.");
  });
});
