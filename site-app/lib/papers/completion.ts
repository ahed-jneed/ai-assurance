// The completion and issue-authorisation memo (MEM-SO-01) as a working-paper
// contract document. The memo is recorded at release, not prepared and signed
// as a paper (lib/domain/release-time.ts): the independent approval and the
// release cover the exact package hashes. Once a final package is released,
// the dossier and the report package export this record as the memo, citing
// the engagement quality reviewer's sign-off of the same package (#24).
import catalog from "../catalog.json";
import type { Engagement, Paper, Report } from "../domain";
import {
  paperContext,
  paperContentDigest,
  paperRevision,
  type MemoRecords,
  type PaperRevision,
} from "./revision";

const templateId = "MEM-SO-01";

/** The quality reviewer's sign-offs of this exact package, if any. */
function packageSignOffs(e: Engagement, r: Report) {
  const q = e.qualityReview;
  if (!q) return undefined;
  return {
    reviewerId: q.reviewerId,
    checklistRevision: q.revision,
    signOffs: q.signOffs.filter(
      (s) =>
        s.reportId === r.id &&
        s.internalHash === r.sha256 &&
        s.clientHash === r.clientSha256,
    ),
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
  if (!completion || !template) return null;
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
  const d = await paperRevision(memo, {
    ...paperContext(e, tenantId),
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
