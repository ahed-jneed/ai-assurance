// The workspace side of #144: the finding form names the pinned pack's
// clauses as the primary reference, the LL144 panel follows the pack
// feature and shows each group of a per-group run, the summary names the
// group, and a draft's caveat is printed above its conclusion.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CriterionOption } from "@/lib/criteria/types";
import type { Engagement } from "@/lib/domain";
import { draftCaveat } from "@/lib/domain/report-model";
import type { Ll144Audit } from "@/lib/ll144-audit";
import { findingReference } from "@/lib/presentation";
import {
  citesPackClauses,
  NewFindingForm,
  primaryCriteriaFirst,
} from "./finding-forms";
import { Ll144Panel, ll144PanelAccess } from "./ll144-panel";
import { reportMarkup, type ReportSnapshot } from "./report/report-markup";
import { findingModal } from "./workspace/modals/finding";
import type { ModalSubmitContext } from "./workspace/modals/types";
import type { WorkspaceData } from "./workspace-types";

const criteria: CriterionOption[] = [
  {
    reference: "en-18286:5",
    citation: "EN 18286:2026 5",
    title: "Quality management system",
    article: "EN 18286:2026 5",
  },
  {
    reference: "iso-iec-42001:8.4",
    citation: "ISO/IEC 42001:2023 8.4",
    title: "Assessing impacts of AI systems (operation)",
    article: "ISO/IEC 42001:2023 8.4",
  },
  {
    reference: "other:1",
    citation: "Other 1",
    title: "",
  },
] as CriterionOption[];
const iso = { id: "iso-iec-42001", shortTitle: "ISO/IEC 42001:2023" };
const en = { id: "en-18286", shortTitle: "EN 18286:2026" };
const aiAct = { id: "eu-ai-act", shortTitle: "EU AI Act" };

describe("the finding form's primary reference (#144)", () => {
  it("cites the pack's clauses when no primary criteria set is the AI Act", () => {
    expect(citesPackClauses([iso, en], criteria)).toBe(true);
    expect(citesPackClauses([aiAct], criteria)).toBe(false);
    expect(citesPackClauses([iso, aiAct], criteria)).toBe(false);
    expect(citesPackClauses([iso], [])).toBe(false);
    expect(citesPackClauses([], criteria)).toBe(false);
    expect(
      primaryCriteriaFirst(criteria, [iso]).map((c) => c.reference),
    ).toEqual(["iso-iec-42001:8.4", "en-18286:5", "other:1"]);
  });

  it("offers the clauses as the primary reference instead of AI Act articles", () => {
    const html = renderToStaticMarkup(
      <NewFindingForm
        choices={{ likelihood: "3", impact: "3", visibility: "internal" }}
        onChoice={() => {}}
        criteria={criteria}
        primary={[iso, en]}
      />,
    );
    expect(html).toContain("Primary reference");
    expect(html).toContain("A clause of ISO/IEC 42001:2023 or EN 18286:2026");
    expect(html).toContain(
      "Findings on this pack cite its clauses rather than AI Act articles.",
    );
    expect(html).not.toContain("Primary article");
  });

  it("keeps the AI Act article on an AI Act pack", () => {
    const html = renderToStaticMarkup(
      <NewFindingForm
        choices={{ article: "10", likelihood: "3", impact: "3" }}
        onChoice={() => {}}
        criteria={criteria}
        primary={[aiAct]}
      />,
    );
    expect(html).toContain("Primary article");
    expect(html).toContain("Optional; sets the article");
  });

  it("requires a clause, and sends no AI Act article on a clause pack", async () => {
    const data = {
      criteria: {
        frameworks: [
          { ...iso, role: "primary" },
          { ...en, role: "primary" },
        ],
        findingCriteria: criteria,
      },
    } as unknown as WorkspaceData;
    const sent: Record<string, unknown>[] = [];
    const ctx = (choices: Record<string, string>) =>
      ({
        choices,
        data,
        values: { title: "t" },
        act: async (_op: string, d: Record<string, unknown>) => {
          sent.push(d);
        },
      }) as unknown as ModalSubmitContext;
    expect(() => findingModal.validate!(ctx({ article: "10" }))).toThrow(
      "Choose the clause of ISO/IEC 42001:2023 or EN 18286:2026 the finding concerns.",
    );
    // A procedure's finding takes the criteria of its working paper.
    expect(() =>
      findingModal.validate!(ctx({ article: "10", procedureId: "P-1" })),
    ).not.toThrow();
    await findingModal.submit!(
      ctx({ article: "10", criterion: "iso-iec-42001:8.4" }),
    );
    await findingModal.submit!(ctx({ article: "10", procedureId: "P-1" }));
    expect(sent[0]).toMatchObject({
      criteriaRefs: ["iso-iec-42001:8.4"],
      article: "ISO/IEC 42001:2023 8.4",
    });
    expect(sent[1].article).toBeUndefined();
  });

  it("shows an article as an article and a clause as its citation", () => {
    expect(findingReference("10")).toBe("Article 10");
    expect(findingReference("ISO/IEC 42001:2023 8.4")).toBe(
      "ISO/IEC 42001:2023 8.4",
    );
  });
});

