"use client";
// The engagement quality review (ISQM 2): who reviews the engagement from
// outside its team, their stand-back checklist and their sign-off of the
// exact final package (lib/domain/quality-review.ts). A Lead Auditor
// appoints the reviewer; only the appointed reviewer records the review.
import { useState } from "react";
import { can } from "@/lib/permissions";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Engagement, Role } from "@/lib/domain";
import {
  checklistProblem,
  engagementTeam,
  qualityReviewReleaseProblem,
  qualityReviewRequired,
  qualityReviewerRole,
  standBackChecklist,
  type QualityReviewItem,
} from "@/lib/domain/quality-review";
import { engagementTypes, type ReportTerms } from "@/lib/domain/report-model";
import { releaseState } from "@/lib/workflow-state";
import type { WorkspaceData } from "./workspace-types";

type Props = {
  engagement: Engagement;
  role: Role;
  userId: string;
  people: WorkspaceData["people"];
  terms: ReportTerms;
  busy: boolean;
  onAct: (op: string, data: Record<string, unknown>) => void;
};

const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export function QualityReviewPanel({
  engagement: e,
  role,
  userId,
  people,
  terms,
  busy,
  onAct,
}: Props) {
  const q = e.qualityReview,
    lead = can(role, "appointQualityReviewer"),
    team = engagementTeam(e),
    name = (id: string) =>
      people.find((p) => p.user_id === id)?.display_name || id,
    own = !!q && role === qualityReviewerRole && q.reviewerId === userId,
    required = qualityReviewRequired(e, terms.engagementType),
    candidates = people.filter(
      (p) =>
        p.role === qualityReviewerRole &&
        p.status === "active" &&
        p.user_id !== q?.reviewerId &&
        !team.has(p.user_id),
    );
  const [candidate, setCandidate] = useState("");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<QualityReviewItem[]>(q?.items ?? []);
  const [conclusion, setConclusion] = useState("");
  const [loadedRevision, setLoadedRevision] = useState(q?.revision);
  // A saved checklist (or a new reviewer) replaces the local copy.
  if (q?.revision !== loadedRevision) {
    setLoadedRevision(q?.revision);
    setItems(q?.items ?? []);
  }
  const answer = (id: QualityReviewItem["id"]) =>
    items.find((i) => i.id === id) ?? {
      id,
      status: "concern" as const,
      notes: "",
    };
  const setAnswer = (next: QualityReviewItem) =>
    setItems((old) => [...old.filter((i) => i.id !== next.id), next]);
  const dirty =
    !!q &&
    JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id))) !==
      JSON.stringify([...q.items].sort((a, b) => a.id.localeCompare(b.id)));
  const packages = e.reports.filter(
    (r) =>
      r.kind === "final" && ["internal", "approved"].includes(releaseState(r)),
  );
  const problem = q ? checklistProblem(q) : "";
  const reviewerOnTeam = !!q && team.has(q.reviewerId);
  return (
    <section className="quality-review" aria-labelledby="quality-review-title">
      <header className="quality-review-head">
        <div>
          <h3 id="quality-review-title">
            <ShieldCheck size={17} aria-hidden="true" /> Engagement quality
            review
          </h3>
          <p className="subtle">
            {required
              ? q
                ? "Required: the appointed reviewer completes the stand-back checklist before final capture and signs off both exact packages before release."
                : engagementTypes[terms.engagementType]?.label +
                  " needs an engagement quality reviewer outside the engagement team before final issuance."
              : "Not required for " +
                (engagementTypes[terms.engagementType]?.label ?? "this type") +
                ". A Lead Auditor may still appoint a reviewer under firm policy; the review is then required."}
          </p>
        </div>
        <span
          className={
            "badge " +
            (!required
              ? "neutral"
              : q && !problem && !reviewerOnTeam
                ? "green"
                : "amber")
          }
        >
          {!q
            ? required
              ? "Reviewer needed"
              : "Not required"
            : reviewerOnTeam
              ? "Reviewer not independent"
              : problem
                ? "Review in progress"
                : "Checklist complete"}
        </span>
      </header>

      <div className="quality-review-card">
        <h4>Reviewer</h4>
        {q ? (
          <dl>
            <div>
              <dt>Engagement quality reviewer</dt>
              <dd>{name(q.reviewerId)}</dd>
            </div>
            <div>
              <dt>Appointed</dt>
              <dd>
                {date(q.appointedAt)} by {name(q.appointedBy)}: {q.reason}
              </dd>
            </div>
            <div>
              <dt>Eligibility</dt>
              <dd>
                {reviewerOnTeam
                  ? "On the engagement team: not eligible. Appoint another reviewer."
                  : "Outside the engagement team; cooling-off of " +
                    q.coolingOffDays +
                    " days checked against the client's other engagements at appointment."}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="subtle">No reviewer is appointed.</p>
        )}
        {lead && (
          <form
            className="quality-review-appoint"
            onSubmit={(event) => {
              event.preventDefault();
              onAct("appointQualityReviewer", {
                userId: candidate,
                reason: reason.trim(),
              });
              setReason("");
            }}
          >
            <label>
              {q ? "Replace the reviewer" : "Appoint a reviewer"}
              <select
                value={candidate}
                onChange={(event) => setCandidate(event.target.value)}
              >
                <option value="">Select an eligible reviewer</option>
                {candidates.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.display_name || p.user_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason
              <Textarea
                value={reason}
                maxLength={5000}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this reviewer, and why now"
              />
            </label>
            <p className="subtle">
              Only members with the Engagement Quality Reviewer role and access
              to this engagement are listed; nobody who prepared, reviewed or
              led its work is eligible.
            </p>
            <Button
              type="submit"
              disabled={busy || !candidate || !reason.trim()}
            >
              {q ? "Replace reviewer" : "Appoint reviewer"}
            </Button>
          </form>
        )}
      </div>

      {q && (
        <div className="quality-review-card">
          <h4>Stand-back checklist</h4>
          <p className="subtle">
            {own
              ? "Record what you evaluated for each item. An item stays open while you have a concern; saving after a sign-off requires a new sign-off."
              : "Recorded by the engagement quality reviewer. Engagement team members cannot change it."}
          </p>
          <ol className="quality-review-checklist">
            {standBackChecklist.map((item) => {
              const a = answer(item.id);
              return (
                <li key={item.id}>
                  <div>
                    <b>{item.title}</b> <small>{item.clause}</small>
                  </div>
                  {own ? (
                    <>
                      <label>
                        Result
                        <select
                          value={a.status}
                          onChange={(event) =>
                            setAnswer({
                              ...a,
                              status: event.target
                                .value as QualityReviewItem["status"],
                            })
                          }
                        >
                          <option value="concern">Open or concern</option>
                          <option value="satisfied">Satisfied</option>
                        </select>
                      </label>
                      <label>
                        Notes
                        <Textarea
                          value={a.notes}
                          maxLength={5000}
                          onChange={(event) =>
                            setAnswer({ ...a, notes: event.target.value })
                          }
                        />
                      </label>
                    </>
                  ) : (
                    <p>
                      <span
                        className={
                          "badge " +
                          (q.items.find((i) => i.id === item.id)?.status ===
                          "satisfied"
                            ? "green"
                            : "neutral")
                        }
                      >
                        {q.items.find((i) => i.id === item.id)?.status ===
                        "satisfied"
                          ? "Satisfied"
                          : q.items.some((i) => i.id === item.id)
                            ? "Concern"
                            : "Not recorded"}
                      </span>{" "}
                      {q.items.find((i) => i.id === item.id)?.notes}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          {own && (
            <Button
              disabled={busy || !dirty}
              onClick={() =>
                onAct("saveQualityReview", {
                  items: items.map((i) => ({ ...i, notes: i.notes.trim() })),
                })
              }
            >
              Save checklist
            </Button>
          )}
        </div>
      )}

      {q && (
        <div className="quality-review-card">
          <h4>Package sign-off</h4>
          {packages.length ? (
            <ul className="quality-review-packages">
              {packages.map((r) => {
                const signed = !qualityReviewReleaseProblem(
                  { ...e, qualityReview: q },
                  r,
                );
                const signOff = q.signOffs
                  .filter(
                    (s) => s.reportId === r.id && s.userId === q.reviewerId,
                  )
                  .at(-1);
                return (
                  <li key={r.id}>
                    <div>
                      <b>Final package {r.id}</b>{" "}
                      <span className={"badge " + (signed ? "green" : "amber")}>
                        {signed ? (
                          <>
                            <CheckCircle2 size={13} aria-hidden="true" /> Signed
                            off
                          </>
                        ) : signOff ? (
                          "Sign-off outdated"
                        ) : (
                          "Awaiting sign-off"
                        )}
                      </span>
                      <small className="block subtle">
                        Internal {r.sha256.slice(0, 12)} · client{" "}
                        {(r.clientSha256 ?? "").slice(0, 12)}
                        {signOff &&
                          " · signed " +
                            date(signOff.at) +
                            ": " +
                            signOff.conclusion}
                      </small>
                    </div>
                    {own && !signed && (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          onAct("signOffQualityReview", {
                            reportId: r.id,
                            internalHash: r.sha256,
                            clientHash: r.clientSha256 ?? "",
                            conclusion: conclusion.trim(),
                          });
                          setConclusion("");
                        }}
                      >
                        <label>
                          Your conclusion
                          <Textarea
                            value={conclusion}
                            maxLength={5000}
                            onChange={(event) =>
                              setConclusion(event.target.value)
                            }
                            placeholder="Nothing came to my attention that the significant judgments or the conclusion are not appropriate."
                          />
                        </label>
                        <Button
                          type="submit"
                          disabled={
                            busy || !!problem || dirty || !conclusion.trim()
                          }
                        >
                          Sign off both packages
                        </Button>
                        {(problem || dirty) && (
                          <small className="block subtle">
                            {dirty
                              ? "Save the checklist before signing off."
                              : problem + "."}
                          </small>
                        )}
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="subtle">
              No final package awaits release. The reviewer signs off the exact
              packages after a Lead Auditor captures them.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
