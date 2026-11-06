// Audit gates: what must hold before an engagement moves to the next
// lifecycle stage and before a final report can be issued.
//
// Gates are stage-scoped: entering a stage needs only the work of the stages
// before it, and final issuance needs the work of every stage except the
// release-time records, whose evidence is the final package itself. So
// Reporting and Sign-off have distinct exit criteria: leaving Reporting
// (entering Sign-off) needs the Reporting work signed; leaving Sign-off needs
// the final package captured, independently approved and released, which
// records the release-time completion records against its hashes.
import type { Procedure } from "../workflow-types";
import { workflowRequirements } from "../workflow-state";
import { acceptanceGates } from "../workflow/acceptance";
import type { Engagement, Paper } from "./types";
import { qualityReviewGates } from "./quality-review";
import { reportElements } from "./report-gates";
import {
  requiresSupport,
  type ReportParticulars,
  type ReportTerms,
} from "./report-model";
export const stages = [
  "Planning",
  "Fieldwork",
  "Evidence evaluation",
  "Reporting",
  "Sign-off",
];
export type AuditGate = {
  id: string;
  kind:
    | "classification"
    | "paper"
    | "finding"
    | "run"
    | "stage"
    | "request"
    | "conclusion"
    | "workflow"
    | "acceptance"
    | "report"
    | "quality_review";
  recordId?: string;
  title: string;
  message: string;
};
import { isReleaseTimeRecord } from "./release-time";
export {
  isReleaseTimeRecord,
  releaseTimeMessage,
  releaseTimeTemplates,
} from "./release-time";
/**
 * The index in `stages` of the lifecycle stage a paper's or procedure's
 * work belongs to, matched without case (the catalog says "Evidence
 * Evaluation"). Remediation and Monitoring work follows the engagement and
 * gates nothing: -1. Work of an unknown stage counts as Fieldwork work.
 */
export function workStage(stage: string) {
  if (stage === "Remediation and Monitoring") return -1;
  const i = stages.findIndex((s) => s.toLowerCase() === stage.toLowerCase());
  return i < 0 ? 1 : i;
}
/**
 * Whether work of this stage and template must be complete before the
 * engagement enters `target`, or, without a target, before final issuance.
 */
export function gatesStage(stage: string, templateId: string, target?: string) {
  if (isReleaseTimeRecord(templateId)) return false;
  const i = workStage(stage);
  return (
    i >= 0 &&
    i < (target === undefined ? stages.length : stages.indexOf(target))
  );
}
/**
 * Whether a paper is current: not superseded by a recompiled revision and
 * not a limitation memo retired by reopening its evidence request.
 */
export const paperCurrent = (p: Paper) => !p.supersededBy && !p.retired;
export function paperRequired(e: Engagement, p: Paper) {
  const linked =
    e.workflow?.program.status === "approved"
      ? e.workflow.procedures.find((q) => q.paperId === p.id)
      : undefined;
  return (
    paperCurrent(p) &&
    !isReleaseTimeRecord(p.templateId) &&
    p.required &&
    (!linked ||
      (linked.selected &&
        ["applicable", "readiness"].includes(linked.applicability)))
  );
}
const procedureScope = (target?: string) => (p: Procedure) =>
  gatesStage(p.stage, p.templateId, target);
const paperScope = (target?: string) => (p: Paper) =>
  paperCurrent(p) && gatesStage(p.stage, p.templateId, target);
/**
 * What must hold before final issuance with this conclusion or, with
 * `target`, the conclusion-neutral part for entering that lifecycle stage:
 * then only the work of earlier stages counts. `conclusion` is a report-model
 * conclusion id or a legacy opinion string; a positive one (unmodified or
 * readiness) also needs every in-scope conclusion supported, no open High or
 * Critical finding, no scope limitation and no prohibited practice.
 */
