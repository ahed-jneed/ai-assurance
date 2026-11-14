// Round-3 UI fixes (#221): the D-28 acceptance gate in the acceptance panel,
// the banner of a captured final package, the Revoke control of a client
// request grant, the Access log's superseded invitations and the GenAI
// members count. The real clicks are in e2e/round3-ui.spec.ts; the job and
// option labels are in genai-ingest-labels.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { accessEventText } from "@/lib/access-events";
import { stored } from "@/lib/commands/test-fixtures";
import { captureGates } from "@/lib/domain/capture-gates";
import type { Engagement, Report, Role } from "@/lib/domain/types";
import { seedWorkflow } from "@/lib/workflow-seed";
import { resolveNew } from "@/lib/criteria/pin";
import type { Workflow } from "@/lib/workflow-types";
import {
  approvedWorkflow,
  at,
  declaration,
  engagement,
  procedureId,
} from "@/lib/workflow/test-fixtures";
import { acceptanceForms } from "./audit-program/acceptance-forms";
import { AcceptancePanel } from "./audit-program/acceptance-panel";
import type { Form } from "./audit-program/workflow-dialog";
import { RequestAccess } from "./client-portal";
import { membersHeading } from "./genai-evidence";
import { ReportWorkspace } from "./report-workspace";
import type { WorkspaceData } from "./workspace-types";

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("the D-28 acceptance gate in the acceptance panel", () => {
  const people = [
    ["lead", "Lena Lead", "Lead Auditor"],
    ["auditor", "Avery Auditor", "Auditor"],
    ["reviewer", "Riley Reviewer", "Reviewer"],
  ].map(([user_id, display_name, role]) => ({
    user_id,
    display_name,
    role,
    status: "active",
    client_id: null,
  }));
  function data(excluded: boolean): WorkspaceData {
    const w = approvedWorkflow([
      {
        ...seedWorkflow(resolveNew(), "lead", at).procedures.find(
          (p) => p.id === procedureId,
        )!,
        selected: true,
        applicability: "applicable",
        ownerId: "auditor",
        reviewerId: "reviewer",
      },
    ]);
    w.acceptance!.status = "draft";
    delete w.acceptance!.approval;
    if (excluded)
      w.declarations!.push(
        declaration("reviewer", {
          id: "DEC-reviewer-2",
          exclusions: ["employment"],
        }),
      );
    return {
      identity: { id: "lead", role: "Lead Auditor" },
      people,
      engagement: engagement({ workflow: w }),
    } as unknown as WorkspaceData;
  }
  const panel = (d: WorkspaceData) =>
    renderToStaticMarkup(
      <AcceptancePanel
        data={d}
        busy={false}
        act={async () => ({ engagement: {} as never })}
        onForm={noop}
      />,
    );
  const approve = /<button[^>]*>Approve acceptance<\/button>/;
  const reason =
    "Riley Reviewer declared a disqualifying relationship with the engagement; remove them from the team before accepting it";

  it("disables Approve with the server's reason, which names the person", () => {
    const out = panel(data(true));
    const button = out.match(approve)![0];
    expect(button).toMatch(/disabled=""/);
    expect(button).toMatch(/aria-describedby="/);
    expect(out).toContain(">" + reason + "</small>");
  });

  it("enables Approve once nobody on the team is conflicted", () => {
    const out = panel(data(false));
    expect(out.match(approve)![0]).not.toMatch(/disabled=""/);
    expect(out).not.toContain("declared a disqualifying relationship");
  });

  it("marks the disqualified person in the Revise acceptance team checklist", () => {
    let form: Form | null = null;
    acceptanceForms({
      data: data(true),
      act: async () => ({ engagement: {} as never }),
      onForm: (f) => (form = f),
      name: (id) => id,
    }).acceptanceForm();
    const team = (form as Form | null)!.fields.find((f) => f.name === "team")!;
    expect(team.options!.map((o) => o.label)).toEqual([
      "Lena Lead · Lead Auditor",
      "Avery Auditor · Auditor",
      "Riley Reviewer · Reviewer · Cannot be assigned: declared a disqualifying relationship",
    ]);
  });
});

describe("the Reports & sign-off banner of a captured final package (R1-19)", () => {
  // A Qualified final package awaiting approval, while the banner's default
  // terms have open capture gates (no quality reviewer is appointed).
  const captured: Report = {
    id: "R-1",
    kind: "final",
    createdAt: "2026-11-01T09:00:00.000Z",
    actor: "user-lead",
    sha256: "a",
    snapshot: {
      terms: {
        engagementType: "attestation",
        assuranceLevel: "limited",
        conclusion: "qualified",
      },
    },
    release: { state: "internal", history: [] },
  };
  const terms = {
    engagementType: "attestation",
    assuranceLevel: "limited",
    conclusion: "unmodified",
  } as const;
  const banner = (role: Role, userId: string) =>
    text(
      renderToStaticMarkup(
        <ReportWorkspace
          engagement={
            { ...stored(), stage: "Sign-off", reports: [captured] } as never
          }
          tenantId="t-1"
          role={role}
          userId={userId}
          people={[]}
          busy={false}
          terms={terms}
          onTerms={noop}
          onAudience={noop}
          onGate={noop}
          onCreate={noop}
          onOpen={noop}
          onAct={noop}
          section="packages"
          onSection={noop}
          query={
            {
              view: "all",
              search: "",
              filter: "all",
              facet: "all",
              sort: "",
            } as never
          }
          onQuery={noop}
          onReset={noop}
        />,
      ),
    );

  it("describes the package, not the capture gates of other terms", () => {
    expect(
      captureGates({ ...stored(), stage: "Sign-off" } as Engagement, terms)
        .length,
    ).toBeGreaterThan(0);
    const out = banner("Lead Auditor", "user-lead");
    expect(out).not.toContain("Final capture blocked");
    expect(out).toContain("Captured (Qualified), awaiting approval");
    expect(out).toContain(
      "A Reviewer or Lead Auditor other than you approves both package versions before client release.",
    );
  });

  it("gives each role its next step", () => {
    expect(banner("Reviewer", "user-reviewer")).toContain(
      "Review both package versions and approve them for client release.",
    );
    expect(banner("Auditor", "user-auditor")).toContain(
      "A Reviewer or Lead Auditor who did not capture it approves both package versions before client release.",
    );
    expect(banner("Engagement Quality Reviewer", "user-eqr")).toContain(
      "Sign off both exact package versions in Quality review.",
    );
  });
});

describe("Revoke on a client request grant", () => {
  const grant = (id: string, expiresAt: string) => ({
    id,
    userId: "contributor",
    requestId: "REQ-" + id,
    prompt: "Prompt " + id,
    instructions: "Upload the file",
    category: "Model",
    handlingBasis: "synthetic" as const,
    expiresAt,
    active: true,
    actor: "lead",
    at,
  });
  it("is offered only on an active grant, not an expired or lapsed one", () => {
    const workflow: Workflow = {
      ...approvedWorkflow(),
      clientGrants: [
        grant("ACTIVE", "2099-01-01T00:00:00.000Z"),
        grant("EXPIRED", "2020-01-01T00:00:00.000Z"),
        grant("LAPSED", "2099-01-01T00:00:00.000Z"),
      ],
      submissions: [],
    };
    const out = renderToStaticMarkup(
      <RequestAccess
        data={
          {
            identity: { id: "lead", role: "Lead Auditor" },
            members: [],
            engagement: engagement({ workflow }),
            lapsedClientGrants: ["LAPSED"],
          } as unknown as WorkspaceData
        }
        busy={false}
        act={async () => ({ engagement: {} as never })}
        onEditing={noop}
      />,
    );
    expect(out.match(/>Revoke<\/button>/g)).toHaveLength(1);
    // The one Revoke belongs to the active grant, the first box.
    const boxes = out.split('class="comment-box"').slice(1);
    expect(boxes[0]).toContain("Prompt ACTIVE");
    expect(boxes[0]).toContain(">Revoke</button>");
    expect(boxes[1]).toContain("Inactive");
    expect(boxes[1]).not.toContain(">Revoke</button>");
    expect(boxes[2]).toContain("Lapsed");
    expect(boxes[2]).not.toContain(">Revoke</button>");
  });
});

describe("the Access log's superseded invitations", () => {
  it("says how many expired invitations a re-invitation replaced", () => {
    const invite = (details: Record<string, unknown> | null) =>
      accessEventText({ action: "inviteMember", details });
    expect(invite({ expiredInvitations: ["INV-1"] })).toBe(
      "Invitation sent (replaced 1 expired invitation)",
    );
    expect(invite({ expiredInvitations: ["INV-1", "INV-2"] })).toBe(
      "Invitation sent (replaced 2 expired invitations)",
    );
    expect(invite({ email: "a@b.test" })).toBe("Invitation sent");
    expect(invite(null)).toBe("Invitation sent");
    expect(accessEventText({ action: "signIn", details: null })).toBe(
      "Signed in",
    );
  });
});

describe("the GenAI result card's members", () => {
  it("counts one member in the singular", () => {
    expect(membersHeading({ id: "C1", members: [{}] })).toBe("C1: 1 member");
    expect(
      membersHeading({ id: "C2", members: [{}, {}], membersOmitted: 3 }),
    ).toBe("C2: 2 members (3 more in the computation)");
  });
});
