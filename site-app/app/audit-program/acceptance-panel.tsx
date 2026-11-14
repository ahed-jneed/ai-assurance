"use client";
// The audit program's acceptance panel: the acceptance and continuance
// record a Lead Auditor approves, each team member's dated independence and
// competence declaration, the evaluation of declared threats and the team's
// competence matrix. lib/workflow/acceptance.ts holds the rules the
// Planning-exit gate applies; acceptance-forms.ts opens the panel's forms and
// team-declarations.tsx renders its team tables.
import { Button } from "@/components/ui/button";
import { can, decisionState } from "@/lib/permissions";
import { DecisionButton } from "../workspace/decision-button";
import type { Engagement, Role } from "@/lib/domain/types";
import {
  acceptancePrompt,
  approvalRefusal,
  currentDeclaration,
  engagementTeam,
} from "@/lib/workflow/acceptance";
import { acceptancePreconditions } from "@/lib/workflow-types";
import type { Form, WorkflowAct } from "./workflow-dialog";
import type { WorkspaceData } from "../workspace-types";
import { accessLabels, preconditionLabels } from "./acceptance-labels";
import { acceptanceForms } from "./acceptance-forms";
import { CompetenceMatrix, DeclarationsTable } from "./team-declarations";

export function AcceptancePanel({
  data,
  busy,
  act,
  onForm,
}: {
  data: WorkspaceData;
  busy: boolean;
  act: WorkflowAct;
  onForm: (form: Form) => void;
}) {
  const e = data.engagement as Engagement,
    w = e.workflow!,
    a = w.acceptance,
    uid = data.identity.id,
    role: Role = data.identity.role,
    lead = can(role, "approveAcceptance"),
    reviewer = can(role, "resolveDeclaredThreat"),
    internal = can(role, "saveDeclaration");
  const name = (id: string) =>
    data.people.find((m) => m.user_id === id)?.display_name ?? id;
  const team = engagementTeam(w),
    prompt = acceptancePrompt(e),
    // The server's own precondition for approving, with its reason.
    refusal = approvalRefusal(w, uid, name);

  const {
    acceptanceForm,
    declarationForm,
    resolveForm,
    withdrawForm,
    approveForm,
  } = acceptanceForms({ data, act, onForm, name });

  const declarants = [
    ...new Set([
      ...team,
      ...(w.declarations ?? [])
        .filter((d) => currentDeclaration(w, d.userId) === d)
        .map((d) => d.userId),
    ]),
  ];
  const own = currentDeclaration(w, uid);
  return (
    <section className="panel workflow-document acceptance-panel">
      <div className="panel-head">
        <h2>Acceptance and independence</h2>
        <span
          className={
            "badge " + (a?.status === "approved" ? "green" : "neutral")
          }
        >
          {a ? a.status + " · revision " + a.revision : "Not recorded"}
        </span>
      </div>
      {prompt && (
        <p className="warning-card" role="status">
          {prompt}
        </p>
      )}
      <h3>Acceptance and continuance</h3>
      {a ? (
        <>
          <dl className="document-properties">
            <div>
              <dt>Decision</dt>
              <dd>
                {a.decision === "acceptance" ? "New engagement" : "Continuance"}
              </dd>
            </div>
            <div>
              <dt>Period</dt>
              <dd>
                {a.periodStart} — {a.periodEnd}
              </dd>
            </div>
            <div>
              <dt>Access level</dt>
              <dd>{accessLabels[a.accessLevel]}</dd>
            </div>
            <div>
              <dt>Engagement letter</dt>
              <dd>{a.engagementLetter}</dd>
            </div>
            <div>
              <dt>Approval</dt>
              <dd>
                {a.approval
                  ? name(a.approval.userId) +
                    " · " +
                    new Date(a.approval.at).toLocaleString() +
                    (a.approval.stage !== "Planning"
                      ? " · during " + a.approval.stage
                      : "")
                  : "Lead Auditor approval needed"}
              </dd>
            </div>
          </dl>
          <ul className="acceptance-preconditions">
            {acceptancePreconditions.map((k) => (
              <li key={k}>
                <span
                  className={
                    "badge " + (a.preconditions[k].met ? "green" : "red")
                  }
                >
                  {a.preconditions[k].met ? "Met" : "Not met"}
                </span>{" "}
                <b>{preconditionLabels[k]}</b>
                <p className="record-text">{a.preconditions[k].basis}</p>
              </li>
            ))}
          </ul>
          {(
            [
              ["scope", "Scope"],
              ["systemBoundary", "System boundary"],
              ["competenceConclusion", "Collective competence"],
              ["changeReason", "Reason for the latest change"],
            ] as const
          ).map(
            ([k, t]) =>
              a[k] && (
                <section className="readable-section" key={k}>
                  <h3>{t}</h3>
                  <p className="record-text">{a[k]}</p>
                </section>
              ),
          )}
          {a.approval && (
            <p className="record-text">
              Acceptance rationale: {a.approval.reason}
            </p>
          )}
          {a.history.length > 0 && (
            <details className="provenance">
              <summary>Approved revisions ({a.history.length})</summary>
              {a.history.map((h) => (
                <div className="comment-box" key={h.revision}>
                  <b>Revision {h.revision}</b>
                  <p>
                    {h.periodStart} — {h.periodEnd} ·{" "}
                    {h.team.map(name).join(", ")}
                  </p>
                  {h.approval && (
                    <small>
                      Approved by {name(h.approval.userId)} ·{" "}
                      {new Date(h.approval.at).toLocaleString()}
                    </small>
                  )}
                </div>
              ))}
            </details>
          )}
        </>
      ) : (
        <p className="empty-result">
          Record the preconditions, scope, period, system boundary, access level
          and engagement letter before fieldwork.
        </p>
      )}
      <div className="row-actions">
        <DecisionButton
          state={decisionState(role, uid, {
            action: "saveAcceptance",
            engagement: e,
          })}
          disabled={busy}
          onClick={acceptanceForm}
        >
          {a ? "Revise acceptance" : "Record acceptance"}
        </DecisionButton>
        {lead && a?.status === "draft" && (
          <DecisionButton
            variant="outline"
            state={
              refusal
                ? { allowed: false, reason: refusal.message }
                : { allowed: true }
            }
            disabled={busy}
            onClick={approveForm}
          >
            Approve acceptance
          </DecisionButton>
        )}
      </div>
      <h3>Team declarations</h3>
      <p className="subtle">
        Everyone on the engagement team declares independence and competence for
        the accepted period. Declarations are renewed when someone joins the
        team.
      </p>
      <DeclarationsTable
        w={w}
        team={team}
        declarants={declarants}
        uid={uid}
        reviewer={reviewer}
        busy={busy}
        name={name}
        onResolve={resolveForm}
        onWithdraw={withdrawForm}
      />
      <div className="row-actions">
        {internal && (
          <Button
            disabled={busy || !a}
            title={a ? undefined : "Record the acceptance period first"}
            onClick={declarationForm}
          >
            {own ? "Renew my declaration" : "Declare independence"}
          </Button>
        )}
      </div>
      <h3>Competence matrix</h3>
      <CompetenceMatrix w={w} team={team} name={name} />
    </section>
  );
}
