// The working-paper contract (#51): how a paper the app stores leaves it as a
// schemas/working-paper.schema.json `paperRevision` document. Report capture
// projects every captured paper (snapshot.workingPapers), and the dossier and
// the report package export those documents.
import catalog from "../catalog.json";
import { paperAudience } from "../client-projection";
import type { Artifact, Engagement, Finding, Paper, Run } from "../domain";
import type { QualityReview } from "../domain/quality-review";
import { sha256 } from "../ids";
import { currentRulePack, methodologyVersion } from "../rule-pack-current";
import type { Acceptance, Declaration, Release } from "../workflow-types";

/** The `$id` of the contract the documents follow. */
export const workingPaperContract = "urn:ai-assurance:working-paper:2.1";
/** The paperRevision version the app writes: with kind, narrative and memo records. */
export const paperRevisionVersion = "1.1.0";

export const narrativeSections = [
  "objective",
  "scope",
  "criteria",
  "procedures",
  "sampling",
  "results",
  "limitations",
  "conclusion",
] as const;
export const conclusionStatuses = [
  "not_evaluated",
  "supported",
  "qualified",
  "not_supported",
  "not_applicable",
] as const;
export type Narrative = Record<(typeof narrativeSections)[number], string> & {
  conclusionStatus: (typeof conclusionStatuses)[number];
};
type Approval = {
  actorId: string;
  role:
    "preparer" | "reviewer" | "lead_auditor" | "engagement_quality_reviewer";
  decision: "approve" | "return";
  revision: number;
  contentDigest: string;
  approvedAt: string;
  signatureReference: string;
};
type QualityReviewSignOff = QualityReview["signOffs"][number];
export type ReleaseCompletion = NonNullable<Release["completion"]> & {
  reportId: string;
};
/** The decision records a memo rests on (`$defs/memoRecords`). */
export type MemoRecords = {
  acceptance?: Omit<Acceptance, "history" | "contributors" | "approval"> & {
    approval: Acceptance["approval"] | null;
  };
  declarations?: Declaration[];
  qualityReview?: {
    reviewerId: string;
    checklistRevision: number;
    signOffs: QualityReviewSignOff[];
  };
  releaseCompletion?: ReleaseCompletion;
};
/** A schemas/working-paper.schema.json paperRevision, schemaVersion 1.1.0. */
export type PaperRevision = {
  schemaVersion: typeof paperRevisionVersion;
  id: string;
  tenantId: string;
  clientId: string;
  engagementId: string;
  catalogId: string;
  kind: "working_paper" | "memo";
  templateVersion: string;
  revision: number;
  status:
    "draft" | "submitted" | "reviewed" | "approved" | "sealed" | "superseded";
  stage: string;
  title: string;
  audience: "internal" | "client";
  scope: {
    systemId: string;
    modelVersionIds: string[];
    periodStart: string | null;
    periodEnd: string | null;
    rulePackId: string;
    operatorRoles: string[];
    criteria: string[];
    boundary: string;
    exclusions: string[];
  };
  applicability: {
    state: "pending" | "applicable" | "not_applicable" | "readiness";
    rationale: string;
    regulatoryReferences: string[];
    sourceVersion: string;
    approvedBy: string | null;
    approvedAt: string | null;
  };
  riskReferences: string[];
  procedures: {
    id: string;
    description: string;
    mode: "manual" | "automated" | "hybrid";
    criterion: {
      source: string;
      metric: null;
      operator: null;
      threshold: null;
      justification: string;
      policyVersion: null;
      approvedBy: null;
    };
    diagnosticState: "not_run";
    observation: string;
    sample: null;
    evidenceVersionIds: string[];
    runIds: string[];
    findingIds: string[];
  }[];
  evidence: {
    artifactVersionId: string;
    sha256: string;
    source: string;
    custodian: string;
    period: string;
    systemVersion: string;
    assertions: string[];
    reliability: string;
    completeness: string;
    limitations: string[];
  }[];
  runReferences: {
    runId: string;
    manifestArtifactVersionId: string;
    manifestDigest: string | null;
    testSuiteVersion: string;
    environmentDigest: null;
    inputArtifactVersionIds: string[];
    policyVersion: string;
    seed: number | null;
    warnings: string[];
  }[];
  evaluation: {
    evidenceSufficiency: "not_assessed" | "sufficient" | "limited";
    contradictions: string[];
    limitations: string[];
    auditorConclusion:
      | "not_assessed"
      | "supported"
      | "qualified"
      | "deficiency"
      | "not_applicable";
    rationale: string;
    findingIds: string[];
    managementResponseId: null;
    subsequentEventsThrough: null;
  };
  reviewComments: {
    id: string;
    revision: number;
    reviewerId: string;
    severity: "blocking";
    text: string;
    state: "open" | "responded" | "resolved";
    response: string;
    resolvedBy: string | null;
    resolution: string;
  }[];
  approvals: Approval[];
  narrative: Narrative;
  records?: MemoRecords;
  provenance: {
    createdBy: string;
    createdAt: string;
    contentOrigin: "human" | "hybrid";
    supersedesId: string | null;
    amendmentReason: null;
    contentDigest: string;
  };
};

