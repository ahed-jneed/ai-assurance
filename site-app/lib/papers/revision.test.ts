// Every paper the app can produce leaves it as a document the working-paper
// contract accepts: the catalog's working papers and memos in each state, a
// revised and a superseded paper, with the memo records #23 and #24 add. The
// documents are checked by schemas/validate-working-paper-schema.mjs, the
// validator CI runs, and read back into the app's terms.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import catalog from "../catalog.json";
import type { Engagement, Paper } from "../domain/types";
import {
  approvedWorkflow,
  artifact,
  at,
  completedQualityReview,
  finding,
  run,
  structuredEngagement,
  templatePaper,
} from "../workflow/test-fixtures";
import {
  paperContentDigest,
  paperContext,
  paperFromRevision,
  paperRevision,
  paperRevisions,
  type PaperRevision,
} from "./revision";

const later = "2026-11-05T11:00:00.000Z",
  latest = "2026-11-05T12:00:00.000Z";
const states = ["draft", "in_review", "reviewed", "signed"] as const;

/** A paper of `templateId` worked to `state` the way the paper commands do. */
async function worked(
  templateId: string,
  state: (typeof states)[number],
): Promise<Paper> {
  const p = templatePaper(templateId, "auditor");
  if (state === "draft") {
    p.comments.push({
      id: "COMMENT-" + p.id,
      authorId: "reviewer",
      text: "Which population does the scope cover?",
      resolved: false,
      createdAt: later,
    });
    return p;
  }
  Object.assign(p.body, {
    scope: "Scoring service, 1 Jan to 30 Sep 2026",
    criteria: (p.body.criteria || "Engagement criteria") + "; approved brief",
    procedures: "Inspected the evidence and reperformed the key controls",
    sampling: "Complete population of 12 change tickets",
    results: "No exceptions",
    limitations: templateId.startsWith("MEM") ? "" : "Grey-box access only",
    conclusion: "The control operated as described throughout the period",
    conclusionStatus:
      templateId === "WP-A13-02" ? "not_applicable" : "supported",
  });
  p.evidenceIds = ["EV-1"];
  p.runIds = templateId === "WP-A10-01" ? ["RUN-1"] : [];
  p.comments.push({
    id: "COMMENT-" + p.id,
    authorId: "reviewer",
    text: "Attach the reperformance worksheet",
    resolved: true,
    createdAt: later,
    responses: [{ actor: "auditor", at: later, text: "Attached as EV-1" }],
    resolvedAt: later,
  });
  p.status = "in_review";
  if (state === "in_review") return p;
  p.reviews.push({ userId: "reviewer", revision: p.revision, at: later });
  p.status = "reviewed";
  if (state === "reviewed") return p;
  p.signatures.push({
    userId: "lead",
    revision: p.revision,
    at: latest,
    hash: await paperContentDigest(p),
  });
  p.status = "signed";
  return p;
}

async function seededEngagement(): Promise<Engagement> {
  const e = structuredEngagement({
    workflow: approvedWorkflow(),
    artifacts: [artifact({ id: "EV-1" })],
    runs: [
      run({
        id: "RUN-1",
        provenance: {
          inputHashes: { manifest: "e".repeat(64) },
          runnerVersion: "interactive-predictions-3.0.0",
          policyVersion: "1.0",
        },
      }),
    ],
    qualityReview: completedQualityReview(),
  });
  for (const t of catalog.items)
    for (const state of states) e.papers.push(await worked(t.id, state));
  // A paper revised after review and a signed paper a recompiled
  // procedure superseded.
  const revised = await worked("WP-A10-02", "in_review");
  revised.history.push({
    revision: 1,
    body: { ...revised.body },
    authorId: "auditor",
    at,
    evidenceIds: [],
    runIds: [],
    reviews: [],
    signatures: [],
    contributors: [],
  });
  Object.assign(revised, { revision: 2, updatedAt: latest });
  revised.comments[0].createdAt = later;
  const old = await worked("WP-A13-01", "signed"),
    successor = await worked("WP-A13-01", "in_review");
  Object.assign(old, { supersededBy: successor.id, supersededAt: latest });
  successor.supersedes = old.id;
  e.papers.push(revised, old, successor);
  e.findings.push(
    finding({
      id: "F-1",
      support: {
        findingId: "F-1",
        procedureId: "PROC-1",
        paperIds: [revised.id],
        evidenceIds: ["EV-1"],
        runIds: [],
        actor: "auditor",
        at,
      },
    }),
  );
  return e;
}

