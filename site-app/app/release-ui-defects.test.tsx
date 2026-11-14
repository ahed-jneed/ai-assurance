// Release verification UI defects (#202): the role shown without an
// identity, the dossier seal audience and the program's empty state.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { programEmptyStep } from "./audit-program/program-panel";
import { stored } from "@/lib/commands/test-fixtures";
import { captureGates } from "@/lib/domain/capture-gates";
import { sealedAudience } from "./dossier-controls";
import { ReportWorkspace } from "./report-workspace";
import { WorkspaceTopbar } from "./workspace/workspace-topbar";

describe("the topbar's access role", () => {
  const topbar = (role: "Lead Auditor" | null) =>
    renderToStaticMarkup(
      <SidebarProvider>
        <WorkspaceTopbar
          data={null}
          view="Overview"
          clientId={null}
          role={role}
          searchDisabled
          onSearch={() => {}}
          onNavigate={() => {}}
          onClient={() => {}}
        />
      </SidebarProvider>,
    );
  it("shows no role while no identity is loaded, as for a revoked member", () => {
    const html = topbar(null);
    expect(html).not.toContain("topbar-access");
    expect(html).not.toContain("Client Viewer");
  });
  it("shows the account's role once it is loaded", () => {
    expect(topbar("Lead Auditor")).toMatch(/topbar-access.*Lead Auditor/);
  });
});

describe("the Reports & sign-off banner after approval and release", () => {
  // A package captured with its own terms: the banner's default terms
  // still have open capture gates (no quality reviewer is appointed).
  const banner = (state: "approved" | "released") =>
    renderToStaticMarkup(
      <ReportWorkspace
        engagement={
          {
            ...stored(),
            stage: "Sign-off",
            reports: [
              {
                id: "R-1",
                kind: "final",
                createdAt: "2026-11-01T09:00:00.000Z",
                actor: "user-lead",
                sha256: "a",
                snapshot: {},
                release: { state, history: [] },
              },
            ],
          } as never
        }
        tenantId="t-1"
        role="Lead Auditor"
        userId="user-lead"
        people={[]}
        busy={false}
        terms={{
          engagementType: "attestation",
          assuranceLevel: "limited",
          conclusion: "unmodified",
        }}
        onTerms={() => {}}
        onAudience={() => {}}
        onGate={() => {}}
        onCreate={() => {}}
        onOpen={() => {}}
        onAct={() => {}}
        section="packages"
        onSection={() => {}}
        query={
          {
            view: "all",
            search: "",
            filter: "all",
            facet: "all",
            sort: "",
          } as never
        }
        onQuery={() => {}}
        onReset={() => {}}
      />,
    ).replace(/<[^>]+>/g, " ");
  it("follows an approved package, not the capture gates of other terms", () => {
    // The precondition: the banner's terms have open capture gates.
    expect(
      captureGates({ ...stored(), stage: "Sign-off" }, {
        engagementType: "attestation",
        assuranceLevel: "limited",
        conclusion: "unmodified",
      } as never).length,
    ).toBeGreaterThan(0);
    const text = banner("approved");
    expect(text).not.toContain("Final capture blocked");
    expect(text).toContain("The final package awaits client release");
    expect(text).not.toContain("before client release");
  });
  it("follows a released package", () => {
    const text = banner("released");
    expect(text).not.toContain("Final capture blocked");
    expect(text).toContain("Released to the client.");
  });
});

describe("the dossier seal audience", () => {
  it("posts the audience the dialog was opened for, a scoped export as internal", () => {
    expect(sealedAudience("internal")).toBe("internal");
    expect(sealedAudience("client")).toBe("client");
    expect(sealedAudience("scoped")).toBe("internal");
  });

  it("posts nothing without an audience", () => {
    expect(sealedAudience("")).toBeNull();
    expect(sealedAudience("everyone")).toBeNull();
  });
});

describe("the program's empty state", () => {
  it("names the next real step for the brief's state", () => {
    expect(programEmptyStep(undefined)).toMatch(
      /^Start with the engagement brief/,
    );
    expect(programEmptyStep("draft")).toMatch(
      /^Start with the engagement brief/,
    );
    expect(programEmptyStep("submitted")).toMatch(
      /^Approve the submitted engagement brief/,
    );
    expect(programEmptyStep("approved")).not.toMatch(/^Start with/);
    expect(programEmptyStep("approved")).toMatch(
      /assess the methodology candidates/,
    );
  });
});
