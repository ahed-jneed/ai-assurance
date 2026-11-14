// Release verification round 2 UI defects (#210): Release disabled while
// the EQR's sign-off is outstanding, receipt acknowledgment for every role
// the permission map admits, the client's "Released" label and the
// follow-up closure reason. The toast layering is covered end to end in
// e2e/stale-versions.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Engagement, Report, Role } from "@/lib/domain/types";
import { reportTime } from "@/lib/report-presentation";
import type { MonitoringCase, Workflow } from "@/lib/workflow-types";
import {
  approvedWorkflow,
  artifact,
  at,
  completedQualityReview,
  engagement,
} from "@/lib/workflow/test-fixtures";
import { FollowupPanel } from "./audit-program/followup-panel";
import { procedureDueDate } from "./audit-program/program-panel";
import type { ProgramScope } from "./audit-program/program-scope";
import { ReportRelease } from "./audit-program/report-release";
import { RequestAccess } from "./client-portal";
import { FrozenReportDetails } from "./report-details";
import type { WorkspaceData } from "./workspace-types";

const approved = (): Report => ({
  id: "R1",
  kind: "final",
  createdAt: at,
  actor: "auditor",
  sha256: "R1-internal",
  snapshot: { opinion: "Adverse conclusion" },
  clientSnapshot: { contractVersion: "2.0", opinion: "Adverse conclusion" },
  clientSha256: "R1-client",
  release: {
    state: "approved",
    approval: {
      userId: "reviewer",
      at,
      internalHash: "R1-internal",
      clientHash: "R1-client",
      reason: "Both packages reviewed",
    },
    history: [],
  },
});

describe("Release to client while the EQR has not signed off", () => {
  const html = (e: Engagement) =>
    renderToStaticMarkup(
      <ReportRelease
        report={e.reports[0]}
        reports={e.reports}
        engagement={e}
        role="Lead Auditor"
        userId="lead"
        busy={false}
        act={async () => ({ engagement: {} as never })}
        onEditing={() => {}}
      />,
    );
  const eqr =
    "The engagement quality reviewer must sign off both exact packages before release";
  const releaseButton = /<button[^>]*>Release to client<\/button>/;

  it("is disabled with the server's reason, which the guidance names", () => {
    const out = html(
      engagement({
        workflow: approvedWorkflow(),
        reports: [approved()],
        qualityReview: completedQualityReview(),
      }),
    );
    const button = out.match(releaseButton)![0];
    expect(button).toMatch(/disabled=""/);
    expect(button).toMatch(/aria-describedby="release-blocked-R1"/);
    expect(out).toContain(`id="release-blocked-R1">${eqr}</p>`);
    expect(out).toContain("Both package versions are approved. " + eqr + ".");
    expect(out).not.toContain("A Lead Auditor other than the approver");
  });

  it("is enabled when no quality review applies", () => {
    const out = html(
      engagement({ workflow: approvedWorkflow(), reports: [approved()] }),
    );
    expect(out.match(releaseButton)![0]).not.toMatch(/disabled=""/);
    expect(out).toContain("A Lead Auditor other than the approver");
  });
});

describe("Acknowledge receipt follows the permission map", () => {
  const workflow: Workflow = {
    ...approvedWorkflow(),
    clientGrants: [
      {
        id: "GRANT-1",
        userId: "contributor",
        requestId: "REQ-1",
        prompt: "Model card",
        instructions: "Upload the model card",
        category: "Model",
        handlingBasis: "synthetic",
        expiresAt: "2099-01-01T00:00:00.000Z",
        active: true,
        actor: "lead",
        at,
      },
    ],
    submissions: [
      {
        id: "SUB-1",
        requestId: "REQ-1",
        grantId: "GRANT-1",
        actor: "contributor",
        at,
        evidenceIds: ["evidence"],
        note: "Model card attached",
        delivery: "complete",
        remaining: "",
      },
    ],
  };
  const html = (role: Role) =>
    renderToStaticMarkup(
      <RequestAccess
        data={
          {
            identity: { id: "user", role },
            members: [],
            engagement: engagement({ workflow }),
          } as unknown as WorkspaceData
        }
        busy={false}
        act={async () => ({ engagement: {} as never })}
        onEditing={() => {}}
      />,
    );

  it("is offered to the Auditor, without the grant controls", () => {
    const out = html("Auditor");
    expect(out).toContain(">Acknowledge receipt</button>");
    expect(out).toContain("1 awaiting acknowledgment");
    expect(out).not.toContain("Assign request");
    expect(out).not.toContain("Revoke");
  });
  it("stays in the Lead Auditor's grant panel", () => {
    const out = html("Lead Auditor");
    expect(out).toContain(">Acknowledge receipt</button>");
    expect(out).toContain("Assign request");
  });
  it("is not offered to a Reviewer, who may not acknowledge", () => {
    expect(html("Reviewer")).toBe("");
  });
});

describe("the program register's due date (#216)", () => {
  it("says a due date is needed, a release-time record's time, or the date", () => {
    expect(procedureDueDate({ dueDate: "", templateId: "WP-A15-01" })).toBe(
      "Due date needed",
    );
    expect(procedureDueDate({ dueDate: "", templateId: "WP-RP-02" })).toBe(
      "Recorded at release",
    );
    expect(
      procedureDueDate({ dueDate: "2026-12-31", templateId: "WP-A15-01" }),
    ).toBe("2026-12-31");
  });
});

