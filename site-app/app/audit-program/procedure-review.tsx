"use client";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Paper, Role } from "@/lib/domain/types";
import type { Procedure, ProcedureChange } from "@/lib/workflow-types";
import { decisionState } from "@/lib/permissions";
import { useAttest } from "../workspace/attestation-dialog";
import { DecisionButton } from "../workspace/decision-button";
import { ProcedureComparison } from "../revision-comparison";
import { reason } from "./fields";
import type { ProgramScope } from "./program-scope";
// The change that replaced a procedure history entry's state.
const procedureChanges: Record<ProcedureChange, string> = {
  plan: "Plan changed",
  execute: "Execution recorded",
  evaluate: "Evaluation recorded",
  reaffirm: "Impact reviewed",
  return: "Returned",
};
/** The review section of a procedure: comparison, review decisions and sign-off. */
export function ProcedureReview({
  scope,
  p,
  onLeave,
  onContext,
  onPaper,
}: {
  scope: ProgramScope;
  p: Procedure;
  /** Closes the procedure sheet. */
  onLeave: () => void;
  onContext: (id: string) => void;
  onPaper: (p: Paper) => void;
}) {
  const { e, uid, role, busy, reviewer, name } = scope,
    { command } = scope.forms;
  const attest = useAttest();
  return (
    <>
      <ProcedureComparison
        procedure={p}
        userId={uid}
        resolve={(id) =>
          e.artifacts.find((a) => a.id === id)?.name ??
          e.models.find((m) => m.id === id)?.name ??
          e.evaluationProfiles?.find((a) => a.id === id)?.name ??
          name(id)
        }
      />
      <p>
        Assigned reviewer: <b>{name(p.reviewerId)}</b>
      </p>
      {p.review && (
        <div className="comment-box">
          <b>Reviewed by {name(p.review.userId)}</b>
          <p>{p.review.reason}</p>
          <small>{new Date(p.review.at).toLocaleString()}</small>
        </div>
      )}
      {p.paperId && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            const q = e.papers.find((q) => q.id === p.paperId);
            onContext(p.id);
            onLeave();
            if (q) onPaper(q);
          }}
        >
          <FileText size={15} />
          Open working paper, comments & sign-off
        </Button>
      )}
      <div className="row-actions workflow-note">
        {reviewer && p.state === "submitted" && (
          <>
            <Button
              disabled={
                busy || p.reviewerId !== uid || p.contributors.includes(uid)
              }
              onClick={() =>
                command(
                  "Approve procedure revision",
                  "reviewProcedure",
                  reason(),
                  { procedureId: p.id },
                  "Approve procedure",
                )
              }
            >
              Approve reviewed work
            </Button>
            <Button
              variant="outline"
              disabled={
                busy || p.reviewerId !== uid || p.contributors.includes(uid)
              }
              onClick={() =>
                command(
                  "Return procedure for correction",
                  "returnProcedure",
                  reason(),
                  { procedureId: p.id },
                  "Request changes",
                )
              }
            >
              Request changes
            </Button>
          </>
        )}
        <SignBoundPaper
          paper={
            p.state === "reviewed"
              ? e.papers.find((q) => q.id === p.paperId)
              : undefined
          }
          role={role}
          userId={uid}
          busy={busy}
          onSign={(paperId) => attest("signPaper", { paperId })}
        />
      </div>
      <details className="provenance">
        <summary>Procedure revision history ({p.history.length})</summary>
        {p.history
          .slice()
          .reverse()
          .map((h, i) => (
            <div className="comment-box" key={i}>
              <b>
                Plan {h.revision} · execution{" "}
                {h.execution?.revision ?? "not recorded"}
              </b>
              <p>{h.execution?.results ?? h.plan.rationale}</p>
              <small>
                Preparer {name(h.plan.ownerId)} · reviewer{" "}
                {name(h.plan.reviewerId)} · due {h.plan.dueDate || "not set"}
              </small>
              <small>
                {h.action && procedureChanges[h.action] + " by "}
                {name(h.actor)} · {new Date(h.at).toLocaleString()}
              </small>
            </div>
          ))}
      </details>
    </>
  );
}
/** Signs the reviewed paper a procedure compiled, once it is independently reviewed. */
function SignBoundPaper({
  paper,
  role,
  userId,
  busy,
  onSign,
}: {
  paper: Paper | undefined;
  role: Role;
  userId: string;
  busy: boolean;
  onSign: (paperId: string) => void;
}) {
  if (paper?.status !== "reviewed") return null;
  return (
    <DecisionButton
      state={decisionState(role, userId, { action: "signPaper", paper })}
      disabled={busy}
      onClick={() => onSign(paper.id)}
    >
      Sign working paper
    </DecisionButton>
  );
}
