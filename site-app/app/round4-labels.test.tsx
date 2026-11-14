// Round-4 readable labels (#227), as the components render them: no raw
// coded value, user id or unpluralised count reaches the page. Each case
// names the raw text the round-4 verification found.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssuranceRecord } from "@/lib/assurance-core";
import { humanLabel } from "@/lib/presentation";
import type { MonitoringCase, Workflow } from "@/lib/workflow-types";
import { approvedWorkflow, at, engagement } from "@/lib/workflow/test-fixtures";
import { FollowupPanel } from "./audit-program/followup-panel";
import { programForms } from "./audit-program/program-forms";
import type { ProgramScope } from "./audit-program/program-scope";
import type { Form } from "./audit-program/workflow-dialog";
import { AccessSection } from "./assurance-workbench/access-section";
import type { Snapshot } from "./assurance-workbench/types";
import { recordTitle } from "./assurance-register";
import { RequestAccess } from "./client-portal";
import { RecordFields } from "./record-details";
import { SpecialCategoryRecord } from "./special-category";
import { derivedSummary } from "./workspace/modals/classification-form";
import type { WorkspaceData } from "./workspace-types";

const noop = () => {};
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const names: Record<string, string> = {
  "persona-qa-auditor": "Quinn Auditor",
};
const resolve = (id: string) => names[id] ?? id;