const audit = (group: string, i: number): Ll144Audit =>
  ({
    id: "LL144-" + i,
    status: "draft",
    createdAt: "2026-11-03T10:00:00.000Z",
    createdBy: "user-auditor",
    toolName: "Style classifier",
    distributionDate: "2026-01-15",
    auditDate: "2026-11-02",
    mapping: { rate: "selection" },
    classification: {
      runId: "LL144RUN-1",
      group,
      groups: ["Leader", "Builder", "Helper"],
    },
    warnings: [],
    result: { totalIndividuals: 40 },
  }) as unknown as Ll144Audit;

describe("the LL144 panel (#144)", () => {
  it("follows the pack feature, and keeps the audits an engagement holds", () => {
    expect(ll144PanelAccess(true, {})).toEqual({ shown: true, compute: true });
    expect(ll144PanelAccess(false, {})).toEqual({
      shown: false,
      compute: false,
    });
    expect(
      ll144PanelAccess(false, { ll144Audits: [audit("Leader", 1)] }),
    ).toEqual({ shown: true, compute: false });
  });

  it("lists each group of a per-group run", () => {
    const e = {
      id: "E-1",
      artifacts: [],
      ll144Audits: [audit("Leader", 1), audit("Builder", 2)],
    } as unknown as Engagement;
    const html = renderToStaticMarkup(
      <Ll144Panel
        engagement={e}
        tenantId="T-1"
        writer
        reviewer={false}
        userId="user-auditor"
        busy={false}
        act={async () => {}}
        onEditing={() => {}}
      />,
    );
    expect(html).toContain("group Leader (1 of 3)");
    expect(html).toContain("group Builder (2 of 3)");
    expect(html).toContain("one audit per group");
  });
});

describe("the printed draft (#144)", () => {
  it("states the caveat above the proposed conclusion", () => {
    const snapshot = {
      engagement: { id: "E-1", title: "Audit", stage: "Fieldwork" },
      contractVersion: "2.0",
      terms: {
        engagementType: "attestation",
        assuranceLevel: "limited",
        conclusion: "unmodified",
      },
      reportTitle: "Independent limited assurance report",
      opinion: "Unmodified conclusion · limited assurance",
      summary: "Draft",
      limitations: "",
      particulars: {
        addressee: "Board",
        location: "Vienna",
        signatory: "Firm",
        basisForModification: "",
        qualityStatement: "",
      },
      elements: [],
      conclusionStatement: {
        heading: "Unmodified conclusion",
        basisHeading: "",
        text: "Based on the procedures performed, nothing has come to our attention.",
        levelStatement: "",
        notAssurance: false,
        draftCaveat: draftCaveat(2),
      },
      papers: [],
      findings: [],
      evidence: [],
    } as unknown as ReportSnapshot;
    const html = renderToStaticMarkup(
      reportMarkup(
        {
          id: "REPORT-1",
          kind: "draft",
          createdAt: "2026-11-13T10:00:00.000Z",
        } as never,
        snapshot,
      ),
    );
    const caveat = html.indexOf("Draft, gates open: 2 completion requirements");
    expect(caveat).toBeGreaterThan(0);
    expect(caveat).toBeLessThan(html.indexOf("Based on the procedures"));
  });
});

describe("the printed LL144 summaries (#144)", () => {
  it("names the group of each audit of a per-group run", () => {
    const summary = (group: string, i: number) => ({
      auditId: "LL144-" + i,
      tool: { name: "Style classifier", distributionDate: "2026-01-15" },
      auditDate: "2026-11-02",
      numberOfApplicants: 40,
      classification: {
        rule: "6 RCNY § 5-301(b)(4)",
        group,
        groups: ["Leader", "Builder", "Helper"],
      },
    });
    const html = renderToStaticMarkup(
      reportMarkup(
        {
          id: "REPORT-1",
          kind: "final",
          createdAt: "2026-11-13T10:00:00.000Z",
        } as never,
        {
          engagement: { id: "E-1", title: "Audit", stage: "Reporting" },
          contractVersion: "2.0",
          terms: {
            engagementType: "attestation",
            assuranceLevel: "limited",
            conclusion: "unmodified",
          },
          reportTitle: "Independent limited assurance report",
          opinion: "Unmodified conclusion · limited assurance",
          summary: "Final",
          particulars: {
            addressee: "Board",
            location: "Vienna",
            signatory: "Firm",
            basisForModification: "",
            qualityStatement: "",
          },
          elements: [],
          conclusionStatement: {
            heading: "Unmodified conclusion",
            basisHeading: "",
            text: "Nothing has come to our attention.",
            levelStatement: "",
            notAssurance: false,
          },
          papers: [],
          findings: [],
          evidence: [],
          ll144Summaries: [
            summary("Leader", 1),
            summary("Builder", 2),
            summary("Helper", 3),
          ],
        } as unknown as ReportSnapshot,
      ),
    );
    expect(html).toContain(
      "Style classifier, group Leader (1 of 3): bias audit",
    );
    expect(html).toContain(
      "Style classifier, group Builder (2 of 3): bias audit",
    );
    expect(html).toContain(
      "Style classifier, group Helper (3 of 3): bias audit",
    );
  });
});
