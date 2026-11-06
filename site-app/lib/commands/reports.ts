import { z } from "zod";
import annexMap from "../annex-iv-map.json";
import { assurancePins, jobs, assuranceGates } from "../assurance-store";
import { clientFinding } from "../client-projection";
import { finalReportGates, type Engagement } from "../domain";
import { id, now, sha256 } from "../engagement-repo";
import { ApiError } from "../http";
import { recordVersions } from "../rule-pack-current";
import { specialCategoryLimitations } from "../special-category";
import type { Context } from "../tenancy";
import { defineCommands, type CommandData } from "./command";
import { text } from "./fields";
/**
 * Report capture: the hashed internal snapshot with its Annex IV map, and the
 * client snapshot published when the report is released.
 */
export const reports = defineCommands({
  createReport: {
    roles: ["Lead Auditor"],
    async handle(e, d, ctx) {
      const a = z
        .object({
          kind: z.enum(["draft", "final"]),
          opinion: z.enum([
            "Readiness assessment",
            "Qualified conclusion",
            "Adverse conclusion",
            "Unable to conclude",
          ]),
          summary: text,
        })
        .parse(d);
      if (a.kind === "final") {
        if (
          (await jobs(ctx, e.id)).some((j) =>
            ["queued", "running"].includes(String(j.state)),
          )
        )
          throw new ApiError(
            409,
            "Complete or cancel external execution before final capture",
          );
        const assuranceBlockers = await assuranceGates(ctx, e.id, a.opinion);
        if (assuranceBlockers.length)
          throw new ApiError(409, assuranceBlockers[0]);
        const gates = finalReportGates(e, a.opinion);
        if (gates[0]?.kind === "stage")
          throw new ApiError(400, gates[0].message);
        if (gates.length)
          throw new ApiError(
            400,
            gates
              .slice(0, 8)
              .map((g) => g.message)
              .join("; "),
          );
      }
      const annexIV = annexMap.sections.map((section) => {
        const matching = e.papers.filter((p) =>
            section.paperIds.includes(p.templateId),
          ),
          candidates = e.artifacts.filter(
            (a) =>
              a.status === "accepted" &&
              section.evidenceCategories.includes(a.category),
          );
        return {
          number: section.number,
          title: section.title,
          reference: section.reference,
          state: candidates.length
            ? "candidate_evidence_present"
            : "unassessed",
          paperIds: matching.map((p) => p.id),
          candidateEvidenceIds: candidates.map((a) => a.id),
          gaps: [
            ...(!candidates.length ? ["No accepted candidate evidence"] : []),
            ...matching
              .filter((p) => p.status !== "signed")
              .map(
                (p) => p.templateId + ": independent signed assessment missing",
              ),
            "Human assessment of legal subitems, scope, currency and version remains required",
          ],
          checklist: section.evidenceChecklist,
        };
      });
      const snapshot = {
        workflow: e.workflow ? structuredClone(e.workflow) : null,
        contractVersion: "1.1",
        engagement: {
          id: e.id,
          title: e.title,
          stage: e.stage,
          classification: e.classification,
        },
        opinion: a.opinion,
        summary: a.summary,
        evidenceRequests: e.evidenceRequests ?? [],
        papers: e.papers
          .filter((p) => a.kind === "draft" || p.status === "signed")
          .map((p) => ({
            id: p.id,
            templateId: p.templateId,
            title: p.title,
            revision: p.revision,
            status: p.status,
            body: p.body,
            evidenceIds: p.evidenceIds,
            runIds: p.runIds,
            reviews: p.reviews,
            signatures: p.signatures,
          })),
        evidence: e.artifacts.map(({ key, ...a }) => a),
        findings: e.findings,
        models: e.models,
        evaluationProfiles: e.evaluationProfiles ?? [],
        runs: e.runs,
        annexIV,
        annexMapVersion: annexMap.mapVersion,
        auditEventHead: e.eventHead,
        createdAt: now(),
        ...recordVersions(),
        regulatorySource: "https://eur-lex.europa.eu/eli/reg/2024/1689",
        limitations: [
          "Diagnostic and assurance conclusions do not constitute a notified-body conformity assessment or legal certification. The platform's diagnostics evaluate traditional ML systems; they do not yet evaluate generative AI outputs, so conclusions on generative systems rest on the auditor's own procedures and evidence.",
          ...specialCategoryLimitations(e.runs),
        ].join(" "),
      };
      Object.assign(snapshot, {
        assurancePins: await assurancePins(ctx, e.id),
      });
      const hash = await sha256(JSON.stringify(snapshot)),
        r = {
          id: id("REPORT"),
          kind: a.kind,
          createdAt: now(),
          actor: ctx.user.userId,
          sha256: hash,
          snapshot,
          release: { state: "internal" as const, history: [] },
        };
      const clientSnapshot = {
        scope: e.workflow?.brief
          ? {
              systemName: e.workflow.brief.systemName,
              intendedUse: e.workflow.brief.intendedUse,
              boundary: e.workflow.brief.boundary,
              periodStart: e.workflow.brief.periodStart,
              periodEnd: e.workflow.brief.periodEnd,
              deliverables: e.workflow.brief.deliverables,
            }
          : null,
        engagement: {
          id: e.id,
          title: e.title,
          classification: e.classification,
        },
        opinion: a.opinion,
        summary: a.summary,
        createdAt: r.createdAt,
        papers: e.papers
          .filter((p) => p.status === "signed")
          .map((p) => ({
            id: p.id,
            title: p.title,
            revision: p.revision,
            status: p.status,
            conclusion: p.body.conclusion,
            conclusionStatus: p.body.conclusionStatus,
          })),
        evidence: e.artifacts
          .filter((a) => a.visibility === "client" && a.status === "accepted")
          .map(({ key, ...a }) => a),
        findings: e.findings
          .filter((f) => f.visibility === "client")
          .map(clientFinding),
        limitations:
          snapshot.limitations +
          ((e.evidenceRequests ?? []).some(
            (q) => q.disposition === "unobtainable",
          )
            ? " Evidence availability limitations were recorded; refer to the scoped opinion and executive summary."
            : ""),
        regulatorySource: snapshot.regulatorySource,
        rulePack: snapshot.rulePack,
        methodologyVersion: snapshot.methodologyVersion,
      };
      Object.assign(r, {
        clientSnapshot,
        clientSha256: await sha256(JSON.stringify(clientSnapshot)),
      });
      e.reports.push(r);
      return { details: { reportId: r.id, kind: r.kind, sha256: hash } };
    },
  },
});
/**
 * Checks that a captured report may still be released: its assurance sources,
 * the release gates and every audit record it captured are unchanged. Runs
 * before the workflow's releaseReport op.
 */
