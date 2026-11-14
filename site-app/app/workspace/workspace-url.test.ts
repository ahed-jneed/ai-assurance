import { describe, expect, it } from "vitest";
import type { Engagement } from "@/lib/domain/types";
import { defaultInboxQuery } from "@/lib/work-inbox";
import { defaultWorkbenchQuery } from "@/lib/workbench-presentation";
import { readWorkspaceLink } from "@/lib/workspace-links";
import {
  historyMethod,
  viewSearchTerm,
  workspaceParams,
  type WorkspaceLocation,
} from "./workspace-url";

const engagement = {
  id: "e1",
  workflow: { procedures: [{ id: "pr1" }] },
} as unknown as Engagement;
const base: WorkspaceLocation = {
  tenantId: "t1",
  engagement,
  role: "Lead Auditor",
  view: "Overview",
  paperId: null,
  paperTarget: undefined,
  record: undefined,
  procedureContext: undefined,
  procedureSection: undefined,
  reportSection: "packages",
  evidenceTab: "files",
  displayedEvidenceTab: "files",
  requestFilter: "all",
  inboxQuery: defaultInboxQuery,
  workbenchQuery: defaultWorkbenchQuery,
  search: "",
  filter: "all",
  facet: "all",
  sort: "program",
  paperStatus: "all",
};
const query = (location: Partial<WorkspaceLocation>) =>
  workspaceParams({ ...base, ...location }).params.toString();

describe("workspaceParams", () => {
  it("serialises a view with only the parameters that are set", () => {
    expect(query({})).toBe("practice=t1&engagement=e1&view=Overview");
    expect(query({ engagement: null, view: "Clients" })).toBe(
      "practice=t1&view=Clients",
    );
  });

  it("links an open paper with its section, objective by default", () => {
    const paper = workspaceParams({
      ...base,
      view: "Working papers",
      paperId: "p1",
    });
    expect(paper.kind).toBe("paper");
    expect(paper.recordId).toBe("p1");
    expect(paper.params.get("section")).toBe("objective");
    expect(
      query({ view: "Working papers", paperId: "p1", paperTarget: "evidence" }),
    ).toBe(
      "practice=t1&engagement=e1&view=Working+papers&kind=paper&record=p1&section=evidence",
    );
  });

  it("links the record open in the sheet by its kind", () => {
    const evidence = workspaceParams({
      ...base,
      view: "Evidence vault",
      record: { id: "a1", category: "Dataset" },
    });
    expect(evidence.kind).toBe("evidence");
    expect(evidence.recordId).toBe("a1");
    expect(evidence.params.get("section")).toBe("files");
  });

  it("links the audit program procedure unless a record is open", () => {
    expect(
      query({
        view: "Audit program",
        procedureContext: "pr1",
        procedureSection: "plan",
      }),
    ).toBe(
      "practice=t1&engagement=e1&view=Audit+program&kind=procedure&record=pr1&section=plan",
    );
    // A template has no link kind, and it still replaces the procedure link.
    const template = workspaceParams({
      ...base,
      view: "Audit program",
      procedureContext: "pr1",
      record: { id: "T-1", title: "Template", stage: "Plan" },
    });
    expect(template.kind).toBe("");
    expect(template.recordId).toBe("");
    // The procedure is only linked from the audit program.
    expect(query({ view: "Findings", procedureContext: "pr1" })).toBe(
      "practice=t1&engagement=e1&view=Findings",
    );
  });

  it("adds each view's own filters", () => {
    expect(
      query({
        view: "Evidence vault",
        evidenceTab: "requests",
        displayedEvidenceTab: "requests",
        requestFilter: "open",
        search: "card",
      }),
    ).toBe(
      "practice=t1&engagement=e1&view=Evidence+vault&section=requests&status=open&q=card",
    );
    expect(
      query({
        view: "Working papers",
        filter: "mine",
        paperStatus: "draft",
        facet: "Plan",
        sort: "due",
      }),
    ).toBe(
      "practice=t1&engagement=e1&view=Working+papers&queue=mine&status=draft&stage=Plan&sort=due",
    );
    expect(
      query({
        view: "My work",
        inboxQuery: { ...defaultInboxQuery, scope: "team", search: "x" },
      }),
    ).toBe("practice=t1&engagement=e1&view=My+work&workScope=team&q=x");
    expect(
      query({ view: "Reports & sign-off", reportSection: "completion" }),
    ).toBe(
      "practice=t1&engagement=e1&view=Reports+%26+sign-off&section=completion",
    );
  });

  it("keeps a workbench procedure only while it exists", () => {
    const workbench = { ...defaultWorkbenchQuery, section: "execution" };
    expect(
      query({
        view: "Assurance workbench",
        workbenchQuery: workbench,
        procedureContext: "pr1",
      }),
    ).toBe(
      "practice=t1&engagement=e1&view=Assurance+workbench&section=execution&procedure=pr1",
    );
    expect(
      query({
        view: "Assurance workbench",
        workbenchQuery: workbench,
        procedureContext: "gone",
      }),
    ).toBe(
      "practice=t1&engagement=e1&view=Assurance+workbench&section=execution",
    );
  });

  it("round-trips through readWorkspaceLink", () => {
    const params = workspaceParams({
      ...base,
      view: "Findings",
      record: { id: "f1", riskScore: 9 },
    }).params;
    expect(readWorkspaceLink("?" + params)).toEqual({
      tenantId: "t1",
      engagementId: "e1",
      module: "Findings",
      kind: "finding",
      recordId: "f1",
      section: "",
    });
  });
});