export function completionGates(
  e: Engagement,
  conclusion = "readiness",
  target?: string,
): AuditGate[] {
  const inScope = paperScope(target),
    positive = requiresSupport(conclusion);
  return [
    ...workflowRequirements(e, true, procedureScope(target)).map((g) => ({
      ...g,
      kind: "workflow" as const,
    })),
    ...(positive
      ? (e.workflow?.procedures ?? [])
          .filter(
            (p) =>
              !p.selected &&
              p.applicability === "applicable" &&
              procedureScope(target)(p),
          )
          .map((p) => ({
            id: p.id,
            kind: "workflow" as const,
            recordId: p.id,
            title: p.title,
            message:
              p.templateId +
              ": an applicable procedure outside audit scope prevents an unmodified or readiness conclusion",
          }))
      : []),
    ...(e.classification.status !== "approved"
      ? [
          {
            id: "classification",
            kind: "classification" as const,
            title: e.classification.intendedPurpose
              ? "Approve regulatory classification"
              : "Assess and approve classification",
            message: "Regulatory classification needs independent approval",
          },
        ]
      : []),
    ...(positive && e.classification.prohibited
      ? [
          {
            id: "prohibited",
            kind: "classification" as const,
            title:
              "Prohibited practice prevents an unmodified or readiness conclusion",
            message:
              "A prohibited practice cannot receive an unmodified or readiness conclusion",
          },
        ]
      : []),
    ...e.papers
      .filter(
        (p) =>
          inScope(p) &&
          (paperRequired(e, p) ||
            p.body.conclusionStatus === "not_applicable") &&
          p.status !== "signed",
      )
      .map((p) => ({
        id: p.id,
        kind: "paper" as const,
        recordId: p.id,
        title: p.templateId + " · " + p.title,
        message: p.templateId + " is not signed",
      })),
    ...e.papers
      .filter(
        (p) =>
          positive &&
          inScope(p) &&
          paperRequired(e, p) &&
          p.status === "signed" &&
          !["supported", "not_applicable"].includes(p.body.conclusionStatus),
      )
      .map((p) => ({
        id: "conclusion:" + p.id,
        kind: "conclusion" as const,
        recordId: p.id,
        title: p.templateId + " · " + p.title,
        message:
          p.templateId +
          ": conclusion does not support an unmodified or readiness conclusion",
      })),
    ...e.findings
      .filter(
        (f) =>
          positive &&
          f.status !== "closed" &&
          ["Critical", "High"].includes(f.severity),
      )
      .map((f) => ({
        id: f.id,
        kind: "finding" as const,
        recordId: f.id,
        title: f.title,
        message: f.id + ": unresolved " + f.severity.toLowerCase() + " finding",
      })),
    ...e.runs
      .filter((r) => ["queued", "running"].includes(r.state))
      .map((r) => ({
        id: r.id,
        kind: "run" as const,
        recordId: r.id,
        title:
          (e.models.find((m) => m.id === r.modelId)?.name ??
            "Model evaluation") +
          " · " +
          r.state,
        message: r.id + ": diagnostic run is incomplete",
      })),
    ...(e.evidenceRequests ?? [])
      .filter(
        (r) =>
          r.required &&
          r.status !== "waived" &&
          (r.status !== "accepted" ||
            !r.evidenceIds.length ||
            r.evidenceIds.some(
              (id) =>
                !e.artifacts.some(
                  (a) => a.id === id && a.status === "accepted",
                ),
            )),
      )
      .map((r) => ({
        id: r.id,
        kind: "request" as const,
        recordId: r.id,
        title: r.subject,
        message:
          r.id + ": required evidence request needs a documented disposition",
      })),
    ...(e.evidenceRequests ?? [])
      .filter((r) => positive && r.disposition === "unobtainable")
      .map((r) => ({
        id: r.id,
        kind: "request" as const,
        recordId: r.id,
        title: r.subject,
        message:
          r.id +
          ": unavailable evidence prevents an unmodified or readiness conclusion",
      })),
  ];
}
export function reportBlockers(e: Engagement, conclusion = "readiness") {
  return completionGates(e, conclusion).map((g) => g.message);
}
/** A final report as it is prepared: its terms and, at capture, particulars. */
export type FinalReport = ReportTerms & { particulars?: ReportParticulars };
/**
 * What must hold before a final report is captured or released: the
 * engagement is in Sign-off and every stage's work is complete, except the
 * release-time records the release itself records. With full report terms
 * the terms must also be a valid combination and the report elements
 * complete, and an assurance engagement needs its engagement quality review;
 * a bare conclusion (or the opinion of a legacy report, captured before
 * report elements existed) checks the evidence gates and an appointed
 * quality reviewer's checklist only.
 */
