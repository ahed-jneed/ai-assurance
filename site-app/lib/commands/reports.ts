import { z } from "zod";
import { annexIVIndex, annexMapVersion } from "../annex-iv";
import { assurancePins, jobs, assuranceGates } from "../assurance-store";
import {
  clientReportSnapshot,
  currentClientSnapshot,
  legacyPackageMessage,
  paperAudience,
} from "../client-projection";
import {
  finalReportGates,
  paperCurrent,
  type Engagement,
  type FinalReport,
} from "../domain";
import {
  criteriaPhrase,
  criterionRollup,
  reportElements,
  subjectPhrase,
} from "../domain/report-gates";
import {
  assuranceLevelIds,
  conclusionStatement,
  conclusionTypeIds,
  engagementTypeIds,
  snapshotConclusion,
  snapshotParticulars,
  snapshotTerms,
  termsLabel,
  termsProblem,
} from "../domain/report-model";
import { id, now, sha256 } from "../engagement-repo";
import { ApiError } from "../http";
import { assertReviewerIndependent } from "../quality-review-records";
import {
  criteriaStamp,
  packFeatures,
  pinned,
  recordVersions,
} from "../criteria/pin";
import { specialCategoryLimitations } from "../special-category";
import type { Context } from "../tenancy";
import { defineCommands, type CommandData } from "./command";
import { short, text } from "./fields";
/**
 * The papers a report captures: every current paper for a draft, the current
 * signed papers for a final report. Superseded papers and retired limitation
 * memos are history, not current work. Each paper's audience decides what the
 * client snapshot publishes.
 */
function capturedPapers(e: Engagement, kind: "draft" | "final") {
  return e.papers
    .filter(
      (p) => paperCurrent(p) && (kind === "draft" || p.status === "signed"),
    )
    .map((p) => ({
      id: p.id,
      templateId: p.templateId,
      title: p.title,
      revision: p.revision,
      status: p.status,
      audience: paperAudience(p),
      body: p.body,
      evidenceIds: p.evidenceIds,
      runIds: p.runIds,
      reviews: p.reviews,
      signatures: p.signatures,
    }));
}
const optionalText = (max: number) => z.string().trim().max(max).default("");
/**
 * Report capture: the hashed internal snapshot with its Annex IV map, and the
 * client snapshot published when the report is released. A report states its
 * engagement type, assurance level and conclusion (report model v2,
 * lib/domain/report-model.ts); a final report must also contain every report
 * element.
 */