describe("Send clarification follows the permission map (#216)", () => {
  const grant = (id: string, overrides: object = {}) => ({
    id,
    userId: "contributor",
    requestId: "REQ-" + id,
    prompt: "Prompt " + id,
    instructions: "Upload it",
    category: "Model",
    handlingBasis: "synthetic" as const,
    expiresAt: "2099-01-01T00:00:00.000Z",
    active: true,
    actor: "lead",
    at,
    ...overrides,
  });
  const workflow: Workflow = {
    ...approvedWorkflow(),
    clientGrants: [
      grant("GRANT-1", {
        communications: [
          {
            id: "MSG-1",
            actor: "lead",
            at,
            kind: "clarification",
            text: "Include the version history",
          },
        ],
      }),
      grant("GRANT-2", { active: false }),
      grant("GRANT-3"),
    ],
    submissions: [],
  };
  const html = (role: Role) =>
    renderToStaticMarkup(
      <RequestAccess
        data={
          {
            identity: { id: "user", role },
            members: [],
            engagement: engagement({ workflow }),
            lapsedClientGrants: ["GRANT-3"],
          } as unknown as WorkspaceData
        }
        busy={false}
        act={async () => ({ engagement: {} as never })}
        onEditing={() => {}}
      />,
    );
  const sends = (out: string) =>
    out.match(/>Send clarification<\/button>/g)?.length ?? 0;

  it("is offered to the Auditor for each active grant, with its thread", () => {
    const out = html("Auditor");
    // Only GRANT-1: GRANT-2 was revoked and GRANT-3 lapsed, which the server
    // refuses.
    expect(sends(out)).toBe(1);
    expect(out).toContain("Prompt GRANT-1");
    expect(out).not.toContain("Prompt GRANT-2");
    expect(out).not.toContain("Prompt GRANT-3");
    expect(out).toContain("Include the version history");
    expect(out).not.toContain("Assign request");
    expect(out).not.toContain("Update client instructions");
  });
  it("stays in the Lead Auditor's grant panel, for active grants only", () => {
    expect(sends(html("Lead Auditor"))).toBe(1);
  });
  it("is not offered to a Reviewer or a client", () => {
    for (const role of ["Reviewer", "Client Viewer"] as Role[])
      expect(html(role)).toBe("");
  });
});

describe("the client's release time", () => {
  const releasedAt = "2026-11-03T08:30:00.000Z";
  it("is labelled Released on the record sheet", () => {
    const out = renderToStaticMarkup(
      <FrozenReportDetails
        value={{
          ...approved(),
          release: undefined,
          createdAt: releasedAt,
          releasedAt,
          snapshot: { opinion: "Adverse conclusion", createdAt: at },
        }}
      />,
    );
    expect(out).toContain("<dt>Released</dt>");
    expect(out).not.toContain("<dt>Captured</dt>");
  });
  it("stays Captured on a staff record", () => {
    const out = renderToStaticMarkup(
      <FrozenReportDetails value={{ ...approved() }} />,
    );
    expect(out).toContain("<dt>Captured</dt>");
  });
  it("labels the reports list", () => {
    expect(reportTime({ createdAt: releasedAt, releasedAt })).toEqual({
      label: "Released",
      at: releasedAt,
    });
    expect(reportTime({ createdAt: at })).toEqual({
      label: "Captured",
      at,
    });
  });
});

describe("Review closure of a follow-up case", () => {
  const followUp = (
    overrides: Partial<MonitoringCase> = {},
  ): MonitoringCase => ({
    id: "MON-1",
    kind: "change",
    title: "Model version change",
    description: "A new model version",
    ownerId: "auditor",
    dueDate: "2026-12-31",
    cadence: "one_off",
    findingId: "",
    reportId: "",
    state: "in_progress",
    decision: "follow_up",
    assessment: "Impact assessed",
    evidenceIds: [],
    contributors: ["auditor"],
    createdBy: "auditor",
    createdAt: at,
    updatedAt: at,
    history: [],
    ...overrides,
  });
  const html = (m: MonitoringCase, uid = "reviewer") => {
    const e = engagement({
      workflow: { ...approvedWorkflow(), monitoring: [m] },
      artifacts: [artifact()],
    });
    return renderToStaticMarkup(
      <FollowupPanel
        scope={
          {
            e,
            w: e.workflow!,
            uid,
            busy: false,
            writer: false,
            lead: false,
            reviewer: true,
            name: (id: string) => id,
            forms: { monitoring: () => {}, command: () => {} },
          } as unknown as ProgramScope
        }
        onFollowup={() => {}}
      />,
    );
  };
  const closure = /<button[^>]*>Review closure<\/button>/;

  it("is disabled with the server's reason without accepted evidence", () => {
    const out = html(followUp());
    expect(out.match(closure)![0]).toMatch(/disabled=""/);
    expect(out).toContain(
      "Record an assessment with the accepted evidence before independent closure",
    );
  });
  it("names the independence rule for a contributor", () => {
    const out = html(followUp({ evidenceIds: ["evidence"] }), "auditor");
    expect(out).toContain(
      "A preparer or contributor cannot approve their own work",
    );
  });
  it("is enabled once accepted evidence is linked", () => {
    const out = html(followUp({ evidenceIds: ["evidence"] }));
    expect(out.match(closure)![0]).not.toMatch(/disabled=""/);
  });
});
