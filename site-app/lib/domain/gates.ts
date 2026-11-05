// Audit gates: what must hold before an engagement moves to the next
// lifecycle stage and before a final report can be issued.
import { workflowRequirements } from "../workflow-state";
import type { Engagement, Paper } from "./types";
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
    | "workflow";
  recordId?: string;
  title: string;
  message: string;
};
export function paperRequired(e: Engagement, p: Paper) {
  const linked =
    e.workflow?.program.status === "approved"
      ? e.workflow.procedures.find((q) => q.paperId === p.id)
      : undefined;
  return (
    p.required &&
    (!linked ||
      (linked.selected &&
        ["applicable", "readiness"].includes(linked.applicability)))
  );
}
export function completionGates(
  e: Engagement,
  opinion = "Readiness assessment",
): AuditGate[] {
  return [
    ...workflowRequirements(e, true).map((g) => ({
      ...g,
      kind: "workflow" as const,
    })),
    ...(opinion === "Readiness assessment"
      ? (e.workflow?.procedures ?? [])
          .filter(
            (p) =>
              !p.selected &&
              p.applicability === "applicable" &&
              p.stage !== "Remediation and Monitoring",
          )
          .map((p) => ({
            id: p.id,
            kind: "workflow" as const,
            recordId: p.id,
            title: p.title,
            message:
              p.templateId +
              ": an applicable procedure outside audit scope prevents a readiness opinion",
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
    ...(opinion === "Readiness assessment" && e.classification.prohibited
      ? [
          {
            id: "prohibited",
            kind: "classification" as const,
            title: "Prohibited practice prevents a readiness opinion",
            message:
              "A prohibited practice cannot receive a positive readiness opinion",
          },
        ]
      : []),
    ...e.papers
      .filter(
        (p) =>
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
          opinion === "Readiness assessment" &&
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
          p.templateId + ": conclusion does not support a readiness opinion",
      })),
    ...e.findings
      .filter(
        (f) =>
          opinion === "Readiness assessment" &&
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
      .filter(
        (r) =>
          opinion === "Readiness assessment" &&
          r.disposition === "unobtainable",
      )
      .map((r) => ({
        id: r.id,
        kind: "request" as const,
        recordId: r.id,
        title: r.subject,
        message: r.id + ": unavailable evidence prevents a readiness opinion",
      })),
  ];
}
export function reportBlockers(
  e: Engagement,
  opinion = "Readiness assessment",
) {
  return completionGates(e, opinion).map((g) => g.message);
}
export function finalReportGates(
  e: Engagement,
  opinion = "Readiness assessment",
): AuditGate[] {
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
    ...completionGates(e, opinion),
  ];
}
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
  if (target === "Fieldwork")
    return [
      ...workflowRequirements(e).map((g) => ({
        ...g,
        kind: "workflow" as const,
      })),
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
            p.stage === "Planning" &&
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
    return completionGates(e, "Adverse conclusion")
      .filter((g) => g.kind === "run")
      .map((g) => ({
        ...g,
        message: "Complete diagnostic runs before evidence evaluation",
      }));
  return ["Reporting", "Sign-off"].includes(target)
    ? completionGates(e, "Adverse conclusion")
    : [];
}