describe("readable labels (#227)", () => {
  it("names the equalized-odds metric with its acronyms", () => {
    expect(humanLabel("maximum_tpr_fpr_gap")).toBe("Maximum TPR/FPR gap");
  });

  it("shows who froze the policy and declared the column by name", () => {
    const policy = text(
      renderToStaticMarkup(
        <RecordFields
          value={{ policy: { frozenAt: at, frozenBy: "persona-qa-auditor" } }}
          resolve={resolve}
        />,
      ),
    );
    expect(policy).toContain("Frozen by Quinn Auditor");
    expect(policy).not.toContain("persona-qa-auditor");
    expect(policy).not.toContain("Frozen By");
    const declared = text(
      renderToStaticMarkup(
        <SpecialCategoryRecord
          resolve={resolve}
          declaration={
            {
              column: "sex",
              specialCategory: false,
              route: "client_side",
              declaredBy: "persona-qa-auditor",
              declaredAt: at,
            } as never
          }
          acknowledgement={
            {
              acknowledgedBy: "persona-qa-auditor",
              acknowledgedAt: at,
            } as never
          }
        />,
      ),
    );
    expect(declared).toContain("Declared by Quinn Auditor");
    expect(declared).toContain("acknowledged by Quinn Auditor");
    expect(declared).not.toContain("persona-qa-auditor");
  });

  it("writes follow-up case types, cadence and outcomes in sentence case", () => {
    const monitoringCase: MonitoringCase = {
      id: "MC-1",
      kind: "monitoring",
      title: "Quarterly drift check",
      description: "Drift",
      ownerId: "persona-qa-auditor",
      dueDate: "2026-12-01",
      cadence: "one_off",
      findingId: "",
      reportId: "",
      state: "in_progress",
      decision: "follow_up",
      assessment: "",
      evidenceIds: [],
      contributors: [],
      createdBy: "lead",
      createdAt: at,
      updatedAt: at,
      history: [],
    };
    const e = engagement({
      workflow: { ...approvedWorkflow(), monitoring: [monitoringCase] },
    });
    const out = text(
      renderToStaticMarkup(
        <FollowupPanel
          scope={
            {
              e,
              w: e.workflow as Workflow,
              uid: "lead",
              busy: false,
              writer: false,
              lead: false,
              reviewer: false,
              name: resolve,
              forms: { monitoring: noop, command: noop },
            } as unknown as ProgramScope
          }
          onFollowup={noop}
        />,
      ),
    );
    expect(out).toContain("Monitoring · Quinn Auditor");
    expect(out).toContain("One-off");
    expect(out).toContain("In progress");
    expect(out).toContain("Decision: Follow-up");
    for (const raw of ["one off", "follow up", "in progress", "monitoring ·"])
      expect(out).not.toContain(raw);
  });

  it("offers readable options in the follow-up and candidate forms", () => {
    const forms: Form[] = [];
    const e = engagement({ workflow: approvedWorkflow() });
    const openers = programForms({
      data: {
        engagement: e,
        identity: { id: "lead", role: "Lead Auditor" },
        people: [],
        members: [],
      } as never,
      act: async () => ({ engagement: e }),
      setForm: (f) => {
        if (f && typeof f !== "function") forms.push(f);
      },
      batchIds: [],
      setBatchIds: noop,
    });
    openers.monitoring();
    openers.bulk();
    const labels = forms.flatMap((f) =>
      f.fields.flatMap((field) =>
        field.type === "select"
          ? (field.options ?? []).map((o) => o.label)
          : [],
      ),
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        "Monitoring",
        "One-off",
        "Monthly",
        "Yes",
        "No",
        "Applicable",
        "Readiness",
        "Not applicable",
      ]),
    );
    for (const raw of ["true", "false", "applicable", "readiness", "one off"])
      expect(labels).not.toContain(raw);
    // Every option starts with a capital, as sentence case does.
    for (const label of labels) expect(label).toMatch(/^[A-Z0-9]/);
  });

  it("titles an access event record 'Access decision'", () => {
    expect(
      recordTitle({ kind: "access_event", body: {} } as AssuranceRecord),
    ).toBe("Access decision");
    expect(
      recordTitle({ kind: "worker_event", body: {} } as AssuranceRecord),
    ).toBe("Worker event");
  });

  it("counts facts that need information with count()", () => {
    expect(
      derivedSummary({ label: "High-risk", needsInformation: ["a"] }),
    ).toBe("High-risk · 1 fact needs information");
    expect(
      derivedSummary({ label: "High-risk", needsInformation: ["a", "b"] }),
    ).toBe("High-risk · 2 facts need information");
    expect(derivedSummary({ label: "Minimal", needsInformation: [] })).toBe(
      "Minimal",
    );
  });

  it("does not call a revoked runner 'Awaiting first connection'", () => {
    const worker = (id: string, active: number) => ({
      id,
      name: "Worker-" + id,
      image_digest: "sha256:abc",
      capabilities: '["provided_predictions"]',
      active,
      last_seen: null,
    });
    const out = text(
      renderToStaticMarkup(
        <AccessSection
          snapshot={
            {
              access: [],
              workers: [worker("A", 1), worker("B", 0)],
              capabilities: {},
            } as unknown as Snapshot
          }
          lead={false}
          busy={false}
          open={noop}
        />,
      ),
    );
    const [enrolled, revoked] = out.split("Worker-").slice(1);
    expect(enrolled).toContain("Awaiting first connection");
    expect(revoked).toContain("Revoked before its first connection");
    expect(revoked).not.toContain("Awaiting first connection");
  });

  it("counts one active client request grant in the singular", () => {
    const workflow: Workflow = {
      ...approvedWorkflow(),
      clientGrants: [
        {
          id: "G1",
          userId: "contributor",
          requestId: "REQ-1",
          prompt: "Prompt",
          instructions: "Upload the file",
          category: "Model",
          handlingBasis: "synthetic",
          expiresAt: "2099-01-01T00:00:00.000Z",
          active: true,
          actor: "lead",
          at,
        },
      ],
      submissions: [],
    };
    const out = text(
      renderToStaticMarkup(
        <RequestAccess
          data={
            {
              identity: { id: "lead", role: "Lead Auditor" },
              members: [],
              engagement: engagement({ workflow }),
              lapsedClientGrants: [],
            } as unknown as WorkspaceData
          }
          busy={false}
          act={async () => ({ engagement: {} as never })}
          onEditing={noop}
        />,
      ),
    );
    expect(out).toContain("1 active grant");
    expect(out).not.toContain("1 active grants");
  });
});
