// The one client projection (F-57): what a client may see of an engagement,
// used both for the live engagement (`sanitize`) and for the client snapshot
// a final report publishes when it is released (`clientReportSnapshot`).
// Every record passes through the same per-record projection, so the two
// views cannot disagree, and none of them carries an internal user id.
import type {
  Artifact,
  Classification,
  Engagement,
  Finding,
  Paper,
} from "./domain";
import { paperCurrent } from "./domain/gates";
import type { Context } from "./tenancy";
import { isClientRole, isClientVisible } from "./workflow-state";
import type { Brief } from "./workflow-types";

/**
 * The classification as the client sees it: the label and answers without the
 * auditor's rationale, intended-purpose analysis, evidence references or any
 * internal user id (approver, answering auditor, history actors).
 */
export function clientClassification(c: Classification): Classification {
  const client: Classification = {
    ...c,
    rationale: "",
    intendedPurpose: "",
    ...(c.answers
      ? {
          answers: Object.fromEntries(
            Object.entries(c.answers).map(([id, a]) => [
              id,
              { ...a, evidence: undefined, answeredBy: "" },
            ]),
          ),
        }
      : {}),
    ...(c.derogation
      ? { derogation: { rationale: "", registrationEvidence: "" } }
      : {}),
    // Copies, so removing the actors below leaves the record untouched.
    ...(c.history ? { history: c.history.map((h) => ({ ...h })) } : {}),
    ...(c.legacy ? { legacy: { ...c.legacy } } : {}),
  };
  delete client.approvedBy;
  if (client.history) for (const h of client.history) delete h.by;
  if (client.legacy) delete client.legacy.approvedBy;
  return client;
}
/** A client finding must not inherit new internal fields when the audit model grows. */
export function clientFinding(f: Finding): Finding {
  return {
    id: f.id,
    title: f.title,
    article: f.article,
    condition: f.condition,
    criteria: f.criteria,
    cause: f.cause,
    effect: f.effect,
    likelihood: f.likelihood,
    impact: f.impact,
    riskScore: f.riskScore,
    severity: f.severity,
    status: f.status,
    owner: f.owner,
    dueDate: f.dueDate,
    response: f.response,
    remediation: f.remediation,
    retestEvidenceIds: [],
    createdBy: "",
    visibility: "client",
  };
}
/** Evidence a client sees: no storage key and no uploader's user id. */
export function clientArtifact(a: Artifact): Omit<Artifact, "key"> {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    size: a.size,
    sha256: a.sha256,
    createdAt: a.createdAt,
    uploadedBy: "",
    visibility: a.visibility,
    status: a.status,
    mediaType: a.mediaType,
  };
}
/** Who a paper is written for: memos default to internal. */
export const paperAudience = (p: Paper) =>
  p.audience ?? (p.kind === "memo" ? "internal" : "client");
/** A signed client paper as a released report shows it: its conclusion only. */
export function clientPaper(p: Paper) {
  return {
    id: p.id,
    title: p.title,
    revision: p.revision,
    status: p.status,
    conclusion: p.body.conclusion,
    conclusionStatus: p.body.conclusionStatus,
  };
}
/** The client's view of the engagement's records, shared by both views. */
export const clientRecords = {
  findings: (e: Engagement) =>
    e.findings.filter((f) => f.visibility === "client").map(clientFinding),
  evidence: (e: Engagement) =>
    e.artifacts
      .filter((a) => a.visibility === "client" && a.status === "accepted")
      .map(clientArtifact),
  papers: (e: Engagement) =>
    e.papers
      .filter(
        (p) =>
          paperCurrent(p) &&
          p.status === "signed" &&
          paperAudience(p) === "client",
      )
      .map(clientPaper),
};
/** The agreed scope a client sees: the brief without internal planning notes. */
export function clientScope(b: Brief | undefined) {
  return b
    ? {
        systemName: b.systemName,
        intendedUse: b.intendedUse,
        boundary: b.boundary,
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
        deliverables: b.deliverables,
      }
    : null;
}

/** The client snapshot contract that report model v2 captures. */
export const clientSnapshotVersion = "2.0";
/**
 * Whether a package's client snapshot follows the current contract. Packages
 * captured before report model v2 carry a client snapshot that includes
 * internal memos and internal user ids; they must not be approved or released.
 */
export const currentClientSnapshot = (r: {
  clientSnapshot?: Record<string, unknown>;
}) => r.clientSnapshot?.contractVersion === clientSnapshotVersion;
export const legacyPackageMessage =
  "This package was captured before report model v2 and its client snapshot is not current. Prepare a new report package";
/**
 * The client snapshot of a final report, built when the report is captured
 * and published when it is released. `report` is the part of the internal
 * snapshot written for the reader (terms, particulars, report elements,
 * conclusion and results by criterion); it carries no user ids.
 */