export async function assertReleasable(
  e: Engagement,
  d: CommandData,
  ctx: Context,
) {
  const r = e.reports.find((r) => r.id === d.reportId);
  if (!r) throw new ApiError(404, "Report not found");
  if (
    r.snapshot.assurancePins &&
    JSON.stringify(r.snapshot.assurancePins) !==
      JSON.stringify(await assurancePins(ctx, e.id))
  )
    throw new ApiError(
      409,
      "Assurance sources changed after capture; prepare and approve a new report",
    );
  const assuranceBlockers = await assuranceGates(
    ctx,
    e.id,
    String(r.snapshot.opinion),
  );
  if (assuranceBlockers.length) throw new ApiError(409, assuranceBlockers[0]);
  if (
    (await jobs(ctx, e.id)).some((j) =>
      ["queued", "running"].includes(String(j.state)),
    )
  )
    throw new ApiError(
      409,
      "Complete or cancel external execution before release",
    );
  const gates = finalReportGates(e, String(r.snapshot.opinion));
  if (gates.length) throw new ApiError(409, gates[0].message);
  const frozen = r.snapshot.workflow as Engagement["workflow"];
  if (
    !frozen ||
    frozen.brief?.revision !== e.workflow?.brief?.revision ||
    frozen.program.revision !== e.workflow?.program.revision
  )
    throw new ApiError(
      409,
      "Prepare a new report for the current approved scope and program",
    );
  const capturedPapers = e.papers
    .filter((p) => p.status === "signed")
    .map((p) => ({
      id: p.id,
      templateId: p.templateId,
      title: p.title,
      revision: p.revision,
      status: p.status,
      body: p.body,
      evidenceIds: p.evidenceIds,
      runIds: p.runIds,
      reviews: p.reviews,
      signatures: p.signatures,
    }));
  if (
    JSON.stringify(frozen.procedures) !==
      JSON.stringify(e.workflow?.procedures) ||
    JSON.stringify(r.snapshot.papers) !== JSON.stringify(capturedPapers) ||
    JSON.stringify(r.snapshot.findings) !== JSON.stringify(e.findings) ||
    JSON.stringify(
      (
        r.snapshot.engagement as {
          classification: unknown;
        }
      ).classification,
    ) !== JSON.stringify(e.classification) ||
    JSON.stringify(r.snapshot.evidenceRequests) !==
      JSON.stringify(e.evidenceRequests ?? []) ||
    JSON.stringify(r.snapshot.evidence) !==
      JSON.stringify(e.artifacts.map(({ key, ...a }) => a)) ||
    JSON.stringify(r.snapshot.models) !== JSON.stringify(e.models) ||
    JSON.stringify(r.snapshot.evaluationProfiles) !==
      JSON.stringify(e.evaluationProfiles ?? []) ||
    JSON.stringify(r.snapshot.runs) !== JSON.stringify(e.runs)
  )
    throw new ApiError(
      409,
      "Audit source records changed after report capture. Prepare and approve a new final package",
    );
}
