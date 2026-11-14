"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AssuranceRecord } from "@/lib/assurance-core";
import type { useRecordContext } from "../assurance-record-search";
import { label, type Act, type Engagement, type OpenForm } from "./types";

/**
 * The review part of an open record: its independent reviews, the successor
 * revision and the review form of an assessment, or the adoption form of an
 * evidence briefing.
 */
export function RecordReview({
  selected,
  related,
  details,
  engagement: e,
  identityId,
  writer,
  reviewer,
  busy,
  dirty,
  error,
  setDirty,
  person,
  act,
  open,
  remember,
  onClose,
}: {
  selected: AssuranceRecord;
  related: AssuranceRecord[];
  details: ReturnType<typeof useRecordContext>;
  engagement: Engagement;
  identityId: string;
  writer: boolean;
  reviewer: boolean;
  busy: boolean;
  dirty: boolean;
  error: string;
  setDirty: (dirty: boolean) => void;
  person: (id: string) => string;
  act: Act;
  open: OpenForm;
  remember: (...records: AssuranceRecord[]) => void;
  /** Closes the record without asking (its location loses the record id). */
  onClose: () => void;
}) {
  const assessed = ["assertion", "impact", "obligation"].includes(
      selected.kind,
    ),
    reviews = related.filter(
      (r) =>
        r.kind === selected.kind + "_review" &&
        (r.body.assertionId ?? r.body.impactId ?? r.body.obligationId) ===
          selected.id,
    );
  return (
    <fieldset disabled={busy}>
      {dirty && (
        <p className="subtle">
          Save your review or close this record before opening linked evidence.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {assessed &&
        !details.context &&
        (details.error ? (
          <p className="form-error" role="alert">
            {details.error}
          </p>
        ) : (
          <p className="subtle" role="status">
            Loading the review history…
          </p>
        ))}
      {assessed && details.context && (
        <>
          <h3>Independent review</h3>
          {!reviews.length && (
            <p className="subtle">No independent review has been recorded.</p>
          )}
          {reviews.map((r) => (
            <div className="record-item" key={r.id}>
              <b>{label(r.body.decision)}</b>
              <p>{r.body.reason}</p>
              <small className="subtle">
                {person(r.actor)} · {new Date(r.createdAt).toLocaleString()}
              </small>
            </div>
          ))}
          {related.some((r) => r.body.supersedesId === selected.id) ? (
            <p className="subtle">
              A successor revision replaces this assessment for current review
              gates.
            </p>
          ) : (
            <>
              {writer && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (dirty && !window.confirm("Discard unsaved review?"))
                      return;
                    // The revision's sources and affected records
                    // keep their titles in the pickers.
                    remember(...related);
                    onClose();
                    open(
                      selected.kind === "assertion"
                        ? "addAssertion"
                        : selected.kind === "obligation"
                          ? "obligationDecision"
                          : "impact",
                      selected,
                    );
                  }}
                >
                  Create successor revision
                </Button>
              )}
              {reviewer && selected.actor !== identityId && (
                <form
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    const v = Object.fromEntries(
                        new FormData(ev.currentTarget),
                      ),
                      k = selected.kind;
                    void act(
                      k === "assertion"
                        ? "reviewAssertion"
                        : k === "impact"
                          ? "reviewImpact"
                          : "reviewObligation",
                      { [k + "Id"]: selected.id, ...v },
                    )
                      .then(() => {
                        setDirty(false);
                        onClose();
                      })
                      .catch(() => {});
                  }}
                  onChange={() => setDirty(true)}
                >
                  <label className="workbench-field">
                    Independent decision
                    <select
                      name="decision"
                      aria-label="Independent decision"
                      required
                    >
                      <option value="">Choose…</option>
                      <option
                        value={
                          selected.kind === "assertion"
                            ? "approve"
                            : "confirmed"
                        }
                      >
                        Confirm assessment
                      </option>
                      <option
                        value={
                          selected.kind === "assertion" ? "return" : "returned"
                        }
                      >
                        Return for revision
                      </option>
                    </select>
                  </label>
                  <label className="workbench-field">
                    Review reasoning
                    <Textarea
                      name="reason"
                      aria-label="Review reasoning"
                      required
                      placeholder="Explain source sufficiency, contradictions and the basis for your decision."
                    />
                  </label>
                  <Button type="submit" disabled={busy}>
                    {busy ? "Recording review…" : "Record independent review"}
                  </Button>
                </form>
              )}
            </>
          )}
        </>
      )}
      {selected.kind === "assistant" && writer && (
        <form
          onChange={() => setDirty(true)}
          onSubmit={(ev) => {
            ev.preventDefault();
            const v = Object.fromEntries(new FormData(ev.currentTarget));
            void act("acceptAssistant", {
              assistantId: selected.id,
              ...v,
            })
              .then(() => {
                setDirty(false);
                onClose();
              })
              .catch(() => {});
          }}
        >
          <label className="workbench-field">
            Auditor-edited draft
            <Textarea
              name="editedText"
              required
              defaultValue={(selected.body.items ?? [])
                .map((i: { text: string }) => i.text)
                .join("\n\n")}
            />
          </label>
          <label className="workbench-field">
            Supplementary draft paper
            <select name="paperId" required>
              <option value="">Choose…</option>
              {e.papers
                .filter(
                  (p) =>
                    p.status === "draft" &&
                    !e.workflow?.procedures.some((q) => q.paperId === p.id),
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.templateId} · {p.title}
                  </option>
                ))}
            </select>
          </label>
          <Button disabled={busy} type="submit">
            Adopt edited draft
          </Button>
        </form>
      )}
    </fieldset>
  );
}