export function clientReportSnapshot(
  e: Engagement,
  captured: {
    createdAt: string;
    opinion: string;
    summary: string;
    limitations: string;
    regulatorySource?: string;
    rulePack?: unknown;
    methodologyVersion?: unknown;
    criteriaPack?: unknown;
    engagement: { classification?: unknown };
    report: Record<string, unknown>;
  },
) {
  return {
    contractVersion: clientSnapshotVersion,
    scope: clientScope(e.workflow?.brief),
    engagement: {
      id: e.id,
      title: e.title,
      // Only packs with the AI Act classification capture one.
      ...(captured.engagement.classification
        ? { classification: clientClassification(e.classification) }
        : {}),
    },
    opinion: captured.opinion,
    ...captured.report,
    summary: captured.summary,
    createdAt: captured.createdAt,
    papers: clientRecords.papers(e),
    evidence: clientRecords.evidence(e),
    findings: clientRecords.findings(e),
    limitations:
      captured.limitations +
      ((e.evidenceRequests ?? []).some((q) => q.disposition === "unobtainable")
        ? " Evidence availability limitations were recorded; refer to the scoped opinion and executive summary."
        : ""),
    ...(captured.regulatorySource
      ? { regulatorySource: captured.regulatorySource }
      : {}),
    rulePack: captured.rulePack,
    methodologyVersion: captured.methodologyVersion,
    criteriaPack: captured.criteriaPack,
  };
}

/** How a client sees a successor that was withdrawn after its release. */
export const withdrawnSuccessor = "a later report, since withdrawn";

/**
 * The live engagement as the caller may see it: internal roles get the full
 * record, client roles a projection. Released reports show their client
 * snapshot, built with the same record projections.
 */
export function sanitize(e: Engagement, ctx: Context): Engagement {
  if (!isClientRole(ctx.role)) return e;
  const grants =
    e.workflow?.clientGrants.filter(
      (g) =>
        g.userId === ctx.user.userId &&
        g.active &&
        Date.parse(g.expiresAt) > Date.now() &&
        (!ctx.accessSince || g.at >= ctx.accessSince),
    ) ?? [];
  const own =
    e.workflow?.submissions.filter(
      (s) =>
        s.actor === ctx.user.userId && grants.some((g) => g.id === s.grantId),
    ) ?? [];
  const ownIds = new Set(own.flatMap((s) => s.evidenceIds));
  const contributor = ctx.role === "Client Contributor";
  return {
    id: e.id,
    clientId: e.clientId,
    title: e.title,
    stage: e.stage,
    dueDate: e.dueDate,
    version: e.version,
    createdAt: e.createdAt,
    eventHead: "",
    classification: clientClassification(e.classification),
    // Papers are internal work until a released report publishes them.
    papers: [],
    models: [],
    runs: [],
    evaluationProfiles: [],
    evidenceRequests: [],
    findings: contributor ? [] : clientRecords.findings(e),
    artifacts: e.artifacts
      .filter(
        (a) =>
          (a.visibility === "client" && a.status === "accepted") ||
          (contributor && ownIds.has(a.id)),
      )
      .map((a) => ({
        ...clientArtifact(a),
        key: "",
        // A contributor sees its own submissions as its own.
        uploadedBy: contributor && ownIds.has(a.id) ? a.uploadedBy : "",
      })),
    reports: e.reports.filter(isClientVisible).map((r) => ({
      id: r.id,
      kind: r.kind,
      createdAt: r.release!.releasedAt!,
      actor: "",
      sha256: r.clientSha256!,
      snapshot: r.clientSnapshot!,
      // The client sees which reports a released report replaced, and a
      // superseded report stays readable, labelled with its successor.
      replaces: e.reports
        .filter((q) => q.release?.supersededBy === r.id)
        .map((q) => q.id),
      // A successor the client cannot read (withdrawn after release) is not
      // named.
      ...(r.release?.supersededBy && {
        supersededBy: e.reports.some(
          (q) => q.id === r.release!.supersededBy && isClientVisible(q),
        )
          ? r.release.supersededBy
          : withdrawnSuccessor,
      }),
    })),
    ...(contributor
      ? {
          portalRequests: grants.map((g) => {
            const r = e.evidenceRequests?.find((r) => r.id === g.requestId);
            return {
              id: g.requestId,
              subject: g.prompt,
              prompt: g.prompt,
              instructions: g.instructions,
              periodVersion: r?.periodVersion ?? "",
              dueDate: r?.dueDate ?? "",
              status: r?.status ?? "open",
              grantId: g.id,
              requestedItems: g.requestedItems ?? [],
              communications: g.communications ?? [],
              submissions: own.filter((s) => s.grantId === g.id),
            };
          }),
        }
      : {}),
  };
}
