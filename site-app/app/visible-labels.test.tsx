// No coded value reaches the page (#227 item 4, #234 items 5 to 7): each view
// that showed a snake_case or lower-case enum value renders here with those
// values, and the test fails on any of them in its visible text.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssuranceRecord } from "@/lib/assurance-core";
import type { Engagement } from "@/lib/domain/types";
import { describePlan } from "@/lib/hosted-statistics";
import type { Procedure } from "@/lib/workflow-types";
import {
  AssuranceRecordDetails,
  recordSubtitle,
} from "./assurance-record-details";
import { ProcedurePlan } from "./audit-program/procedure-plan";
import type { ProgramScope } from "./audit-program/program-scope";
import { RecordFields } from "./record-details";
import { ProcedureComparison } from "./revision-comparison";
import type { LabSetup } from "./testing-lab/use-lab-setup";
import { DataStep } from "./testing-lab/wizard-data-step";

/** The coded values these views hold, which must never show as written. */
const codes = [
  "manual",
  "readiness",
  "supported",
  "not_supported",
  "performed",
  "not_performed",
  "test",
  "validation",
  "training",
  "unknown",
  "internal_policy",
  "equalized_odds",
  "confirmatory",
];
/** The text a reader sees: text nodes and option labels, entities decoded. */
function visibleText(html: string) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, "")
    .split(/<[^>]+>/)
    .map((t) =>
      t
        .replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&#x27;", "'")
        .trim(),
    )
    .filter(Boolean);
}
/** Fails on a snake_case word, or a coded value standing alone in a phrase. */
function expectReadable(html: string) {
  for (const text of visibleText(html)) {
    expect(text, "snake_case in: " + text).not.toMatch(
      /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/,
    );
    for (const part of text.split(/\s*(?:·|:|\[|\]|,)\s*/))
      expect(codes, "coded value in: " + text).not.toContain(part.trim());
  }
}

const procedure = {
  id: "PROC-1",
  templateId: "WP-A09-01",
  title: "Risk management system",
  stage: "Fieldwork",
  objective: "Test the risk management system",
  instructions: [],
  expectedEvidence: [],
  candidateRefs: [],
  revision: 2,
  selected: true,
  applicability: "readiness",
  rationale: "In scope",
  criterion: "Art 9",
  sourceVersion: "2026.11.2",
  periodAnalysis: "Whole period",
  population: "Risk register",
  sampling: "All entries",
  ownerId: "user-auditor",
  reviewerId: "user-reviewer",
  dueDate: "2026-12-31",
  method: "manual",
  modelId: "",
  datasetId: "",
  profileId: "",
  contributors: [],
  history: [],
} as unknown as Procedure;

describe("readable labels in the audit program", () => {
  it("names the procedure method and applicability", () => {
    const scope = {
      e: { workflow: { program: { status: "draft" } } },
      uid: "user-auditor",
      role: "Auditor",
      busy: false,
      name: (id: string) => id,
      art50Suggestion: () => null,
      catalogItem: () => undefined,
      forms: { planForm: () => {} },
    } as unknown as ProgramScope;
    const html = renderToStaticMarkup(
      <ProcedurePlan scope={scope} p={procedure} />,
    );
    expect(visibleText(html)).toContain("Manual");
    expectReadable(html);
  });

  it("names the outcome and step states in the review diff", () => {
    const execution = (outcome: string, state: string) => ({
      performed: "Inspected the register",
      steps: [{ id: "s1", state, notes: "" }],
      sampling: "All",
      results: "Complete",
      limitations: "None",
      evidenceIds: [],
      runIds: [],
      assessment: {
        relevance: "High",
        reliability: "High",
        coverage: "Full",
        contradictions: "None",
        conclusion: "Supported by the register",
        outcome,
        actor: "user-auditor",
        at: "2026-11-01T09:00:00.000Z",
      },
    });
    const p = {
      ...procedure,
      method: "evaluation",
      execution: execution("supported", "performed"),
      history: [
        {
          revision: 1,
          at: "2026-11-01T09:00:00.000Z",
          plan: { ...procedure, applicability: "not_applicable" },
          execution: execution("not_supported", "not_performed"),
        },
      ],
    } as unknown as Procedure;
    const html = renderToStaticMarkup(
      <ProcedureComparison
        procedure={p}
        userId="user-reviewer"
        resolve={String}
      />,
    );
    expect(html).toContain("Outcome: Supported");
    expect(html).toContain("Outcome: Not supported");
    expectReadable(html);
  });
});

