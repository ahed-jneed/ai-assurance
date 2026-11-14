// The client portal's destinations (#182): a Client Contributor is shown no
// findings, so their portal offers no Findings destination; a Client Viewer
// keeps it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/domain/types";
import type { WorkspaceData } from "../workspace-types";
import { ClientPortalHeader } from "./client-portal-shell";

const header = (role: Role) =>
  renderToStaticMarkup(
    <ClientPortalHeader
      data={
        {
          identity: { id: "u-1", name: "Client person", role },
          tenantId: "t-1",
          memberships: [{ tenant_id: "t-1", name: "Practice", role }],
          clients: [],
          engagements: [],
          engagement: { id: "e-1", title: "Engagement", clientId: "c-1" },
        } as unknown as WorkspaceData
      }
      view="Overview"
      navigationDisabled={false}
      onNavigate={() => {}}
      onSwitch={() => {}}
    />,
  );
const destinations = (html: string) =>
  [...html.matchAll(/<button type="button"[^>]*>(?:<svg.*?<\/svg>)?([^<]+)/g)]
    .map((m) => m[1])
    .filter((label) => label !== "Engagement");

describe("client portal destinations", () => {
  it("offers a Client Viewer the shared findings", () => {
    expect(destinations(header("Client Viewer"))).toEqual([
      "Overview",
      "Shared evidence",
      "Findings",
      "Reports",
    ]);
  });

  it("offers a Client Contributor no Findings destination", () => {
    expect(destinations(header("Client Contributor"))).toEqual([
      "Overview",
      "Shared evidence",
      "Reports",
    ]);
  });
});
