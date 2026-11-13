/* eslint-disable @typescript-eslint/no-explicit-any -- the fixtures are partial records, as the workspace receives them. */
// Workspace search, the register selectors and report package labels.
// Ported from scripts/usability-check.mjs (#52).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  paperRows,
  evidenceRows,
  findingRows,
  reportRows,
} from "./register-views";
import {
  packageStatus,
  packageStatusLabel,
  packageOpenLabel,
} from "./report-presentation";
import { workspaceSearch } from "./workspace-search";

const data: any = {
  identity: { role: "Lead Auditor" },
  clients: [
    { id: "client-1", name: "Müller Analytics", sector: "Manufacturing" },
  ],
  engagements: [
    {
      id: "eng-1",
      title: "Credit model review",
      client_id: "client-1",
      stage: "Planning",
    },
  ],
  catalog: {
    items: [
      {
        id: "MEM-01",
        title: "Fairness memo",
        kind: "memo",
        stage: "Reporting",
      },
    ],
  },
  engagement: {
    papers: [
      {
        id: "paper-1",
        title: "Fairness review",
        templateId: "WP-10",
        stage: "Fieldwork",
        articleRefs: ["Art.10"],
      },
    ],
    artifacts: [
      { id: "evidence-1", name: "Prediction sample", category: "Dataset" },
    ],
    findings: [
      {
        id: "finding-1",
        title: "Group disparity",
        severity: "High",
        status: "open",
        owner: "Review team",
      },
    ],
    reports: [
      {
        id: "report-1",
        kind: "final",
        createdAt: "2026-10-05T00:00:00Z",
        snapshot: {
          opinion: "Qualified conclusion",
          summary: "Fairness exceptions",
        },
      },
    ],
  },
};

const q = { view: "all", facet: "all", search: "", sort: "program" };

