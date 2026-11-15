// The staff print view of a withdrawn report (#241): it says the report is
// withdrawn, and describes a withdrawn successor as the client projection
// does ("since withdrawn").
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Report } from "@/lib/domain/types";
import { reportMarkup, type ReportSnapshot } from "./report-markup";

const snapshot = {
  engagement: { id: "ENG-1", title: "Credit scoring audit" },
  opinion: "Unmodified",
  summary: "Final",
  limitations: "",
  papers: [],
  findings: [],
  evidence: [],
} as unknown as ReportSnapshot;

const report = (
  id: string,
  state: string,
  extra: Record<string, unknown> = {},
  history: Record<string, unknown>[] = [],
) =>
  ({
    id,
    kind: "final",
    createdAt: "2026-11-01T09:00:00.000Z",
    actor: "user-lead",
    release: { state, history, ...extra },
  }) as unknown as Report;

const withdraw = {
  action: "withdraw",
  actor: "user-lead",
  at: "2026-11-04T09:00:00.000Z",
  reason: "Restated after a data error",
};

const printed = (r: Report, reports: Report[]) =>
  renderToStaticMarkup(reportMarkup(r, snapshot, "tenant-1", reports));

describe("the printed results by criterion (#241)", () => {
  const row = {
    criterion: "EU AI Act (amended) Art. 50",
    procedures: 0,
    supported: 0,
    exceptions: 0,
    notEvaluated: 0,
    openFindings: 0,
    openHighFindings: 0,
    withheldHighFindings: 1,
    result: "exceptions" as const,
  };
  const cells = (criteria: unknown[]) => {
    const html = renderToStaticMarkup(
      reportMarkup(report("R-1", "released"), {
        ...snapshot,
        contractVersion: "2.0",
        terms: {
          engagementType: "attestation",
          assuranceLevel: "limited",
          conclusion: "unmodified",
        },
        conclusionStatement: { heading: "", text: "", levelStatement: "" },
        elements: [],
        criteria,
      } as unknown as ReportSnapshot),
    );
    const body = html.slice(html.indexOf("Results by criterion"));
    return [...body.matchAll(/<td>(.*?)<\/td>/g)].map((m) =>
      m[1].replace(/<!-- -->/g, "").replace(/<[^>]+>/g, ""),
    );
  };

  it("says the count of an internal-only High finding is withheld, never 0", () => {
    const [, procedures, exceptions, open, result] = cells([row]);
    expect(procedures).toBe("0");
    expect(exceptions).toBe("None evaluated");
    expect(open).toMatch(/^Withheld A High or Critical finding for internal/);
    expect(result).toBe("Exceptions noted");
  });

  it("shows listed findings beside a withheld one, and plain counts otherwise", () => {
    expect(
      cells([{ ...row, procedures: 1, openFindings: 1, exceptions: 0 }])[3],
    ).toMatch(/^1 and withheld /);
    expect(
      cells([
        {
          ...row,
          procedures: 2,
          exceptions: 1,
          openFindings: 2,
          openHighFindings: 1,
          withheldHighFindings: 0,
        },
      ]).slice(1, 4),
    ).toEqual(["2", "1", "2 (1 High or Critical)"]);
  });
});

describe("the printed report's release status", () => {
  it("says a withdrawn report is withdrawn, with when and why", () => {
    const r = report("R-1", "withdrawn", {}, [withdraw]);
    const html = printed(r, [r]);
    expect(html).toContain("CONTROLLED FINAL REPORT · WITHDRAWN");
    expect(html).toContain('class="report-withdrawn" role="note"');
    expect(html).toContain("<strong>Withdrawn.</strong>");
    expect(html).toContain("is no longer issued to the client.");
    expect(html).toContain("04/11/2026");
    expect(html).toContain("Reason: Restated after a data error");
  });

  it("describes a withdrawn successor as since withdrawn", () => {
    const r1 = report("R-1", "withdrawn", { supersededBy: "R-2" }, [withdraw]),
      r2 = report("R-2", "withdrawn", { supersedes: "R-1" }, [withdraw]);
    const html = printed(r1, [r1, r2]);
    expect(html).toContain("Superseded by R-2, since withdrawn.");
  });

  it("names a live successor plainly and shows no withdrawal on a superseded report", () => {
    const r1 = report("R-1", "superseded", { supersededBy: "R-2" }),
      r2 = report("R-2", "released", { supersedes: "R-1" });
    const html = printed(r1, [r1, r2]);
    expect(html).toContain("Superseded by R-2. This report");
    expect(html).not.toContain("since withdrawn");
    expect(html).not.toContain("WITHDRAWN");
    expect(html).not.toContain("report-withdrawn");
  });
});