/** What a projection reads besides the paper: the engagement it belongs to. */
export type PaperContext = {
  tenantId: string;
  clientId: string;
  engagementId: string;
  systemId: string;
  periodStart: string | null;
  periodEnd: string | null;
  boundary: string;
  operatorRole: string;
  rulePack: { version: string; legalVersion: string };
  templateVersion: string;
  artifacts: Pick<
    Artifact,
    "id" | "name" | "sha256" | "uploadedBy" | "status"
  >[];
  runs: Pick<Run, "id" | "datasetId" | "seed" | "reviewFlags" | "provenance">[];
  findings: Pick<Finding, "id" | "support">[];
  /** The records memos cite, where the engagement holds them. */
  records: MemoRecords;
};

const calendarDate = (v: string | undefined) =>
  v &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v + "T00:00:00Z")) &&
  new Date(v + "T00:00:00Z").toISOString().startsWith(v)
    ? v
    : null;
/** The acceptance record as a memo cites it: without its revision history. */
function citedAcceptance(a: Acceptance): MemoRecords["acceptance"] {
  const { history, contributors, approval, ...fields } = a;
  return { ...fields, approval: approval ?? null };
}

/** The projection context of a live engagement, as report capture reads it. */
export function paperContext(
  e: Engagement,
  tenantId: string,
  extra: Pick<MemoRecords, "qualityReview" | "releaseCompletion"> = {},
): PaperContext {
  const brief = e.workflow?.brief,
    acceptance = e.workflow?.acceptance,
    pack = e.rulePack ?? currentRulePack;
  return {
    tenantId,
    clientId: e.clientId,
    engagementId: e.id,
    systemId: brief?.systemName.trim() || e.title.trim() || e.id,
    periodStart: calendarDate(brief?.periodStart ?? acceptance?.periodStart),
    periodEnd: calendarDate(brief?.periodEnd ?? acceptance?.periodEnd),
    boundary: brief?.boundary ?? acceptance?.systemBoundary ?? "",
    operatorRole: e.classification.operatorRole,
    rulePack: { version: pack.version, legalVersion: pack.legalVersion },
    templateVersion: e.rulePack?.version ?? methodologyVersion,
    artifacts: e.artifacts,
    runs: e.runs,
    findings: e.findings,
    records: {
      ...(acceptance ? { acceptance: citedAcceptance(acceptance) } : {}),
      ...(e.workflow?.declarations
        ? { declarations: e.workflow.declarations }
        : {}),
      ...extra,
    },
  };
}

/** Which memo cites which records. */
const memoRecordKeys: Record<string, (keyof MemoRecords)[]> = {
  "MEM-AC-01": ["acceptance", "declarations"],
  "MEM-SO-01": ["qualityReview", "releaseCompletion"],
};
function memoRecords(templateId: string, records: MemoRecords): MemoRecords {
  return Object.fromEntries(
    (memoRecordKeys[templateId] ?? [])
      .filter((k) => records[k] !== undefined)
      .map((k) => [k, structuredClone(records[k])]),
  );
}

const operatorRoles: Record<string, string[]> = {
  Provider: ["provider"],
  Deployer: ["deployer"],
  "Provider and deployer": ["provider", "deployer"],
  "Importer / distributor": ["importer", "distributor"],
};
const auditorConclusion = {
  not_evaluated: "not_assessed",
  supported: "supported",
  qualified: "qualified",
  not_supported: "deficiency",
  not_applicable: "not_applicable",
} as const;
const exportedStatus = {
  draft: "draft",
  in_review: "submitted",
  reviewed: "reviewed",
  signed: "sealed",
} as const;
const appStatus = {
  draft: "draft",
  submitted: "in_review",
  reviewed: "reviewed",
  approved: "reviewed",
  sealed: "signed",
  superseded: "signed",
} as const;

/** The paper's narrative: the body sections, with an unknown status as not evaluated. */
function narrative(body: Record<string, string>): Narrative {
  const status = body.conclusionStatus as Narrative["conclusionStatus"];
  return {
    ...(Object.fromEntries(
      narrativeSections.map((k) => [k, body[k] ?? ""]),
    ) as Record<(typeof narrativeSections)[number], string>),
    conclusionStatus: conclusionStatuses.includes(status)
      ? status
      : "not_evaluated",
  };
}
/**
 * The digest a sign-off binds: SHA-256 over the revision's body, revision
 * number and linked evidence and runs, as signPaper computes it.
 */
