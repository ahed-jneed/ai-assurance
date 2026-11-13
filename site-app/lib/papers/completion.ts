// The completion and issue-authorisation memo (MEM-SO-01) as a working-paper
// contract document. The memo is recorded at release, not prepared and signed
// as a paper (lib/domain/release-time.ts): the independent approval and the
// release cover the exact package hashes. Once a final package is released,
// the dossier and the report package export this record as the memo, citing
// the engagement quality reviewer's sign-off of the same package (#24).
//
// The memo is not part of the hashed snapshot, so it is built only from what
// cannot change after release: the snapshot's workflow, title and
// classification, the engagement's fixed id, client and rule-pack stamp, the
// release completion and the sign-offs themselves. Replacing the quality
// reviewer, saving the checklist again or revising the brief for a successor
// report leaves the memo of an earlier release unchanged.
//
// Release.completion.templateIds also names WP-RP-02 (completion, issue and
// immutable package). It gets no document of its own: the release records it
// as completed with the same approval, release and package hashes, which this
// memo already carries.
import catalog from "../catalog.json";
import { packFeatures } from "../criteria/pin";
import {
  releaseChecklistLines,
  type Engagement,
  type Paper,
  type Report,
} from "../domain";
import {
  paperContentDigest,
  paperRevision,
  scopeContext,
  type MemoRecords,
  type PaperRevision,
  type ScopeSource,
} from "./revision";

const templateId = "MEM-SO-01";

/**
 * The quality reviewer's sign-offs of this exact package, if any. The
 * reviewer and checklist revision are the latest sign-off's own, not the live
 * review's, which a replacement or a later checklist save changes.
 */
function packageSignOffs(e: Engagement, r: Report) {
  const signOffs = (e.qualityReview?.signOffs ?? []).filter(
      (s) =>
        s.reportId === r.id &&
        s.internalHash === r.sha256 &&
        s.clientHash === r.clientSha256,
    ),
    last = signOffs.at(-1);
  if (!last) return undefined;
  return {
    reviewerId: last.userId,
    checklistRevision: last.checklistRevision,
    signOffs: structuredClone(signOffs),
  };
}

/** The engagement as the report captured it; null before the contract. */
function capturedScope(e: Engagement, r: Report): ScopeSource | null {
  const s = r.snapshot as {
    workflow?: Engagement["workflow"] | null;
    engagement?: Partial<Pick<Engagement, "title" | "classification">>;
  };
  // A pack without AI Act classification (#133) captures none; its
  // engagement keeps the unused classification it was created with.
  const title = s.engagement?.title,
    classification =
      s.engagement?.classification ??
      (packFeatures(e).aiActClassification ? undefined : e.classification);
  if (typeof title !== "string" || !classification) return null;
  return {
    // Written once at creation.
    id: e.id,
    clientId: e.clientId,
    rulePack: e.rulePack,
    criteria: e.criteria,
    // As captured.
    title,
    classification,
    workflow: s.workflow ?? null,
  };
}

/**
 * The MEM-SO-01 document of a released final package, or null before its
 * release recorded the completion.
 */
export async function completionMemo(
  e: Engagement,
  r: Report,
  tenantId: string,
): Promise<PaperRevision | null> {
  const completion = r.release?.completion,
    template = catalog.items.find((t) => t.id === templateId);
  const scope = capturedScope(e, r);
  if (!completion || !template || !scope) return null;
  const qualityReview = packageSignOffs(e, r),
    signOffs = qualityReview?.signOffs ?? [],
    records: MemoRecords = {
      ...(qualityReview ? { qualityReview } : {}),
      releaseCompletion: { reportId: r.id, ...completion },
    };
  const memo: Paper = {
    id: r.id + "-" + templateId,
    templateId,
    title: template.title,
    kind: "memo",
    stage: template.stage,
    articleRefs: template.regulatoryRefs,
    required: false,
    revision: 1,
    authorId: completion.releasedBy,
    contributors: [],
    updatedAt: completion.releasedAt,
    status: "signed",
    audience: "internal",
    body: {
      objective: template.objective,
      scope: "Final report package " + r.id + ", captured " + r.createdAt,
      criteria:
        "The final package gates, the independent release approval and, where the engagement requires it, the engagement quality review",
      procedures: template.procedures.map((p) => p.text).join("\n"),
      sampling: "",
      results: [
        "Independent approval: " +
          completion.approvedBy +
          " at " +
          completion.approvedAt,
        "Release: " + completion.releasedBy + " at " + completion.releasedAt,
        // The completion checklist the approver answered (#94); approvals
        // recorded before it say so.
        ...(completion.checklist
          ? releaseChecklistLines(completion.checklist).map(
              (line) => "Completion checklist: " + line,
            )
          : ["Completion checklist: not recorded with this approval"]),
        ...(signOffs.length
          ? signOffs.map(
              (s) =>
                "Engagement quality review sign-off: " +
                s.userId +
                " at " +
                s.at +
                " (checklist revision " +
                s.checklistRevision +
                "): " +
                s.conclusion,
            )
          : ["Engagement quality review: no sign-off of this package"]),
      ].join("\n"),
      limitations: "",
      conclusion:
        "Issue authorised: the independent approval and the release cover internal package SHA-256 " +
        completion.internalHash +
        " and client package SHA-256 " +
        completion.clientHash +
        ".",
      conclusionStatus: "supported",
    },
    evidenceIds: [],
    runIds: [],
    comments: [],
    reviews: [],
    signatures: [],
    history: [],
  };
  // The memo cites only the release records, and no evidence or runs.
  const d = await paperRevision(memo, {
    ...scopeContext(scope, tenantId),
    artifacts: [],
    runs: [],
    findings: [],
    records,
  });
  // The approvals are the release decisions, bound to the package they cover;
  // the evidence is the package itself.
  const approval = (
    actorId: string,
    role: PaperRevision["approvals"][number]["role"],
    approvedAt: string,
    signatureReference: string,
  ) => ({
    actorId,
    role,
    decision: "approve" as const,
    revision: 1,
    contentDigest: completion.internalHash,
    approvedAt,
    signatureReference,
  });
  d.approvals = [
    approval(
      completion.approvedBy,
      "reviewer",
      completion.approvedAt,
      "release-approval:" + r.id,
    ),
    ...signOffs.map((s) =>
      approval(
        s.userId,
        "engagement_quality_reviewer",
        s.at,
        "quality-review-sign-off:" + r.id + ":c" + s.checklistRevision,
      ),
    ),
    approval(
      completion.releasedBy,
      "lead_auditor",
      completion.releasedAt,
      "release:" + r.id,
    ),
  ];
  d.evidence = (
    [
      ["internal", completion.internalHash],
      ["client", completion.clientHash],
    ] as const
  ).map(([audience, sha256]) => ({
    artifactVersionId: r.id + "/" + audience,
    sha256,
    source: "Captured " + audience + " report package " + r.id,
    custodian: r.actor,
    period: "",
    systemVersion: "",
    assertions: [],
    reliability: "Package hash verified at release",
    completeness: "",
    limitations: [],
  }));
  d.evaluation.evidenceSufficiency = "sufficient";
  d.evaluation.limitations = [];
  // Composed by the application from the human release decisions.
  d.provenance.contentOrigin = "hybrid";
  d.provenance.contentDigest = await paperContentDigest(memo);
  return d;
}