const directory = mkdtempSync(path.join(tmpdir(), "working-papers-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const validator = fileURLToPath(
  new URL(
    "../../../schemas/validate-working-paper-schema.mjs",
    import.meta.url,
  ),
);
/** Runs the schema's own validator over the documents. */
function validate(documents: unknown[]) {
  const file = path.join(directory, "documents-" + Math.random() + ".json");
  writeFileSync(file, JSON.stringify({ documents }));
  return spawnSync(process.execPath, [validator, "--documents", file], {
    encoding: "utf8",
  });
}

describe("the working-paper contract export", async () => {
  const e = await seededEngagement(),
    releaseCompletion = {
      reportId: "REPORT-1",
      templateIds: ["WP-RP-02", "MEM-SO-01"],
      internalHash: "1".repeat(64),
      clientHash: "2".repeat(64),
      approvedBy: "reviewer",
      approvedAt: latest,
      releasedBy: "lead",
      releasedAt: latest,
    },
    qualityReview = {
      reviewerId: "quality-reviewer",
      checklistRevision: 2,
      signOffs: [
        {
          reportId: "REPORT-1",
          internalHash: "1".repeat(64),
          clientHash: "2".repeat(64),
          checklistRevision: 2,
          conclusion: "No significant matter remains unresolved",
          userId: "quality-reviewer",
          at: later,
        },
      ],
    },
    context = paperContext(e, "tenant-1", {
      qualityReview,
      releaseCompletion,
    }),
    exported = await paperRevisions(e.papers, context),
    documents = exported.documents;
  const byPaper = new Map(documents.map((d) => [d.id, d]));

  it("covers every catalog item in every state", () => {
    expect(exported.schema).toBe("urn:ai-assurance:working-paper:2.1");
    const kinds = new Set(catalog.items.map((t) => t.kind));
    expect(kinds).toEqual(new Set(["working_paper", "memo"]));
    expect(catalog.items.filter((t) => t.kind === "memo")).toHaveLength(12);
    for (const t of catalog.items)
      expect(
        new Set(
          documents.filter((d) => d.catalogId === t.id).map((d) => d.status),
        ),
      ).toEqual(
        new Set(
          ["draft", "submitted", "reviewed", "sealed"].concat(
            t.id === "WP-A13-01" ? ["superseded"] : [],
          ),
        ),
      );
  });

  it("projects into documents the schema validator accepts", () => {
    const result = validate(documents);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS working-paper contract");
  });

  it("is checked by a validator that rejects a malformed document", () => {
    const sealed = documents.find((d) => d.status === "sealed")!;
    const broken = structuredClone(sealed) as Partial<PaperRevision>;
    delete broken.narrative;
    expect(validate([broken]).status).not.toBe(0);
    expect(
      validate([
        { ...structuredClone(sealed), approvals: sealed.approvals.slice(1) },
      ]).status,
    ).not.toBe(0);
  });

  it("reads each document back into the paper it came from", () => {
    for (const p of e.papers) {
      const d = JSON.parse(JSON.stringify(byPaper.get(p.id))) as PaperRevision;
      expect(paperFromRevision(d)).toEqual({
        id: p.id,
        templateId: p.templateId,
        kind: p.kind,
        title: p.title,
        stage: p.stage,
        revision: p.revision,
        status: p.status,
        superseded: !!p.supersededBy,
        audience: p.kind === "memo" ? "internal" : "client",
        ...(p.supersedes ? { supersedes: p.supersedes } : {}),
        authorId: p.authorId,
        updatedAt: p.updatedAt,
        body: p.body,
        evidenceIds: p.evidenceIds,
        runIds: p.runIds,
        reviews: p.reviews,
        signatures: p.signatures,
        commentIds: p.comments.map((c) => c.id),
      });
    }
  });

  it("keeps the memo narrative and the records each memo rests on", () => {
    const memos = documents.filter((d) => d.kind === "memo");
    expect(memos).toHaveLength(12 * states.length);
    for (const d of memos) {
      const p = e.papers.find((p) => p.id === d.id)!;
      expect(d.narrative).toEqual(p.body);
    }
    const acceptance = memos.find((d) => d.catalogId === "MEM-AC-01")!;
    const { history, contributors, ...accepted } = e.workflow!.acceptance!;
    expect(history).toEqual([]);
    expect(contributors).toEqual(["lead"]);
    expect(acceptance.records).toEqual({
      acceptance: accepted,
      declarations: e.workflow!.declarations,
    });
    const completion = memos.find((d) => d.catalogId === "MEM-SO-01")!;
    expect(completion.records).toEqual({ qualityReview, releaseCompletion });
    expect(
      documents
        .filter((d) => !["MEM-AC-01", "MEM-SO-01"].includes(d.catalogId))
        .every((d) => d.records === undefined),
    ).toBe(true);
  });

  it("binds approvals to the signed content and keeps the review trail", async () => {
    const signed = e.papers.find(
      (p) => p.templateId === "WP-A10-01" && p.status === "signed",
    )!;
    const d = byPaper.get(signed.id)!;
    const digest = await paperContentDigest(signed);
    expect(d.provenance.contentDigest).toBe(digest);
    expect(
      d.approvals.map((a) => [a.role, a.actorId, a.contentDigest]),
    ).toEqual([
      ["reviewer", "reviewer", digest],
      ["lead_auditor", "lead", digest],
    ]);
    expect(d.runReferences).toEqual([
      expect.objectContaining({
        runId: "RUN-1",
        manifestDigest: "e".repeat(64),
      }),
    ]);
    expect(d.reviewComments).toEqual([
      expect.objectContaining({
        state: "resolved",
        resolvedBy: "reviewer",
        response: "Attached as EV-1",
      }),
    ]);
    const draft = documents.find(
      (d) => d.catalogId === "WP-A10-01" && d.status === "draft",
    )!;
    expect(draft.reviewComments[0].state).toBe("open");
    expect(draft.evaluation.evidenceSufficiency).toBe("not_assessed");
    const revised = documents.find(
      (d) => d.catalogId === "WP-A10-02" && d.revision === 2,
    )!;
    // The comment was raised on revision 1, before revision 2 started.
    expect(revised.reviewComments[0].revision).toBe(1);
    expect(revised.evaluation.findingIds).toEqual(["F-1"]);
    const excluded = documents.find(
      (d) => d.catalogId === "WP-A13-02" && d.status === "sealed",
    )!;
    expect(excluded.applicability).toMatchObject({
      state: "not_applicable",
      approvedBy: "lead",
    });
  });

  it("names a missing linked record as a limitation instead of inventing it", async () => {
    const p = await worked("WP-A10-01", "signed");
    p.evidenceIds = ["EV-gone"];
    const d = await paperRevision(p, context);
    expect(d.evidence).toEqual([]);
    expect(d.evaluation.limitations).toContain(
      "Linked evidence EV-gone is not held by the engagement",
    );
    expect(d.evaluation.evidenceSufficiency).toBe("limited");
  });
});