describe("readable labels in the Testing lab", () => {
  const setup = (over: Partial<LabSetup> = {}) =>
    ({
      inspect: null,
      inspecting: false,
      inspectError: "",
      draft: {
        datasetContext: {
          split: "test",
          population: "",
          predictionProvenance: "",
          independence: "",
        },
      },
      setDraft: () => {},
      config: () => {},
      locked: false,
      model: undefined,
      cols: [],
      ...over,
    }) as unknown as LabSetup;

  it("names the dataset roles", () => {
    const html = renderToStaticMarkup(<DataStep setup={setup()} />);
    expect(visibleText(html)).toEqual(
      expect.arrayContaining(["Test", "Validation", "Training", "Unknown"]),
    );
    expectReadable(html);
  });

  it("keeps the server's reason for a dataset it could not inspect (#234 item 7)", () => {
    const reason =
      "Interactive diagnostics accept at most 10,000 rows; use the Python worker for larger datasets";
    const html = renderToStaticMarkup(
      <DataStep setup={setup({ inspectError: reason })} />,
    );
    expect(html).toContain("Dataset inspection is unavailable: " + reason);
  });

  it("names the criteria and roles of a statistics plan", () => {
    const lines = describePlan({
      confidenceLevel: 0.95,
      minimums: { sampleSize: 30, groupSize: 10, classCount: 5 },
      criteria: [
        {
          id: "equalized_odds",
          kind: "group_comparison",
          role: "confirmatory",
          metric: "equalized_odds",
          band: { lower: null, upper: 0.1 },
          comparison: { mode: "pairwise" },
          minimumCoverage: 1,
        },
      ],
    } as unknown as Parameters<typeof describePlan>[0]);
    expect(lines[0]).toMatch(/^Equalized odds: .*\[Confirmatory\]$/);
    expectReadable(
      renderToStaticMarkup(
        <ul>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>,
      ),
    );
  });

  it("names the policy source in Inputs & policy", () => {
    const html = renderToStaticMarkup(
      <RecordFields
        value={{
          policy: {
            source: "internal_policy",
            version: "1.0",
            frozenAt: "2026-11-01T09:00:00.000Z",
          },
        }}
        resolve={String}
      />,
    );
    expect(visibleText(html)).toContain("Internal policy");
    expectReadable(html);
  });
});

describe("the access decision record sheet (#234 item 5)", () => {
  const record: AssuranceRecord = {
    id: "AS-1",
    kind: "access_event",
    sha256: "a".repeat(64),
    createdAt: "2026-11-01T09:00:00.000Z",
    actor: "persona-lead",
    body: {
      userId: "persona-qa-reviewer",
      active: true,
      reason: "Second reviewer for the quality review",
    },
  };
  const engagement = {
    artifacts: [],
    papers: [],
    models: [],
  } as unknown as Engagement;
  const person = (id: string) =>
    ({ "persona-lead": "Lea Lead", "persona-qa-reviewer": "Rhea Reviewer" })[
      id
    ] ?? id;

  it("is badged an access decision and names the member", () => {
    const html = renderToStaticMarkup(
      <AssuranceRecordDetails
        record={record}
        records={[record]}
        engagement={engagement}
        person={person}
        onRecord={() => {}}
        onPaper={() => {}}
        onEvidence={() => {}}
      />,
    );
    const text = visibleText(html);
    expect(text).toContain("Access decision");
    expect(text).not.toContain("Diagnostic record");
    expect(text).toEqual(
      expect.arrayContaining(["Team member", "Rhea Reviewer", "Granted"]),
    );
    expect(html).not.toMatch(/User Id/);
    expect(text).not.toContain("persona-qa-reviewer");
  });

  it("has a subtitle that fits an access decision", () => {
    // The record dialog's description (record-dialog.tsx); the Playwright
    // round-5 spec checks it in the open dialog.
    expect(recordSubtitle(record)).toBe(
      "Engagement access granted or revoked, and why",
    );
    expect(recordSubtitle({ ...record, kind: "assertion" })).toBe(
      "Saved assessment and source history",
    );
  });
});
