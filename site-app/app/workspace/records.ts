// Pure helpers for the records the workspace opens: how a record in the
// record sheet is recognised, looked up by link kind, titled and refreshed.
import type {
  Engagement,
  EvidenceRequest,
  Finding,
  Report,
} from "@/lib/domain";
import type { WorkspaceData } from "../workspace-types";

/** Engagement records that open in the record sheet and have a link kind. */
export const sheetRecordKinds = [
  "evidence",
  "request",
  "finding",
  "report",
  "model",
  "run",
] as const;
export type SheetRecordKind = (typeof sheetRecordKinds)[number];
export const isSheetRecordKind = (kind: string): kind is SheetRecordKind =>
  (sheetRecordKinds as readonly string[]).includes(kind);

/**
 * Link kind of a record shown in the record sheet. Records carry no type tag,
 * so each kind is recognised by a field only that record type has; a record
 * that matches none (a template or an audit event) has no link kind.
 */
export function recordKind(record: object): SheetRecordKind | "" {
  return "category" in record
    ? "evidence"
    : "responsibleParty" in record
      ? "request"
      : "riskScore" in record
        ? "finding"
        : "snapshot" in record
          ? "report"
          : "suite" in record
            ? "run"
            : "format" in record
              ? "model"
              : "";
}

/** Finds an engagement record by link kind; undefined for other kinds. */
export function findRecord(engagement: Engagement, kind: string, id: string) {
  return kind === "evidence"
    ? engagement.artifacts.find((a) => a.id === id)
    : kind === "request"
      ? engagement.evidenceRequests?.find((r) => r.id === id)
      : kind === "finding"
        ? engagement.findings.find((f) => f.id === id)
        : kind === "report"
          ? engagement.reports.find((r) => r.id === id)
          : kind === "model"
            ? engagement.models.find((m) => m.id === id)
            : kind === "run"
              ? engagement.runs.find((r) => r.id === id)
              : undefined;
}
export type EngagementRecord = NonNullable<ReturnType<typeof findRecord>>;

export const reportTitle = (report: Pick<Report, "kind" | "createdAt">) =>
  (report.kind === "final" ? "Final report" : "Draft report") +
  " · " +
  new Date(report.createdAt).toLocaleDateString();

/** Sheet title for a record opened from a link. */
export function recordTitle(record: EngagementRecord) {
  return "snapshot" in record
    ? reportTitle(record)
    : "title" in record
      ? record.title
      : "name" in record
        ? record.name
        : "subject" in record
          ? record.subject
          : "suite" in record
            ? "Diagnostic run"
            : "Audit record";
}

/**
 * The sheet keeps the record it was opened with; findings and evidence
 * requests are re-read from the current engagement so they show saved changes.
 */
export function liveRecord(
  value: unknown,
  engagement: Engagement | null | undefined,
) {
  return value && typeof value === "object" && "id" in value
    ? (("condition" in value
        ? engagement?.findings.find((f) => f.id === (value as Finding).id)
        : "responsibleParty" in value
          ? engagement?.evidenceRequests?.find(
              (r) => r.id === (value as EvidenceRequest).id,
            )
          : undefined) ?? value)
    : value;
}

/** Display name for a person, artifact, model or paper id. */
export function nameResolver(data: WorkspaceData | null) {
  const e = data?.engagement;
  return (id: string) =>
    data?.people.find((p) => p.user_id === id)?.display_name ??
    (id === data?.identity.id ? data.identity.name : undefined) ??
    e?.artifacts.find((a) => a.id === id)?.name ??
    e?.models.find((m) => m.id === id)?.name ??
    e?.papers.find((p) => p.id === id)?.title ??
    id;
}
