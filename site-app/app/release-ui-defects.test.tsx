// Release verification UI defects (#202): the role shown without an
// identity, the dossier seal audience and the program's empty state.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { programEmptyStep } from "./audit-program/program-panel";
import { sealedAudience } from "./dossier-controls";
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
