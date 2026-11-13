"use client";
// The audit program's acceptance panel: the acceptance and continuance
// record a Lead Auditor approves, each team member's dated independence and
// competence declaration, the evaluation of declared threats and the team's
// competence matrix. lib/workflow/acceptance.ts holds the rules the
// Planning-exit gate applies.
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import type { Engagement, Role } from "@/lib/domain";
import {
  acceptancePrompt,
  currentDeclaration,
  declarationStatus,
  engagementTeam,
  latestDeclaration,
  type DeclarationStatus,
} from "@/lib/workflow/acceptance";
import {
  acceptancePreconditions,
  accessLevels,
  competenceAreas,
  competenceLevels,
  exclusionKinds,
  threatKinds,
  type AcceptancePrecondition,
  type CompetenceArea,
  type Declaration,
  type ExclusionKind,
  type ThreatKind,
} from "@/lib/workflow-types";
import type { Field, Form, WorkflowAct } from "../audit-program";
import type { WorkspaceData } from "../workspace-types";

// Our own short titles; no standards text is reproduced (D-03).
const preconditionLabels: Record<AcceptancePrecondition, string> = {
  subjectMatter: "Appropriate, identifiable subject matter",
  criteria: "Suitable criteria available to intended users",
  evidence: "Access to the evidence the conclusion needs",
  purpose: "A rational purpose for the engagement",
};
const accessLabels: Record<(typeof accessLevels)[number], string> = {
  white: "White box: code, weights and training data",
  grey: "Grey box: model outputs plus documentation",
  black: "Black box: inputs and outputs only",
};
const threatLabels: Record<ThreatKind, string> = {
  self_interest: "Self-interest",
  self_review: "Self-review",
  advocacy: "Advocacy",
  familiarity: "Familiarity",
  intimidation: "Intimidation",
};
const threatHints: Record<ThreatKind, string> = {
  self_interest: "A financial or other interest in the outcome",
  self_review: "Evaluating your own or your firm's earlier work",
  advocacy: "Promoting the client's position",
  familiarity: "A close or long relationship with the client",
  intimidation: "Pressure, actual or perceived, from the client",
};
const exclusionLabels: Record<ExclusionKind, string> = {
  system_involvement:
    "I used, developed or distributed this AI system, or help to",
  employment:
    "I am or was employed by the client or the system's vendor during the engagement",
  financial_interest:
    "I hold a direct or material indirect financial interest in the client or vendor",
};
const areaLabels: Record<CompetenceArea, string> = {
  assurance: "Assurance methodology",
  ai_systems: "AI and ML systems",
  statistics: "Statistics and fairness",
  regulation: "AI regulation",
  management_systems: "AI management systems",
  data_protection: "Data protection",
  security: "AI security",
  domain: "Sector knowledge",
};
const statusLabels: Record<DeclarationStatus, { text: string; tone: string }> =
  {
    current: { text: "Current", tone: "green" },
    missing: { text: "Declaration needed", tone: "amber" },
    outdated: { text: "Team changed: renew", tone: "amber" },
    unresolved: { text: "Threat to resolve", tone: "red" },
    excluded: { text: "Disqualified", tone: "red" },
  };