describe("workspace search and registers (ported from usability-check)", () => {
  it("authorized workspace search, scope, role restrictions and accent-insensitive matching", async () => {
    assert.equal(workspaceSearch(data, "muller")[0].id, "client-1");
    assert.deepEqual(
      workspaceSearch(data, "fairness fieldwork").map((r) => r.id),
      ["paper-1"],
    );
    assert(
      workspaceSearch(data, "fairness").some((r) => r.kind === "template"),
    );
    assert(workspaceSearch(data, "").every((r) => r.kind === "page"));
    const viewer: any = { ...data, identity: { role: "Client Viewer" } };
    assert(
      !workspaceSearch(viewer, "fairness").some((r) =>
        ["paper", "template"].includes(r.kind),
      ),
    );
    assert(
      !workspaceSearch(viewer, "").some((r) =>
        [
          "Working papers",
          "Testing lab",
          "Regulatory mapping",
          "Methodology",
        ].includes(r.id),
      ),
    );
    assert(
      workspaceSearch(data, "assurance").some(
        (r) => r.kind === "page" && r.id === "Assurance workbench",
      ),
    );
    assert(
      workspaceSearch(data, "members").some(
        (r) => r.id === "Users & access" && r.label === "Members & access",
      ),
    );
    assert(
      !workspaceSearch(viewer, "").some((r) =>
        ["Audit program", "Assurance workbench"].includes(r.id),
      ),
    );
    assert(
      !workspaceSearch(
        { ...viewer, identity: { role: "Client Contributor" } },
        "assurance",
      ).some((r) => r.id === "Assurance workbench"),
    );
    assert(
      !workspaceSearch({ ...data, engagement: null }, "fairness").some((r) =>
        ["paper", "evidence", "finding", "report", "template"].includes(r.kind),
      ),
    );
    assert(
      !workspaceSearch(
        { ...data, engagement: { ...data.engagement, papers: [] } },
        "fairness",
      ).some((r) => r.id === "paper-1"),
    );
    assert.equal(
      workspaceSearch(data, "Prediction sample")[0].id,
      "evidence-1",
    );
  });

  it("combined register filters, stable ordering and nonmutating selectors", async () => {
    const papers: any[] = [
      {
        id: "a",
        title: "Zeta",
        templateId: "WP-1",
        stage: "Planning",
        articleRefs: [],
        status: "draft",
        updatedAt: "2026-10-05",
      },
      {
        id: "b",
        title: "Alpha",
        templateId: "WP-2",
        stage: "Fieldwork",
        articleRefs: ["Art.10"],
        status: "in_review",
        updatedAt: "2026-10-06",
      },
    ];
    assert.deepEqual(
      paperRows(papers, {
        ...q,
        view: "in_review",
        facet: "Fieldwork",
        search: "Art.10",
      }).map((p) => p.id),
      ["b"],
    );
    assert.deepEqual(
      paperRows(papers, { ...q, sort: "name_asc" }).map((p) => p.id),
      ["b", "a"],
    );
    assert.deepEqual(
      papers.map((p) => p.id),
      ["a", "b"],
    );
    const evidence: any[] = [
      {
        id: "a",
        name: "Older",
        category: "Dataset",
        status: "accepted",
        createdAt: "2026-10-05",
      },
      {
        id: "b",
        name: "Newer",
        category: "Model",
        status: "unverified",
        createdAt: "2026-10-06",
      },
    ];
    assert.deepEqual(
      evidenceRows(evidence, {
        ...q,
        view: "accepted",
        facet: "Dataset",
        sort: "newest",
      }).map((p) => p.id),
      ["a"],
    );
    const findings: any[] = [
      {
        id: "a",
        title: "Open high",
        severity: "High",
        status: "open",
        riskScore: 15,
        owner: "Audit",
        dueDate: "2026-10-08",
      },
      {
        id: "b",
        title: "Closed critical",
        severity: "Critical",
        status: "closed",
        riskScore: 25,
        owner: "Audit",
        dueDate: "2026-10-07",
      },
      {
        id: "c",
        title: "No date Z",
        severity: "Low",
        status: "open",
        riskScore: 2,
        owner: "Audit",
        dueDate: "",
      },
      {
        id: "d",
        title: "No date A",
        severity: "Low",
        status: "open",
        riskScore: 2,
        owner: "Audit",
        dueDate: "",
      },
    ];
    assert.deepEqual(
      findingRows(findings, { ...q, view: "high", sort: "risk" }).map(
        (p) => p.id,
      ),
      ["a"],
    );
    assert.deepEqual(
      findingRows(findings, { ...q, view: "open", sort: "due" }).map(
        (p) => p.id,
      ),
      ["a", "d", "c"],
    );
    assert.deepEqual(
      reportRows(data.engagement.reports, {
        ...q,
        view: "final",
        search: "Qualified",
      }).map((r) => r.id),
      ["report-1"],
    );
  });

  it("package lifecycle filters, captured-date ordering, client projection labels and independent approval/release guidance", async () => {
    const packageFixtures: any[] = [
      {
        id: "draft",
        kind: "draft",
        actor: "author",
        createdAt: "2026-10-01",
        snapshot: { opinion: "Readiness assessment" },
      },
      {
        id: "internal",
        kind: "final",
        actor: "author",
        createdAt: "2026-10-02",
        snapshot: { opinion: "Qualified conclusion", workflow: {} },
      },
      {
        id: "approved",
        kind: "final",
        actor: "author",
        createdAt: "2026-10-03",
        snapshot: { opinion: "Qualified conclusion", workflow: {} },
        release: { state: "approved", approval: { userId: "reviewer" } },
      },
      {
        id: "released",
        kind: "final",
        actor: "author",
        createdAt: "2026-10-04",
        snapshot: { opinion: "Qualified conclusion" },
        release: { state: "released" },
      },
      {
        id: "withdrawn",
        kind: "final",
        actor: "author",
        createdAt: "2026-10-05",
        snapshot: { opinion: "Adverse conclusion" },
        release: { state: "withdrawn" },
      },
      {
        id: "superseded",
        kind: "final",
        actor: "author",
        createdAt: "2026-10-06",
        snapshot: { opinion: "Qualified conclusion" },
        release: { state: "superseded" },
      },
    ];
    assert.equal(packageStatus(packageFixtures[0]), "draft");
    assert.equal(packageStatusLabel(packageFixtures[1]), "Awaiting approval");
    assert.equal(
      packageOpenLabel(packageFixtures[1], "Reviewer", "reviewer"),
      "Review approval",
    );
    assert.equal(
      packageOpenLabel(packageFixtures[1], "Reviewer", "author"),
      "Review package",
    );
    assert.equal(
      packageOpenLabel(packageFixtures[2], "Lead Auditor", "other-lead"),
      "Review release",
    );
    assert.equal(
      packageOpenLabel(packageFixtures[2], "Lead Auditor", "reviewer"),
      "Review package",
    );
    assert.equal(
      packageStatusLabel(packageFixtures[1], true),
      "Released to client",
    );
    assert.equal(
      packageOpenLabel(packageFixtures[3], "Client Viewer", "client"),
      "View report",
    );
    assert.deepEqual(
      reportRows(packageFixtures, {
        ...q,
        view: "final",
        facet: "Approved",
        search: "Qualified",
      }).map((r) => r.id),
      ["approved"],
    );
    assert.deepEqual(
      reportRows(packageFixtures, { ...q, facet: "Withdrawn" }).map(
        (r) => r.id,
      ),
      ["withdrawn"],
    );
    assert.deepEqual(
      reportRows(packageFixtures, { ...q, facet: "Superseded" }).map(
        (r) => r.id,
      ),
      ["superseded"],
    );
    assert.deepEqual(
      reportRows(packageFixtures, { ...q, sort: "oldest" }).map((r) => r.id),
      packageFixtures.map((r) => r.id),
    );
    assert.deepEqual(
      packageFixtures.map((r) => r.id),
      ["draft", "internal", "approved", "released", "withdrawn", "superseded"],
    );
  });
});
