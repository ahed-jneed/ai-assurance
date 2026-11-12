// The management-system panels (#28) render the Statement of Applicability,
// the programme phases and the nonconformity grades from the engagement and
// the pack's management-system view, with the actions each role may take.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ManagementSystemView } from "@/lib/criteria/types";
import type { Engagement, Finding } from "@/lib/domain";
import {
  Nonconformities,
  ProgrammePhases,
  StatementOfApplicability,
} from "./management-system";

const view: ManagementSystemView = {
  phases: [
    { id: "stage-1", title: "Stage 1", templateIds: ["AIMS-S1-01"] },
    { id: "stage-2", title: "Stage 2", templateIds: ["AIMS-S2-01"] },
  ],
  controls: [
    {
      id: "A.2.2",
      ref: "A.2.2",
      title: "A written AI policy",
      group: "A.2 Policies that direct AI work",
    },
    {
      id: "A.10.4",
      ref: "A.10.4",
      title: "Meeting customer expectations for AI",
      group: "A.10 Working with suppliers, partners and customers",
    },
  ],
  controlsFramework: "ISO/IEC 42001:2023",
};
const finding = (overrides: Partial<Finding>): Finding => ({
  id: "F-1",
  title: "Risk assessments not repeated",
  article: "ISO/IEC 42001:2023 8.2",
  condition: "",
  criteria: "",
  cause: "",
  effect: "",
  likelihood: 2,
  impact: 2,
  riskScore: 4,
  severity: "Low",
  status: "open",
  owner: "CISO",
  dueDate: "2027-01-31",
  response: "",
  remediation: "",
  retestEvidenceIds: [],
  createdBy: "auditor",
  visibility: "internal",
  ...overrides,
});
const engagement = (overrides: Partial<Engagement> = {}) =>
  ({
    papers: [
      {
        id: "WP-1",
        templateId: "AIMS-S1-01",
        title: "Stage 1: AIMS documentation, context and scope",
        status: "signed",
        required: true,
      },
    ],
    findings: [],
    ...overrides,
  }) as unknown as Engagement;
const noop = () => undefined;

describe("management-system panels", () => {
  it("shows Stage 1 before Stage 2 with signed counts", () => {
    const html = renderToStaticMarkup(
      <ProgrammePhases engagement={engagement()} view={view} />,
    );
    expect(html).toContain("Programme phases");
    expect(html).toContain("1 of 1 papers signed");
    expect(html).toContain("no papers yet");
    expect(html.indexOf("Stage 1")).toBeLessThan(html.indexOf("Stage 2"));
  });

  it("lists every control with what is missing and offers the review only when complete", () => {
    const partial = engagement({
      statementOfApplicability: {
        documentRef: "",
        revision: 1,
        entries: [
          {
            control: "A.2.2",
            included: true,
            justification: "Policy treats AI risks.",
            implementation: "implemented",
            actor: "auditor",
            at: "2026-11-07T10:00:00.000Z",
          },
        ],
      },
    });
    const html = renderToStaticMarkup(
      <StatementOfApplicability
        engagement={partial}
        view={view}
        writer
        reviewer
        userId="reviewer"
        busy={false}
        act={noop}
      />,
    );
    expect(html).toContain("1 of 2 controls decided");
    expect(html).toContain("No inclusion or exclusion decision");
    expect(html).toContain(
      'aria-label="Decision for A.10.4 Meeting customer expectations for AI"',
    );
    expect(html).toContain("read each control in your licensed copy");
    expect(html).not.toContain("Review Statement of Applicability");

    const complete = engagement({
      statementOfApplicability: {
        ...partial.statementOfApplicability!,
        revision: 2,
        entries: [
          ...partial.statementOfApplicability!.entries,
          {
            control: "A.10.4",
            included: false,
            justification: "No customers.",
            actor: "auditor",
            at: "2026-11-07T10:00:00.000Z",
          },
        ],
      },
    });
    const reviewable = renderToStaticMarkup(
      <StatementOfApplicability
        engagement={complete}
        view={view}
        writer={false}
        reviewer
        userId="reviewer"
        busy={false}
        act={noop}
      />,
    );
    expect(reviewable).toContain("awaits an independent review");
    expect(reviewable).toContain("Review Statement of Applicability");
    // A reader without write access gets no save buttons.
    expect(reviewable).not.toContain("Save the decision");
  });

  it("grades findings and shows the corrective action plan of a nonconformity", () => {
    const e = engagement({
      findings: [
        finding({
          grade: "major",
          correctiveAction: {
            correction: "Reassessed.",
            rootCause: "No trigger.",
            action: "Add a trigger.",
            owner: "CISO",
            dueDate: "2027-01-31",
            recordedBy: "auditor",
            recordedAt: "2026-11-07T10:00:00.000Z",
          },
        }),
        finding({
          id: "F-2",
          title: "Improve log retention",
          grade: "opportunity",
        }),
        finding({ id: "F-3", title: "Ungraded", grade: undefined }),
      ],
    });
    const html = renderToStaticMarkup(
      <Nonconformities
        engagement={e}
        writer
        reviewer
        userId="reviewer"
        busy={false}
        act={noop}
      />,
    );
    expect(html).toContain("Major 1 open (1 without accepted plan)");
    expect(html).toContain("Major nonconformity");
    expect(html).toContain("Opportunity for improvement");
    expect(html).toContain("Not graded");
    expect(html).toContain("recorded, awaiting acceptance");
    expect(html).toContain("Accept plan");
    // Only nonconformities carry a plan: one plan section for three findings.
    expect(html.match(/Corrective action plan:/g)).toHaveLength(1);
  });
});
