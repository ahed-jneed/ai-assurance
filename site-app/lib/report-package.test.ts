// The report package proof (#137): it lists every exported working-paper
// document, covers the captured ones through the snapshot digest and accepts
// the completion memo only when it binds the package's hashes.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Engagement, Report } from "./domain";
import { exportedPapers } from "./papers/export";
import { paperContext, paperRevisions } from "./papers/revision";
import { verifyPackage } from "./report-package";
import {
  approvedWorkflow,
  at,
  completedQualityReview,
  structuredEngagement,
  templatePaper,
} from "./workflow/test-fixtures";

const digest = async (value: string) =>
  createHash("sha256").update(value).digest("hex");
const clientHash = "2".repeat(64);

async function releasedReport() {
  const e: Engagement = structuredEngagement({
    workflow: approvedWorkflow(),
    qualityReview: completedQualityReview({ signOffs: [] }),
  });
  e.papers.push(templatePaper("MEM-AC-01", "lead"));
  const snapshot = {
    workflow: structuredClone(e.workflow),
    engagement: {
      id: e.id,
      title: e.title,
      stage: e.stage,
      classification: structuredClone(e.classification),
    },
    papers: [{ id: "P-1", revision: 1, title: "Captured paper" }],
    evidence: [{ id: "EV-1", name: "data.csv", sha256: "e".repeat(64) }],
    workingPapers: await paperRevisions(e.papers, paperContext(e, "tenant-1")),
  };
  const internalHash = await digest(JSON.stringify(snapshot));
  const r: Report = {
    id: "REPORT-1",
    kind: "final",
    createdAt: at,
    actor: "lead",
    sha256: internalHash,
    clientSha256: clientHash,
    snapshot,
    release: {
      state: "released",
      completion: {
        templateIds: ["WP-RP-02", "MEM-SO-01"],
        internalHash,
        clientHash,
        approvedBy: "reviewer",
        approvedAt: "2026-11-05T14:00:00.000Z",
        releasedBy: "lead",
        releasedAt: "2026-11-05T15:00:00.000Z",
      },
      history: [],
    },
  };
  e.reports.push(r);
  const documents = await exportedPapers({ tenantId: "tenant-1" }, e, r);
  return { e, r, documents };
}

describe("the report package proof", () => {
  it("lists each exported document with the digest of its dossier bytes", async () => {
    const { r, documents } = await releasedReport();
    const proof = await verifyPackage(r, digest, false, documents);
    expect(proof.schemaVersion).toBe("1.1");
    expect(proof.valid).toBe(true);
    const leaves = proof.items.filter(
      (i) => i.kind === "working_paper_document",
    );
    // Leaves are sorted by kind and id.
    const byId = [...documents].sort((a, b) => a.id.localeCompare(b.id));
    expect(leaves).toEqual(
      await Promise.all(
        byId.map(async (d) => ({
          kind: "working_paper_document",
          id: d.id,
          revision: d.revision,
          title: d.title,
          catalogId: d.catalogId,
          status: d.status,
          // The dossier files papers/<id>-r<revision>.json as these bytes.
          sha256: await digest(JSON.stringify(d)),
          basis: d.catalogId === "MEM-SO-01" ? "release_record" : "snapshot",
          ...(d.catalogId === "MEM-SO-01" ? { bindsPackage: true } : {}),
        })),
      ),
    );
    expect(documents.map((d) => d.catalogId)).toEqual([
      "MEM-AC-01",
      "MEM-SO-01",
    ]);
    // The captured paper and the evidence stay leaves too.
    expect(proof.items.map((i) => i.kind)).toEqual([
      "evidence",
      "working_paper",
      "working_paper_document",
      "working_paper_document",
    ]);
  });

  it("lists the captured documents even without the exported ones", async () => {
    const { r } = await releasedReport();
    const proof = await verifyPackage(r, digest);
    expect(
      proof.items
        .filter((i) => i.kind === "working_paper_document")
        .map((i) => ["catalogId" in i && i.catalogId, "basis" in i && i.basis]),
    ).toEqual([["MEM-AC-01", "snapshot"]]);
  });

  it("covers a captured document through the snapshot digest", async () => {
    const { r, documents } = await releasedReport();
    const captured = (
      r.snapshot.workingPapers as { documents: { title: string }[] }
    ).documents[0];
    captured.title = "Altered after capture";
    const proof = await verifyPackage(r, digest, false, documents);
    expect(proof.valid).toBe(false);
    expect(proof.actualSha256).not.toBe(proof.expectedSha256);
  });

  it("refuses a completion memo that does not bind this package", async () => {
    const { r, documents } = await releasedReport();
    const memo = structuredClone(documents.at(-1)!);
    memo.approvals[0].contentDigest = "9".repeat(64);
    const proof = await verifyPackage(r, digest, false, [
      ...documents.slice(0, -1),
      memo,
    ]);
    expect(proof.actualSha256).toBe(proof.expectedSha256);
    expect(proof.valid).toBe(false);
    expect(proof.items.find((i) => i.id === memo.id)).toMatchObject({
      basis: "release_record",
      bindsPackage: false,
    });
  });

  it("keeps a package captured before the contract as in proof 1.0", async () => {
    const { r } = await releasedReport();
    delete r.snapshot.workingPapers;
    r.sha256 = await digest(JSON.stringify(r.snapshot));
    const proof = await verifyPackage(r, digest, false, []);
    expect(proof.valid).toBe(true);
    // Proof 1.0 leaves: the captured papers and evidence, sorted by kind.
    const legacy = [
      {
        kind: "evidence",
        id: "EV-1",
        title: "data.csv",
        sha256: "e".repeat(64),
      },
      {
        kind: "working_paper",
        id: "P-1",
        revision: 1,
        title: "Captured paper",
        sha256: await digest(
          JSON.stringify({ id: "P-1", revision: 1, title: "Captured paper" }),
        ),
      },
    ];
    expect(proof.items).toEqual(legacy);
    expect(proof.manifestSha256).toBe(await digest(JSON.stringify(legacy)));
  });

  it("lists no documents for the client audience", async () => {
    const { r } = await releasedReport();
    r.clientSnapshot = { papers: [], evidence: [] };
    r.clientSha256 = await digest(JSON.stringify(r.clientSnapshot));
    const proof = await verifyPackage(r, digest, true);
    expect(proof.valid).toBe(true);
    expect(proof.items).toEqual([]);
  });
});
