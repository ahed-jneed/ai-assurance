import type { Engagement, Finding } from "./domain";
import type { Context } from "./tenancy";
import { isClientRole, isReleased } from "./workflow-state";
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
/**
 * The live engagement as the caller may see it: internal roles get the full
 * record, client roles a projection. A released report's client snapshot is
 * projected separately, when the report is created (lib/commands/reports.ts).
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
    classification: { ...e.classification, rationale: "", intendedPurpose: "" },
    papers: [],
    models: [],
    runs: [],
    evaluationProfiles: [],
    evidenceRequests: [],
    findings: contributor
      ? []
      : e.findings.filter((f) => f.visibility === "client").map(clientFinding),
    artifacts: e.artifacts
      .filter(
        (a) =>
          (a.visibility === "client" && a.status === "accepted") ||
          (contributor && ownIds.has(a.id)),
      )
      .map((a) => ({
        ...a,
        key: "",
        uploadedBy: contributor && ownIds.has(a.id) ? a.uploadedBy : "",
      })),
    reports: e.reports.filter(isReleased).map((r) => ({
      id: r.id,
      kind: r.kind,
      createdAt: r.release!.releasedAt!,
      actor: "",
      sha256: r.clientSha256!,
      snapshot: r.clientSnapshot!,
      // Releasing a report supersedes the one released before, which then
      // leaves this projection; the client sees which reports it replaced.
      replaces: e.reports
        .filter((q) => q.release?.supersededBy === r.id)
        .map((q) => q.id),
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