const yesNo = [
  { value: "true", label: "Met" },
  { value: "false", label: "Not met" },
];
const day = (iso: string) => new Date(iso).toLocaleDateString();

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
    writer = can(role, "saveAcceptance"),
    lead = can(role, "approveAcceptance"),
    reviewer = can(role, "resolveDeclaredThreat"),
    internal = can(role, "saveDeclaration");
  const name = (id: string) =>
    data.people.find((m) => m.user_id === id)?.display_name ?? id;
  const team = engagementTeam(w),
    prompt = acceptancePrompt(e),
    unmet = a
      ? acceptancePreconditions.filter((k) => !a.preconditions[k].met)
      : [];

  function acceptanceForm() {
    const b = w.brief,
      people = data.people
        .filter(
          (m) =>
            m.status === "active" &&
            ["Auditor", "Lead Auditor", "Reviewer"].includes(m.role),
        )
        .map((m) => ({
          value: m.user_id,
          label: m.display_name + " · " + m.role,
        }));
    const fields: Field[] = [
      {
        name: "decision",
        label: "Decision",
        type: "select",
        value: a?.decision ?? "acceptance",
        options: [
          { value: "acceptance", label: "Acceptance of a new engagement" },
          { value: "continuance", label: "Continuance of an engagement" },
        ],
      },
      ...acceptancePreconditions.flatMap((k): Field[] => [
        {
          name: "met." + k,
          label: "Precondition: " + preconditionLabels[k],
          type: "select",
          options: yesNo,
          value: a ? String(a.preconditions[k].met) : "",
        },
        {
          name: "basis." + k,
          label: "Basis for that view",
          type: "area",
          value: a?.preconditions[k].basis ?? "",
        },
      ]),
      {
        name: "scope",
        label: "Engagement scope",
        type: "area",
        value: a?.scope ?? "",
      },
      {
        name: "periodStart",
        label: "Period from",
        type: "date",
        value: a?.periodStart ?? b?.periodStart ?? "",
      },
      {
        name: "periodEnd",
        label: "Period to",
        type: "date",
        value: a?.periodEnd ?? b?.periodEnd ?? "",
      },
      {
        name: "systemBoundary",
        label: "System boundary",
        type: "area",
        value: a?.systemBoundary ?? b?.boundary ?? "",
      },
      {
        name: "accessLevel",
        label: "Access level",
        type: "select",
        value: a?.accessLevel ?? "",
        options: accessLevels.map((v) => ({
          value: v,
          label: accessLabels[v],
        })),
      },
      {
        name: "engagementLetter",
        label: "Engagement letter reference",
        type: "text",
        value: a?.engagementLetter ?? "",
      },
      {
        name: "team",
        label: "Engagement team",
        type: "checklist",
        options: people,
        ids: a?.team ?? [uid],
        hint: "Preparers and reviewers of selected procedures join the team automatically. Everyone on it declares independence and competence.",
      },
      {
        name: "competenceConclusion",
        label: "Conclusion on the team's collective competence",
        type: "area",
        value: a?.competenceConclusion ?? "",
      },
      ...(a?.status === "approved"
        ? [
            {
              name: "changeReason",
              label: "Why the approved record changes",
              type: "area" as const,
            },
          ]
        : []),
    ];
    onForm({
      title: a ? "Revise acceptance and continuance" : "Record acceptance",
      action: "Save acceptance draft",
      description:
        "Record the ISAE 3000 preconditions and the engagement terms. A Lead Auditor approves the record before fieldwork starts.",
      fields,
      save: (v) =>
        act("saveAcceptance", {
          decision: v.decision,
          preconditions: Object.fromEntries(
            acceptancePreconditions.map((k) => [
              k,
              { met: v["met." + k] === "true", basis: v["basis." + k] },
            ]),
          ),
          scope: v.scope,
          periodStart: v.periodStart,
          periodEnd: v.periodEnd,
          systemBoundary: v.systemBoundary,
          accessLevel: v.accessLevel,
          engagementLetter: v.engagementLetter,
          team: v.team,
          competenceConclusion: v.competenceConclusion,
          changeReason: v.changeReason ?? "",
        }),
    });
  }

  function declarationForm() {
    const d = currentDeclaration(w, uid),
      latest = latestDeclaration(w, uid);
    const threat = (k: ThreatKind) => d?.threats.find((t) => t.kind === k);
    const fields: Field[] = [
      {
        name: "priorWork",
        label:
          "Earlier implementation or governance work on this system (leave empty if none)",
        type: "area",
        value: d?.priorWork ?? "",
        optional: true,
        hint: "Such work creates a self-review threat: declare it below.",
      },
      ...threatKinds.flatMap((k): Field[] => [
        {
          name: "threat." + k,
          label: threatLabels[k] + " threat",
          type: "select",
          value: threat(k) ? "present" : "none",
          options: [
            { value: "none", label: "None identified" },
            { value: "present", label: "Present" },
          ],
          hint: threatHints[k],
        },
        {
          name: "description." + k,
          label: threatLabels[k] + ": circumstances",
          type: "area",
          value: threat(k)?.description ?? "",
          optional: true,
        },
        {
          name: "safeguards." + k,
          label: threatLabels[k] + ": safeguards proposed",
          type: "area",
          value: threat(k)?.safeguards ?? "",
          optional: true,
        },
      ]),
      {
        name: "exclusions",
        label: "Disqualifying relationships",
        type: "checklist",
        options: exclusionKinds.map((k) => ({
          value: k,
          label: exclusionLabels[k],
        })),
        // Relationships stand across periods: start from the latest
        // declaration in any period, which holds the ones not withdrawn.
        ids: latest?.exclusions ?? [],
        hint: "Modelled on the NYC Local Law 144 independent-auditor exclusions and applied to every engagement; pending legal review. No safeguard resolves them, and a renewal cannot remove one: a Lead Auditor or Reviewer other than you withdraws a relationship declared in error. A renewal also keeps every threat nobody has resolved.",
      },
      ...competenceAreas.map((k): Field => ({
        name: "competence." + k,
        label: "Competence: " + areaLabels[k],
        type: "select",
        value: d?.competence[k] ?? "",
        options: competenceLevels.map((l) => ({
          value: l,
          label: l[0].toUpperCase() + l.slice(1),
        })),
      })),
      {
        name: "expertField",
        label:
          "Field in which you act as practitioner's expert (leave empty if not)",
        type: "text",
        value: d?.expertField ?? "",
        optional: true,
      },
      {
        name: "confirmed",
        label: "Confirmation",
        type: "checklist",
        options: [
          {
            value: "yes",
            label:
              "This declaration is complete and accurate for the engagement period",
          },
        ],
      },
    ];
    onForm({
      title: d ? "Renew your declaration" : "Declare independence",
      action: "Sign declaration",
      description:
        "Your declaration is dated and covers this engagement period. Renew it whenever the engagement team changes.",
      fields,
      save: async (v) => {
        if (!(v.confirmed as string[]).includes("yes"))
          throw new Error("Confirm the declaration before signing it");
        return act("saveDeclaration", {
          priorWork: v.priorWork,
          threats: threatKinds
            .filter((k) => v["threat." + k] === "present")
            .map((k) => ({
              kind: k,
              description: v["description." + k],
              safeguards: v["safeguards." + k],
            })),
          exclusions: v.exclusions,
          competence: Object.fromEntries(
            competenceAreas.map((k) => [k, v["competence." + k]]),
          ),
          expertField: v.expertField,
          confirmed: true,
        });
      },
    });
  }

  function resolveForm(d: Declaration, kind: ThreatKind) {
    onForm({
      title: "Resolve " + threatLabels[kind].toLowerCase() + " threat",
      action: "Record evaluation",
      description:
        "Evaluate whether the safeguards reduce the threat to an acceptable level for " +
        name(d.userId) +
        ". If they do not, remove the person from the team instead.",
      fields: [
        {
          name: "reason",
          label: "Evaluation of the threat and its safeguards",
          type: "area",
        },
      ],
      save: (v) =>
        act("resolveDeclaredThreat", {
          declarationId: d.id,
          kind,
          reason: v.reason,
        }),
    });
  }

  function withdrawForm(d: Declaration, kind: ExclusionKind) {
    onForm({
      title: "Withdraw a disqualifying relationship",
      action: "Withdraw relationship",
      description:
        name(d.userId) +
        " declared: " +
        exclusionLabels[kind] +
        ". Withdraw it only if it was declared in error or does not exist; no safeguard resolves it.",
      fields: [
        {
          name: "reason",
          label: "Why the relationship does not exist",
          type: "area",
        },
      ],
      save: (v) =>
        act("withdrawDeclaredExclusion", {
          declarationId: d.id,
          kind,
          reason: v.reason,
        }),
    });
  }

  function approveForm() {
    onForm({
      title: "Approve acceptance revision " + a!.revision,
      action: "Accept engagement",
      description:
        "Approving accepts the engagement on these terms. A declared threat that nobody resolved blocks acceptance.",
      fields: [
        {
          name: "reason",
          label: "Acceptance decision and rationale",
          type: "area",
        },
      ],
      save: (v) =>
        act("approveAcceptance", { revision: a!.revision, reason: v.reason }),
    });
  }

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
        {writer && (a?.status !== "approved" || lead) && (
          <Button disabled={busy} onClick={acceptanceForm}>
            {a ? "Revise acceptance" : "Record acceptance"}
          </Button>
        )}
        {lead && a?.status === "draft" && (
          <Button
            variant="outline"
            disabled={busy || unmet.length > 0}
            title={
              unmet.length
                ? "Every precondition must be met before acceptance"
                : undefined
            }
            onClick={approveForm}
          >
            Approve acceptance
          </Button>
        )}
      </div>
      <h3>Team declarations</h3>
      <p className="subtle">
        Everyone on the engagement team declares independence and competence for
        the accepted period. Declarations are renewed when someone joins the
        team.
      </p>
      {declarants.length ? (
        <div className="workflow-table">
          <table className="compact-register">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Status</th>
                <th scope="col">Declared</th>
                <th scope="col">Threats and relationships</th>
              </tr>
            </thead>
            <tbody>
              {declarants.map((id) => {
                // Threats are per period; relationships and their
                // withdrawals stand across periods on the latest declaration.
                const d = currentDeclaration(w, id),
                  latest = latestDeclaration(w, id),
                  status = team.includes(id)
                    ? declarationStatus(w, id, team)
                    : undefined;
                return (
                  <tr key={id}>
                    <td>
                      <b>{name(id)}</b>
                      <small className="subtle block">
                        {team.includes(id)
                          ? (d?.role ?? "")
                          : "Not on the team"}
                        {d?.expertField
                          ? " · practitioner's expert: " + d.expertField
                          : ""}
                      </small>
                    </td>
                    <td>
                      {status && (
                        <span className={"badge " + statusLabels[status].tone}>
                          {statusLabels[status].text}
                        </span>
                      )}
                    </td>
                    <td>{d ? day(d.declaredAt) : "—"}</td>
                    <td>
                      {d && !d.threats.length && !latest?.exclusions.length && (
                        <span className="subtle">None declared</span>
                      )}
                      {latest?.exclusions.map((k) => (
                        <div key={k} className="acceptance-threat">
                          <p className="record-text">
                            <b>Disqualifying:</b> {exclusionLabels[k]}
                          </p>
                          {reviewer && latest.userId !== uid && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => withdrawForm(latest, k)}
                            >
                              Withdraw as declared in error
                            </Button>
                          )}
                        </div>
                      ))}
                      {latest?.exclusionWithdrawals?.map((x, i) => (
                        <small key={x.kind + i} className="subtle block">
                          Withdrawn: {exclusionLabels[x.kind]} · by{" "}
                          {name(x.userId)} · {day(x.at)}: {x.reason}
                        </small>
                      ))}
                      {d?.priorWork && (
                        <p className="record-text">
                          <b>Earlier work:</b> {d.priorWork}
                        </p>
                      )}
                      {d?.threats.map((t) => (
                        <div key={t.kind} className="acceptance-threat">
                          <p className="record-text">
                            <b>{threatLabels[t.kind]}:</b> {t.description}
                            {t.safeguards && " Safeguards: " + t.safeguards}
                          </p>
                          {t.resolution ? (
                            <small className="subtle block">
                              Resolved by {name(t.resolution.userId)} ·{" "}
                              {day(t.resolution.at)}: {t.resolution.reason}
                            </small>
                          ) : reviewer && d.userId !== uid ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => resolveForm(d, t.kind)}
                            >
                              Resolve threat
                            </Button>
                          ) : (
                            <small className="subtle block">
                              Awaiting evaluation by a Lead Auditor or Reviewer
                              other than the declarant
                            </small>
                          )}
                        </div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-result">Name the engagement team first.</p>
      )}
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
      <div className="workflow-table">
        <table className="compact-register acceptance-matrix">
          <thead>
            <tr>
              <th scope="col">Person</th>
              {competenceAreas.map((k) => (
                <th scope="col" key={k}>
                  {areaLabels[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.map((id) => {
              const d = currentDeclaration(w, id);
              return (
                <tr key={id}>
                  <td>{name(id)}</td>
                  {competenceAreas.map((k) => (
                    <td key={k}>{d ? d.competence[k] : "—"}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
