"use client";
import {
  ChevronRight,
  Layers,
  FileText,
  Link2,
  ClipboardCheck,
} from "lucide-react";
import type { AssuranceRecord } from "@/lib/assurance-core";
import type { ReactNode } from "react";
import type { SearchedRecord } from "@/lib/assurance-search";
import { workbenchReviewState } from "@/lib/workbench-presentation";
import { humanLabel } from "@/lib/presentation";
export const recordReviewState = workbenchReviewState;
export function recordTitle(r: AssuranceRecord) {
  const b = r.body,
    fallback =
      r.kind === "prediction"
        ? "Predictions · " + b.producingRun
        : r.kind === "sample"
          ? "Sample · " + (b.selected?.length ?? b.size ?? 0) + " records"
          : r.kind === "assistant"
            ? "Evidence briefing · " +
              humanLabel(String(b.action ?? "summary")).toLowerCase()
            : r.kind === "registry"
              ? "Registry snapshot"
              : r.kind === "operational"
                ? "Operational reconciliation"
                : r.kind === "statistics"
                  ? "Population statistics"
                  : r.kind === "access_event"
                    ? "Access decision"
                    : humanLabel(r.kind);
  return String(
    b.name ??
      b.label ??
      b.statement ??
      b.description ??
      b.title ??
      b.artifactName ??
      fallback,
  );
}
function recordContext(r: AssuranceRecord) {
  const b = r.body;
  return r.kind === "system"
    ? String(b.intendedUse ?? "")
    : r.kind === "prediction"
      ? String(b.producingRun ?? "")
      : r.kind === "location"
        ? String(b.artifactName ?? "") + " — " + String(b.locator ?? "")
        : r.kind === "obligation"
          ? String(b.article ?? "") + " · " + String(b.actor ?? "")
          : r.kind === "assertion"
            ? String(b.criterion ?? "")
            : r.kind === "sample"
              ? String(b.method ?? "").replaceAll("_", " ") +
                " · " +
                String(b.selected?.length ?? 0) +
                " selected"
              : r.kind === "assistant"
                ? String(b.items?.length ?? 0) + " cited items"
                : String(b.auditorAssessment ?? b.assessment ?? "");
}
/**
 * Rows of a register. Each assessment row shows the review state the server
 * computed for it (lib/assurance-search.ts), so a register never needs every
 * record of the engagement.
 */
export function AssuranceRegister({
  rows,
  onOpen,
  empty,
  filtered,
  person,
  onReset,
  emptyAction,
}: {
  rows: SearchedRecord[];
  onOpen: (r: SearchedRecord) => void;
  empty: string;
  filtered: boolean;
  person: (id: string) => string;
  onReset?: () => void;
  emptyAction?: ReactNode;
}) {
  if (!rows.length)
    return (
      <div className="assurance-register-empty">
        <p>{filtered ? "No records match these filters." : empty}</p>
        {filtered && onReset ? (
          <button type="button" onClick={onReset}>
            Clear filters
          </button>
        ) : (
          !filtered && emptyAction
        )}
      </div>
    );
  return (
    <div className="assurance-register">
      <div className="assurance-register-head" aria-hidden="true">
        <span>Record</span>
        <span>Recorded by</span>
        <span>Status</span>
        <span />
      </div>
      {rows.map((r) => {
        const assessed = ["assertion", "obligation", "impact"].includes(r.kind),
          state = assessed
            ? (r.reviewState ?? "Awaiting review")
            : (r.body.conclusion ??
              r.body.decision ??
              (r.kind === "system"
                ? "Revision " + r.body.version
                : r.kind === "location"
                  ? "Source location"
                  : r.kind === "prediction"
                    ? "Declared lineage"
                    : r.kind === "registry"
                      ? "Imported proposal"
                      : r.kind === "assistant"
                        ? "Draft proposal"
                        : "Diagnostic")),
          Icon =
            r.kind === "system"
              ? Layers
              : r.kind === "location"
                ? Link2
                : assessed
                  ? ClipboardCheck
                  : FileText;
        return (
          <button
            type="button"
            key={r.id}
            className="assurance-record-row"
            onClick={() => onOpen(r)}
          >
            <span className="assurance-record-name">
              <Icon size={16} aria-hidden="true" />
              <span>
                <b>{recordTitle(r)}</b>
                <small>{recordContext(r)}</small>
              </span>
            </span>
            <span className="assurance-record-person">
              {person(r.actor)}
              <small>
                {new Date(r.createdAt).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </small>
            </span>
            <span
              className={
                "badge " +
                (state === "Confirmed"
                  ? "green"
                  : state === "Returned"
                    ? "amber"
                    : "neutral")
              }
            >
              {humanLabel(String(state))}
            </span>
            <ChevronRight
              size={15}
              aria-hidden="true"
              className="assurance-record-chevron"
            />
          </button>
        );
      })}
    </div>
  );
}
