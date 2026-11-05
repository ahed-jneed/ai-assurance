import { describe, expect, it } from "vitest";
import {
  authorizedLink,
  linkQuery,
  readWorkspaceLink,
  type WorkspaceLink,
} from "./workspace-links";
import {
  defaultNavigation,
  parseNavigationPreferences,
  parseRecentEngagements,
  permittedNavigationRoutes,
} from "./navigation-preferences";

const link: WorkspaceLink = {
  tenantId: "tenant-1",
  engagementId: "eng-1",
  module: "Working papers",
  kind: "paper",
  recordId: "paper-1",
  section: "objective",
};

describe("workspace links", () => {
  it("round-trips a link through its query string", () => {
    expect(readWorkspaceLink("?" + linkQuery(link))).toEqual(link);
  });

  it("omits empty fields from the query string", () => {
    expect(
      linkQuery({
        ...link,
        module: "Clients",
        engagementId: "",
        kind: "",
        recordId: "",
        section: "",
      }),
    ).toBe("practice=tenant-1&view=Clients");
  });

  it("rejects unknown views, unknown record kinds and oversized values", () => {
    expect(readWorkspaceLink("")).toBeNull();
    expect(readWorkspaceLink("?view=Admin")).toBeNull();
    expect(readWorkspaceLink("?view=Overview&kind=script")).toBeNull();
    expect(
      readWorkspaceLink("?view=Overview&record=" + "x".repeat(301)),
    ).toBeNull();
  });

  it("keeps internal records and views away from client roles", () => {
    expect(authorizedLink(link, "Auditor", true)).toBe(true);
    expect(authorizedLink(link, "Client Viewer", true)).toBe(false);
    expect(
      authorizedLink(
        { ...link, module: "Findings", kind: "finding" },
        "Client Viewer",
        true,
      ),
    ).toBe(true);
    expect(
      authorizedLink(
        { ...link, module: "Findings", kind: "run" },
        "Client Contributor",
        true,
      ),
    ).toBe(false);
  });

  it("allows engagement views only when an engagement is open", () => {
    expect(authorizedLink(link, "Lead Auditor", false)).toBe(false);
    expect(permittedNavigationRoutes("Lead Auditor", false)).toEqual([
      "My work",
      "Clients",
      "Engagements",
      "Users & access",
    ]);
  });
});

describe("navigation preferences", () => {
  it("falls back to defaults for missing, oversized or malformed input", () => {
    expect(parseNavigationPreferences(null)).toBeNull();
    expect(parseNavigationPreferences("{")).toBeNull();
    expect(parseNavigationPreferences("x".repeat(4097))).toBeNull();
    expect(
      parseNavigationPreferences(JSON.stringify({ compact: "yes" })),
    ).toBeNull();
  });

  it("clamps the width and keeps only known, unique routes", () => {
    expect(
      parseNavigationPreferences(
        JSON.stringify({
          ...defaultNavigation,
          width: 999,
          pins: ["Overview", "Overview", "Admin", "Findings"],
          recent: ["Testing lab", 42],
        }),
      ),
    ).toEqual({
      compact: false,
      width: 360,
      pins: ["Overview", "Findings"],
      recent: ["Testing lab"],
    });
  });

  it("limits recent engagements to five unique ids", () => {
    expect(
      parseRecentEngagements(
        JSON.stringify(["a", "b", "a", "", 7, "c", "d", "e", "f"]),
      ),
    ).toEqual(["a", "b", "c", "d", "e"]);
    expect(parseRecentEngagements("not json")).toEqual([]);
  });
});