export function finalReportGates(
  e: Engagement,
  report: FinalReport | string = "readiness",
): AuditGate[] {
  const conclusion = typeof report === "string" ? report : report.conclusion;
  return [
    ...(e.stage !== "Sign-off"
      ? [
          {
            id: "stage",
            kind: "stage" as const,
            title: "Complete lifecycle through Sign-off",
            message:
              "Move the reviewed engagement to Sign-off before final issuance",
          },
        ]
      : []),
    ...completionGates(e, conclusion),
    // The engagement quality review (ISQM 2) before capture; its sign-off of
    // the exact package is checked at release.
    ...qualityReviewGates(
      e,
      typeof report === "string" ? undefined : report.engagementType,
    ),
    ...(typeof report === "string"
      ? []
      : reportElements(e, report, report.particulars)
          .filter((el) => el.problem)
          .map((el) => ({
            id: "report:" + el.id,
            // Independence is recorded only in the acceptance record and the
            // declarations (briefs no longer ask for a note), so the gate
            // opens the acceptance panel, also for an older workflow.
            kind:
              el.id === "independence"
                ? ("acceptance" as const)
                : ("report" as const),
            title: el.label,
            message: el.problem,
          }))),
  ];
}
/**
 * The structured workflow's requirements for releasing a captured final
 * package: approved scope and program, and every in-scope procedure except
 * the release-time records complete.
 */
export const releaseRequirements = (e: Engagement) =>
  workflowRequirements(e, true, procedureScope());
export function stageGates(e: Engagement, target: string): AuditGate[] {
  if (
    stages.indexOf(target) !== stages.indexOf(e.stage) + 1 ||
    !stages.includes(target)
  )
    return [
      {
        id: "stage",
        kind: "stage",
        title: "Advance one stage at a time",
        message: "Progress one lifecycle stage at a time",
      },
    ];
  // Planning exit: the approved scope, program and Planning work, the
  // classification, and acceptance with current, conflict-free declarations
  // (lib/workflow/acceptance.ts).
  if (target === "Fieldwork")
    return [
      ...workflowRequirements(e, false, procedureScope(target)).map((g) => ({
        ...g,
        kind: "workflow" as const,
      })),
      ...acceptanceGates(e),
      ...(e.classification.status !== "approved"
        ? [
            {
              id: "classification",
              kind: "classification" as const,
              title: e.classification.intendedPurpose
                ? "Approve regulatory classification"
                : "Assess and approve classification",
              message: "Planning papers and classification must be approved",
            },
          ]
        : []),
      ...e.papers
        .filter(
          (p) =>
            paperScope(target)(p) &&
            paperRequired(e, p) &&
            p.status !== "signed",
        )
        .map((p) => ({
          id: p.id,
          kind: "paper" as const,
          recordId: p.id,
          title: p.templateId + " · " + p.title,
          message: "Planning papers and classification must be approved",
        })),
    ];
  if (target === "Evidence evaluation")
    return completionGates(e, "adverse")
      .filter((g) => g.kind === "run")
      .map((g) => ({
        ...g,
        message: "Complete diagnostic runs before evidence evaluation",
      }));
  return completionGates(e, "adverse", target);
}
