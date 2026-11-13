import type { Report } from "./domain";
import type { PaperRevision } from "./papers/revision";

/** A working-paper contract document as a leaf of the package proof (#137). */
export type DocumentLeaf = {
  kind: "working_paper_document";
  id: string;
  revision: number;
  title: string;
  catalogId: string;
  status: PaperRevision["status"];
  sha256: string;
  /**
   * snapshot: captured in the hashed snapshot, so the snapshot digest covers
   * it. release_record: built at export from the release record (the
   * completion memo); outside the snapshot digest, it must bind the package.
   */
  basis: "snapshot" | "release_record";
  /** For a release-record document: it binds this package's hashes. */
  bindsPackage?: boolean;
};

/**
 * Whether a document built from the release record binds this exact package:
 * every approval covers the internal package hash and its evidence is the
 * internal and client package hashes.
 */
function bindsPackage(d: PaperRevision, report: Report) {
  const hashes = new Set(d.evidence.map((x) => x.sha256));
  return (
    d.approvals.length > 0 &&
    d.approvals.every((a) => a.contentDigest === report.sha256) &&
    hashes.has(report.sha256) &&
    (!report.clientSha256 || hashes.has(report.clientSha256))
  );
}

/**
 * The integrity proof of a captured report package.
 *
 * Proof 1.1 (#137) also lists every exported working-paper contract document
 * (#51) as a leaf, digested over the exact bytes the dossier files under
 * papers/: captured documents are inside the snapshot digest, and the
 * completion memo, built from the release record, must bind the package's
 * hashes. Packages captured before the contract have no documents, so their
 * leaves and manifest digest are as in proof 1.0.
 *
 * `documents` are the exported documents (lib/papers/export.ts); pass none
 * for the client audience, whose package carries no contract documents.
 */
export async function verifyPackage(
  report: Report,
  digest: (value: string) => Promise<string>,
  client = false,
  documents: readonly PaperRevision[] = [],
) {
  const snapshot = client ? report.clientSnapshot : report.snapshot,
    expected = client ? report.clientSha256 : report.sha256;
  if (!snapshot || !expected)
    throw Error(
      "This report has no captured package for the requested audience",
    );
  const actual = await digest(JSON.stringify(snapshot));
  const evidence = Array.isArray(snapshot.evidence)
    ? (snapshot.evidence as {
        id: string;
        sha256: string;
        name: string;
      }[])
    : [];
  const papers = Array.isArray(snapshot.papers)
    ? (snapshot.papers as {
        id: string;
        revision: number;
        title: string;
      }[])
    : [];
  const captured = (
      snapshot.workingPapers as { documents?: unknown } | undefined
    )?.documents,
    capturedDocuments = Array.isArray(captured)
      ? (captured as PaperRevision[])
      : [];
  const leaves: (
    | {
        kind: "working_paper" | "evidence";
        id: string;
        revision?: number;
        title: string;
        sha256: string;
      }
    | DocumentLeaf
  )[] = [];
  for (const p of papers)
    leaves.push({
      kind: "working_paper",
      id: p.id,
      revision: p.revision,
      title: p.title,
      sha256: await digest(JSON.stringify(p)),
    });
  for (const a of evidence)
    leaves.push({
      kind: "evidence",
      id: a.id,
      title: a.name,
      sha256: a.sha256,
    });
  const documentLeaf = (
    d: PaperRevision,
    sha256: string,
    basis: DocumentLeaf["basis"],
  ): DocumentLeaf => ({
    kind: "working_paper_document",
    id: d.id,
    revision: d.revision,
    title: d.title,
    catalogId: d.catalogId,
    status: d.status,
    sha256,
    basis,
    ...(basis === "release_record"
      ? { bindsPackage: bindsPackage(d, report) }
      : {}),
  });
  const documentLeaves: DocumentLeaf[] = [];
  for (const d of capturedDocuments)
    documentLeaves.push(
      documentLeaf(d, await digest(JSON.stringify(d)), "snapshot"),
    );
  // An exported document the snapshot does not hold was built from the
  // release record.
  const capturedHashes = new Set(documentLeaves.map((l) => l.sha256));
  for (const d of documents) {
    const sha256 = await digest(JSON.stringify(d));
    if (!capturedHashes.has(sha256))
      documentLeaves.push(documentLeaf(d, sha256, "release_record"));
  }
  leaves.push(...documentLeaves);
  // Stable: leaves of one id keep their captured order, as in proof 1.0.
  leaves.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
  const documentsBound = documentLeaves.every((l) => l.bindsPackage !== false);
  return {
    schemaVersion: "1.1",
    reportId: report.id,
    audience: client ? "client" : "internal",
    valid: actual === expected && documentsBound,
    expectedSha256: expected,
    actualSha256: actual,
    manifestSha256: await digest(JSON.stringify(leaves)),
    items: leaves,
    hashAlgorithm: "SHA-256",
    serialization:
      "JSON.stringify of the captured snapshot; property order preserved. A working-paper document leaf digests JSON.stringify of the document, the bytes the dossier files under papers/",
    scope:
      "Snapshot bytes and captured manifest references. Working-paper documents captured in the snapshot are covered by its digest; the completion memo is built from the release record and is accepted only when its approvals and evidence bind this package's hashes. Evidence bytes are verified on diagnostic input loading; this check does not re-read every stored file or establish external signing or timestamping.",
  };
}