export function paperContentDigest(
  p: Pick<Paper, "body" | "revision" | "evidenceIds" | "runIds">,
) {
  return sha256(
    JSON.stringify({
      body: p.body,
      revision: p.revision,
      evidenceIds: p.evidenceIds,
      runIds: p.runIds,
    }),
  );
}
/**
 * The revision a comment was raised on: the latest one started by then.
 * A revision starts when the paper is archived into it (its history entry,
 * or the paper's own updatedAt for the current one).
 */
function commentRevision(p: Paper, createdAt: string) {
  const starts = [
    ...p.history.map((h) => [h.revision, h.at] as const),
    [p.revision, p.updatedAt] as const,
  ];
  return (
    starts.filter(([, at]) => at <= createdAt).at(-1)?.[0] ??
    p.history[0]?.revision ??
    p.revision
  );
}
const nonblank = (v: string) => v.trim() !== "";

/** Projects a paper into a paperRevision document of the working-paper contract. */
export async function paperRevision(
  p: Paper,
  c: PaperContext,
): Promise<PaperRevision> {
  const template = catalog.items.find((t) => t.id === p.templateId),
    kind = (p.kind === "memo" ? "memo" : "working_paper") as
      "memo" | "working_paper",
    body = narrative(p.body),
    digest = await paperContentDigest(p),
    status = p.supersededBy ? "superseded" : exportedStatus[p.status],
    signed = p.status === "signed",
    assessed = p.status !== "draft",
    limitations = nonblank(body.limitations) ? [body.limitations] : [];
  const evidence = p.evidenceIds.flatMap((id) => {
    const a = c.artifacts.find((a) => a.id === id);
    if (!a) {
      limitations.push(
        "Linked evidence " + id + " is not held by the engagement",
      );
      return [];
    }
    return [
      {
        artifactVersionId: a.id,
        sha256: a.sha256,
        source: a.name || a.id,
        custodian: a.uploadedBy || "unrecorded",
        period: "",
        systemVersion: "",
        assertions: [],
        reliability: a.status,
        completeness: "",
        limitations:
          a.status === "accepted" ? [] : ["Evidence status: " + a.status],
      },
    ];
  });
  const runReferences = p.runIds.flatMap((id) => {
    const r = c.runs.find((r) => r.id === id);
    if (!r) {
      limitations.push("Linked run " + id + " is not held by the engagement");
      return [];
    }
    return [
      {
        runId: r.id,
        manifestArtifactVersionId: r.id + "/manifest",
        manifestDigest: /^[a-f0-9]{64}$/.test(
          r.provenance.inputHashes.manifest ?? "",
        )
          ? r.provenance.inputHashes.manifest
          : null,
        testSuiteVersion: r.provenance.runnerVersion || "unrecorded",
        environmentDigest: null,
        inputArtifactVersionIds: [r.datasetId],
        policyVersion: r.provenance.policyVersion || "unrecorded",
        seed: Number.isInteger(r.seed) ? r.seed : null,
        warnings: r.reviewFlags ?? [],
      },
    ];
  });
  const approvals: Approval[] = [
    ...p.reviews.map((r) => ({
      actorId: r.userId,
      role: "reviewer" as const,
      decision: "approve" as const,
      revision: r.revision,
      contentDigest: digest,
      approvedAt: r.at,
      signatureReference: "review:" + p.id + ":r" + r.revision,
    })),
    ...p.signatures.map((s) => ({
      actorId: s.userId,
      role: "lead_auditor" as const,
      decision: "approve" as const,
      revision: s.revision,
      contentDigest: s.hash,
      approvedAt: s.at,
      signatureReference: "signature:" + p.id + ":r" + s.revision,
    })),
  ];
  const signature = p.signatures.at(-1),
    notApplicable = body.conclusionStatus === "not_applicable",
    records = kind === "memo" ? memoRecords(p.templateId, c.records) : {};
  return {
    schemaVersion: paperRevisionVersion,
    id: p.id,
    tenantId: c.tenantId,
    clientId: c.clientId,
    engagementId: c.engagementId,
    catalogId: p.templateId,
    kind,
    templateVersion: c.templateVersion,
    revision: p.revision,
    status,
    stage: p.stage,
    title: p.title,
    audience: paperAudience(p),
    scope: {
      systemId: c.systemId,
      modelVersionIds: [],
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      rulePackId: c.rulePack.version,
      operatorRoles: operatorRoles[c.operatorRole] ?? ["other"],
      criteria: [],
      boundary: c.boundary,
      exclusions: [],
    },
    applicability: {
      state: notApplicable
        ? "not_applicable"
        : assessed
          ? "applicable"
          : "pending",
      rationale: notApplicable ? body.conclusion : "",
      regulatoryReferences: (
        p.articleRefs ??
        template?.regulatoryRefs ??
        []
      ).filter(nonblank),
      sourceVersion: c.rulePack.legalVersion,
      approvedBy: notApplicable && signature ? signature.userId : null,
      approvedAt: notApplicable && signature ? signature.at : null,
    },
    riskReferences: [],
    procedures: (template?.procedures.length
      ? template.procedures
      : [{ id: p.templateId + "-P01", text: p.title }]
    ).map((step) => ({
      id: step.id,
      description: step.text,
      mode: template?.automationMode === "hybrid" ? "hybrid" : "manual",
      criterion: {
        source: "",
        metric: null,
        operator: null,
        threshold: null,
        justification: "",
        policyVersion: null,
        approvedBy: null,
      },
      diagnosticState: "not_run",
      observation: "",
      sample: null,
      evidenceVersionIds: [],
      runIds: [],
      findingIds: [],
    })),
    evidence,
    runReferences,
    evaluation: {
      // Submitting asserts the evidence suffices; the limitations section
      // is where the preparer records where it does not.
      evidenceSufficiency: !assessed
        ? "not_assessed"
        : limitations.length
          ? "limited"
          : "sufficient",
      contradictions: [],
      limitations,
      auditorConclusion: auditorConclusion[body.conclusionStatus],
      rationale: body.conclusion,
      findingIds: c.findings
        .filter((f) => f.support?.paperIds.includes(p.id))
        .map((f) => f.id),
      managementResponseId: null,
      subsequentEventsThrough: null,
    },
    reviewComments: p.comments.map((comment) => ({
      id: comment.id,
      revision: commentRevision(p, comment.createdAt),
      reviewerId: comment.authorId,
      // Every open comment blocks submission, review and sign-off.
      severity: "blocking",
      text: comment.text,
      state: comment.resolved
        ? "resolved"
        : comment.responses?.length
          ? "responded"
          : "open",
      response: (comment.responses ?? []).map((r) => r.text).join("\n\n"),
      // Only the comment's author can confirm its resolution.
      resolvedBy: comment.resolved ? comment.authorId : null,
      resolution:
        comment.resolved && comment.resolvedAt
          ? "Resolved " + comment.resolvedAt
          : "",
    })),
    approvals,
    narrative: body,
    ...(Object.keys(records).length ? { records } : {}),
    provenance: {
      createdBy: p.authorId,
      createdAt: p.updatedAt,
      contentOrigin: "human",
      supersedesId: p.supersedes ?? null,
      amendmentReason: null,
      contentDigest: signed && signature ? signature.hash : digest,
    },
  };
}