describe("historyMethod", () => {
  /** The URL the workspace wrote for a location. */
  const previousOf = (next: Partial<WorkspaceLocation>) => "/?" + query(next);
  const change = (
    previousUrl: string,
    next: Partial<WorkspaceLocation>,
    restoring = false,
  ) => {
    const location = { ...base, ...next },
      { params, kind, recordId } = workspaceParams(location);
    return historyMethod({
      previousUrl,
      params,
      view: location.view,
      kind,
      recordId,
      searchTerm: viewSearchTerm(location),
      restoring,
    });
  };

  it("replaces the first entry and restored links", () => {
    expect(change("", { view: "Findings" })).toBe("replaceState");
    expect(change("/?view=Overview", { view: "Findings" }, true)).toBe(
      "replaceState",
    );
  });

  it("pushes a new entry for a new view or record", () => {
    expect(change("/?view=Overview", { view: "Findings" })).toBe("pushState");
    expect(
      change("/?view=Working+papers", {
        view: "Working papers",
        paperId: "p1",
      }),
    ).toBe("pushState");
  });

  it("replaces while typing a search in a searchable view", () => {
    expect(
      change("/?practice=t1&engagement=e1&view=Working+papers&q=da", {
        view: "Working papers",
        search: "dat",
      }),
    ).toBe("replaceState");
    expect(
      change("/?practice=t1&engagement=e1&view=Evidence+vault&q=da", {
        view: "Evidence vault",
        search: "dat",
      }),
    ).toBe("replaceState");
    expect(
      change(previousOf({ view: "My work" }), {
        view: "My work",
        inboxQuery: { ...defaultInboxQuery, search: "d" },
      }),
    ).toBe("replaceState");
    // Findings keeps its search out of the URL, so a change there is new.
    expect(
      change("/?practice=t1&engagement=e1&view=Findings&q=da", {
        view: "Findings",
        search: "dat",
      }),
    ).toBe("pushState");
    // Arriving from another view is a new entry even with a search.
    expect(
      change("/?practice=t1&engagement=e1&view=Overview", {
        view: "Working papers",
        search: "dat",
      }),
    ).toBe("pushState");
  });

  it("pushes when the engagement or practice changes during a search", () => {
    const other = { ...engagement, id: "e2" } as Engagement;
    for (const view of ["Evidence vault", "Working papers"]) {
      const previous = previousOf({ view, search: "da" });
      // The same search in another engagement, or cleared on the switch.
      expect(change(previous, { view, search: "da", engagement: other })).toBe(
        "pushState",
      );
      expect(change(previous, { view, engagement: other })).toBe("pushState");
      expect(change(previous, { view, search: "da", tenantId: "t2" })).toBe(
        "pushState",
      );
      // Typing on in the same engagement still replaces.
      expect(change(previous, { view, search: "dat" })).toBe("replaceState");
    }
  });

  it("replaces when moving between sections of the same paper", () => {
    const previous =
      "/?practice=t1&engagement=e1&view=Working+papers&kind=paper&record=p1&section=objective";
    expect(
      change(previous, {
        view: "Working papers",
        paperId: "p1",
        paperTarget: "evidence",
      }),
    ).toBe("replaceState");
    expect(
      change(previous, {
        view: "Working papers",
        paperId: "p2",
        paperTarget: "evidence",
      }),
    ).toBe("pushState");
  });
});