export const reports = defineCommands({
  createReport: {
    roles: ["Lead Auditor"],
    async handle(e, d, ctx) {
      const a = z
        .object({
          kind: z.enum(["draft", "final"]),
          engagementType: z.enum(engagementTypeIds),
          assuranceLevel: z.enum(assuranceLevelIds).nullable().default(null),
          conclusion: z.enum(conclusionTypeIds),
          summary: text,
          addressee: optionalText(300),
          location: optionalText(300),
          signatory: optionalText(300),
          basisForModification: optionalText(5000),
        })
        .parse(d);
      const terms = {
          engagementType: a.engagementType,
          assuranceLevel: a.assuranceLevel,
          conclusion: a.conclusion,
        },
        particulars = {
          addressee: a.addressee,
          location: a.location,
          signatory: a.signatory,
          basisForModification: a.basisForModification,
        };
      const problem = termsProblem(terms);
      if (problem) throw new ApiError(400, problem);
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
        const assuranceBlockers = await assuranceGates(ctx, e.id, a.conclusion);
        if (assuranceBlockers.length)
          throw new ApiError(409, assuranceBlockers[0]);
        const gates = finalReportGates(
          e,
          { ...terms, particulars },
          packFeatures(e),
        );
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
        await assertReviewerIndependent(ctx, e);
      }
      // What the pinned pack switches on and the texts it reports with
      // (docs/design/criteria-model.md sections 7.1 and 10).
      const { pack } = pinned(e),
        features = packFeatures(e),
        createdAt = now();
      // The part of the report written for its reader, in both snapshots.
      const elements = reportElements(e, terms, particulars, createdAt).map(
        ({ id, label, value }) => ({ id, label, value }),
      );
      const report = {
        terms,
        particulars,
        reportTitle: elements.find((el) => el.id === "title")?.value ?? "",
        elements,
        conclusionStatement: conclusionStatement(
          terms,
          subjectPhrase(e),
          criteriaPhrase,
        ),
        criteria: criterionRollup(e),
      };
      const snapshot = {
        workflow: e.workflow ? structuredClone(e.workflow) : null,
        contractVersion: "2.0",
        engagement: {
          id: e.id,
          title: e.title,
          stage: e.stage,
          ...(features.aiActClassification
            ? { classification: e.classification }
            : {}),
        },
        opinion: termsLabel(terms),
        ...report,
        summary: a.summary,
        evidenceRequests: e.evidenceRequests ?? [],
        papers: capturedPapers(e, a.kind),
        supersededPapers: e.papers
          .filter((p) => p.supersededBy)
          .map((p) => ({
            id: p.id,
            templateId: p.templateId,
            revision: p.revision,
            supersededBy: p.supersededBy,
            signatures: p.signatures,
          })),
        // Limitation memos retired by reopening their evidence request stay
        // referenced, so evidenceRequests[].limitationPaperId resolves.
        retiredPapers: e.papers
          .filter((p) => p.retired && !p.supersededBy)
          .map((p) => ({
            id: p.id,
            templateId: p.templateId,
            revision: p.revision,
            retired: p.retired,
            signatures: p.signatures,
          })),
        evidence: e.artifacts.map(({ key, ...a }) => a),
        findings: e.findings,
        models: e.models,
        evaluationProfiles: e.evaluationProfiles ?? [],
        runs: e.runs,
        ...(features.annexIvIndex
          ? { annexIV: annexIVIndex(e), annexMapVersion }
          : {}),
        auditEventHead: e.eventHead,
        createdAt,
        ...recordVersions(e),
        // The pack stamp (design section 10). Named criteriaPack because
        // `criteria` holds the results by criterion of report model v2.
        criteriaPack: criteriaStamp(e),
        ...(pack.reporting?.regulatorySource
          ? { regulatorySource: pack.reporting.regulatorySource }
          : {}),
        limitations: [
          pack.reporting?.limitations ?? "",
          ...specialCategoryLimitations(e.runs),
        ]
          .filter(Boolean)
          .join(" "),
      };
      Object.assign(snapshot, {
        assurancePins: await assurancePins(ctx, e.id),
      });
      const hash = await sha256(JSON.stringify(snapshot)),
        r = {
          id: id("REPORT"),
          kind: a.kind,
          createdAt,
          actor: ctx.user.userId,
          sha256: hash,
          snapshot,
          release: { state: "internal" as const, history: [] },
        };
      // The client report counts only the findings it lists (F-57).
      const clientSnapshot = clientReportSnapshot(e, {
        ...snapshot,
        report: {
          ...report,
          criteria: criterionRollup(e, (f) => f.visibility === "client"),
        },
      });
      Object.assign(r, {
        clientSnapshot,
        clientSha256: await sha256(JSON.stringify(clientSnapshot)),
      });
      e.reports.push(r);
      return { details: { reportId: r.id, kind: r.kind, sha256: hash } };
    },
  },
  setPaperAudience: {
    roles: ["Lead Auditor"],
    handle(e, d) {
      const a = z
          .object({
            paperId: short,
            audience: z.enum(["internal", "client"]),
          })
          .strict()
          .parse(d),
        p = e.papers.find((p) => p.id === a.paperId);
      if (!p) throw new ApiError(404, "Working paper not found");
      if (!paperCurrent(p))
        throw new ApiError(
          409,
          "A superseded or retired paper stays as it was captured",
        );
      p.audience = a.audience;
      return { details: { paperId: p.id, audience: a.audience } };
    },
  },
});
const pinOfStamp = (stamp: unknown) => {
  const s = stamp as {
    packId?: string;
    packVersion?: string;
    packSha256?: string;
  };
  return [s.packId, s.packVersion, s.packSha256];
};
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
  // A package captured before report model v2 carries the old client
  // snapshot (internal memos, approver and uploader ids): never publish it.
  const terms = snapshotTerms(r.snapshot);
  if (!terms || !currentClientSnapshot(r))
    throw new ApiError(409, legacyPackageMessage);
  if (
    r.snapshot.assurancePins &&
    JSON.stringify(r.snapshot.assurancePins) !==
      JSON.stringify(await assurancePins(ctx, e.id))
  )
    throw new ApiError(
      409,
      "Assurance sources changed after capture; prepare and approve a new report",
    );
  // The release gates are rechecked with the captured terms and elements.
  const report: FinalReport = {
    ...terms,
    particulars: snapshotParticulars(r.snapshot),
  };
  const assuranceBlockers = await assuranceGates(
    ctx,
    e.id,
    snapshotConclusion(r.snapshot),
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
  const features = packFeatures(e);
  const gates = finalReportGates(e, report, features);
  if (gates.length) throw new ApiError(409, gates[0].message);
  await assertReviewerIndependent(ctx, e);
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
  if (
    JSON.stringify(frozen.procedures) !==
      JSON.stringify(e.workflow?.procedures) ||
    JSON.stringify(r.snapshot.papers) !==
      JSON.stringify(capturedPapers(e, "final")) ||
    JSON.stringify(r.snapshot.findings) !== JSON.stringify(e.findings) ||
    // Without the AI Act classification the snapshot has none to compare.
    (features.aiActClassification &&
      JSON.stringify(
        (
          r.snapshot.engagement as {
            classification: unknown;
          }
        ).classification,
      ) !== JSON.stringify(e.classification)) ||
    // A pin moved between capture and release forces a new capture; packages
    // captured before pins existed have none, and legacy pins never move.
    (r.snapshot.criteriaPack !== undefined &&
      JSON.stringify(pinOfStamp(r.snapshot.criteriaPack)) !==
        JSON.stringify(pinOfStamp(criteriaStamp(e)))) ||
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
