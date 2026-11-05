"use client";
import type { Engagement, EvidenceRequest, Paper } from "@/lib/domain";
import { EvidenceRequestForm } from "../../evidence-request-form";
import type {
  ModalDefinition,
  ModalFieldsProps,
  ModalSubmitContext,
} from "./types";

/**
 * Choices and checks an evidence-request form opens with: the request's
 * current state (re-read from the engagement), or a new request linked to
 * `paper`.
 */
export function requestFormDefaults(
  e: Engagement | null | undefined,
  request?: EvidenceRequest,
  paper?: Paper,
) {
  const live = request
    ? (e?.evidenceRequests?.find((q) => q.id === request.id) ?? request)
    : undefined;
  return {
    choices: {
      requestId: live?.id ?? "",
      decision: "",
      disposition: "",
      deliveryComplete:
        live?.deliveryComplete === undefined
          ? ""
          : String(live.deliveryComplete),
    },
    checks: Object.fromEntries([
      ...(live?.paperIds ?? (paper ? [paper.id] : [])).map((id) => [
        "paper:" + id,
        true,
      ]),
      ...(live?.evidenceIds ?? []).map((id) => ["evidence:" + id, true]),
    ]),
  };
}
/** One form for every request step; `kind` selects the step. */
function EvidenceRequestFields({
  kind,
  engagement: e,
  choices,
  checks,
  choice,
  check,
}: ModalFieldsProps) {
  return (
    e && (
      <EvidenceRequestForm
        mode={kind}
        request={e.evidenceRequests?.find((r) => r.id === choices.requestId)}
        engagement={e}
        choices={choices}
        checks={checks}
        onChoice={choice}
        onCheck={check}
      />
    )
  );
}
function requireLinkedPaper({ engagement: e, checks }: ModalSubmitContext) {
  if (!e?.papers.some((p) => checks["paper:" + p.id]))
    throw Error("Link at least one working paper supported by this request.");
}
const requestFields = ({
  engagement: e,
  checks,
  values: v,
}: ModalSubmitContext) => ({
  subject: v.subject,
  description: v.description,
  responsibleParty: v.responsibleParty,
  periodVersion: v.periodVersion,
  handling: v.handling,
  dueDate: v.dueDate,
  paperIds: e!.papers.filter((p) => checks["paper:" + p.id]).map((p) => p.id),
});
export const requestModal: ModalDefinition = {
  title: "Request evidence",
  submitLabel: "Create request",
  Fields: EvidenceRequestFields,
  validate: requireLinkedPaper,
  submit: (ctx) => ctx.act("createEvidenceRequest", requestFields(ctx)),
};
export const requestEditModal: ModalDefinition = {
  title: "Edit evidence request",
  submitLabel: "Save request",
  Fields: EvidenceRequestFields,
  validate: requireLinkedPaper,
  submit: (ctx) =>
    ctx.act("updateEvidenceRequest", {
      requestId: ctx.choices.requestId,
      ...requestFields(ctx),
    }),
};
export const requestResponseModal: ModalDefinition = {
  title: "Record received evidence",
  submitLabel: "Record receipt",
  Fields: EvidenceRequestFields,
  validate: ({ choices, checks, engagement: e }) => {
    if (!choices.deliveryComplete)
      throw Error("Record whether the delivery is complete or partial.");
    if (!e?.artifacts.some((a) => checks["evidence:" + a.id]))
      throw Error(
        "Select the received evidence files. Upload them in the vault first if needed.",
      );
  },
  submit: ({ act, choices, checks, values: v, engagement: e }) =>
    act("recordEvidenceResponse", {
      requestId: choices.requestId,
      response: v.response,
      deliveryComplete: choices.deliveryComplete === "true",
      remainingItems: v.remainingItems,
      evidenceIds: e!.artifacts
        .filter((a) => checks["evidence:" + a.id])
        .map((a) => a.id),
    }),
};
export const requestAssessModal: ModalDefinition = {
  title: "Assess evidence",
  submitLabel: "Record assessment",
  Fields: EvidenceRequestFields,
  validate: ({ choices }) => {
    if (!choices.decision)
      throw Error("Choose whether evidence is sufficient or needs follow-up.");
  },
  submit: ({ act, choices, values: v }) =>
    act("assessEvidenceRequest", {
      requestId: choices.requestId,
      decision: choices.decision,
      assessment: v.assessment,
    }),
};
export const requestCloseModal: ModalDefinition = {
  title: "Record limitation / scope change",
  submitLabel: "Record disposition & draft memo",
  Fields: EvidenceRequestFields,
  validate: ({ choices }) => {
    if (!choices.disposition)
      throw Error("Choose the reason for closing this request.");
  },
  submit: ({ act, choices, values: v }) =>
    act("closeEvidenceRequest", {
      requestId: choices.requestId,
      disposition: choices.disposition,
      assessment: v.assessment,
    }),
};
export const requestReopenModal: ModalDefinition = {
  title: "Reopen evidence request",
  submitLabel: "Reopen request",
  Fields: EvidenceRequestFields,
  submit: ({ act, choices, values: v }) =>
    act("reopenEvidenceRequest", {
      requestId: choices.requestId,
      reason: v.reason,
    }),
};
