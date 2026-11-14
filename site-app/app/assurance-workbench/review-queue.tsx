"use client";

import { ChevronRight } from "lucide-react";
import type { AssuranceRecord } from "@/lib/assurance-core";
import type {
  ReviewQueueSummary,
  SearchedRecord,
} from "@/lib/assurance-search";
import { RecordRegister, type SearchScope } from "../assurance-record-search";
import { recordTitle } from "../assurance-register";

/** The caller's assessment review queue: its counts, next item and lists. */
export function ReviewQueue({
  queue,
  scope,
  refreshKey,
  listed,
  onListed,
  person,
  onOpen,
}: {
  queue: ReviewQueueSummary;
  scope: SearchScope;
  refreshKey: unknown;
  // Whether the queue is listed (its pages load only when opened).
  listed: boolean;
  onListed: (listed: boolean) => void;
  person: (id: string) => string;
  onOpen: (
    record: AssuranceRecord | null,
    section?: "overview" | "review",
  ) => void;
}) {
  const nextAssessment: SearchedRecord | null =
    queue.next.reviewable ??
    queue.next.revisable ??
    queue.next.awaiting ??
    queue.next.returned;
  const nextAction = queue.reviewable
    ? "Review next assessment"
    : queue.revisable
      ? "Revise returned assessment"
      : "View next assessment";
  return (
    <section
      className="workbench-review-queue"
      aria-label="Assessment review queue"
    >
      <div className="workbench-queue-head">
        <h2>Assessment review</h2>
        {queue.canReview && (
          <span className="subtle">
            {queue.reviewable.toLocaleString()} available for your independent
            review
          </span>
        )}
      </div>
      <div className="workbench-queue-counts">
        {queue.awaiting > 0 && (
          <button
            type="button"
            onClick={() =>
              onOpen(
                queue.next.reviewable ?? queue.next.awaiting,
                queue.reviewable ? "review" : "overview",
              )
            }
          >
            <b>{queue.awaiting.toLocaleString()}</b>
            <span>Awaiting review</span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        )}
        {queue.returned > 0 && (
          <button
            type="button"
            onClick={() => onOpen(queue.next.returned, "review")}
          >
            <b>{queue.returned.toLocaleString()}</b>
            <span>Returned for revision</span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {nextAssessment && (
        <button
          type="button"
          className="workbench-next-review"
          onClick={() => onOpen(nextAssessment, "review")}
        >
          <span>
            <small>{nextAction}</small>
            <b>{recordTitle(nextAssessment)}</b>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}
      <details
        className="workbench-queue-list"
        onToggle={(ev) => onListed(ev.currentTarget.open)}
      >
        <summary>List the review queue</summary>
        {listed && queue.awaiting > 0 && (
          <>
            <h3>
              {queue.canReview
                ? "Available for your independent review"
                : "Awaiting review"}
            </h3>
            <RecordRegister
              scope={scope}
              query={{ queue: queue.canReview ? "reviewable" : "awaiting" }}
              refreshKey={refreshKey}
              hasRecords
              onOpen={(r) => onOpen(r, queue.canReview ? "review" : "overview")}
              empty="None of the assessments awaiting review is yours to review."
              person={person}
            />
          </>
        )}
        {listed && queue.returned > 0 && (
          <>
            <h3>Returned for revision</h3>
            <RecordRegister
              scope={scope}
              query={{ queue: "returned" }}
              refreshKey={refreshKey}
              hasRecords
              onOpen={(r) => onOpen(r, "review")}
              empty="No assessment is returned for revision."
              person={person}
            />
          </>
        )}
      </details>
    </section>
  );
}