/** Every paper a report captures, as working-paper contract documents. */
export async function paperRevisions(
  papers: readonly Paper[],
  c: PaperContext,
) {
  return {
    schema: workingPaperContract,
    documents: await Promise.all(papers.map((p) => paperRevision(p, c))),
  };
}

/**
 * The paper fields a paperRevision document carries back: what an export
 * keeps of the paper, for reading an exported document into the app's terms.
 */
export function paperFromRevision(d: PaperRevision) {
  return {
    id: d.id,
    templateId: d.catalogId,
    kind: d.kind,
    title: d.title,
    stage: d.stage,
    revision: d.revision,
    status: appStatus[d.status],
    superseded: d.status === "superseded",
    audience: d.audience,
    ...(d.provenance.supersedesId
      ? { supersedes: d.provenance.supersedesId }
      : {}),
    authorId: d.provenance.createdBy,
    updatedAt: d.provenance.createdAt,
    body: { ...d.narrative } as Record<string, string>,
    evidenceIds: d.evidence.map((e) => e.artifactVersionId),
    runIds: d.runReferences.map((r) => r.runId),
    reviews: d.approvals
      .filter((a) => a.signatureReference.startsWith("review:"))
      .map((a) => ({
        userId: a.actorId,
        revision: a.revision,
        at: a.approvedAt,
      })),
    signatures: d.approvals
      .filter((a) => a.signatureReference.startsWith("signature:"))
      .map((a) => ({
        userId: a.actorId,
        revision: a.revision,
        at: a.approvedAt,
        hash: a.contentDigest,
      })),
    commentIds: d.reviewComments.map((c) => c.id),
  };
}
