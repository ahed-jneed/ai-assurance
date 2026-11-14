"use client";
// The acceptance panel's team tables: each declarant's dated independence
// and competence declaration with its threats and relationships, and the
// team's competence matrix.
import { Button } from "@/components/ui/button";
import {
  currentDeclaration,
  declarationStatus,
  latestDeclaration,
} from "@/lib/workflow/acceptance";
import {
  competenceAreas,
  type Declaration,
  type ExclusionKind,
  type ThreatKind,
  type Workflow,
} from "@/lib/workflow-types";
import {
  areaLabels,
  day,
  exclusionLabels,
  statusLabels,
  threatLabels,
} from "./acceptance-labels";

export function DeclarationsTable({
  w,
  team,
  declarants,
  uid,
  reviewer,
  busy,
  name,
  onResolve,
  onWithdraw,
}: {
  w: Workflow;
  team: string[];
  /** The team plus anyone off it who holds a current declaration. */
  declarants: string[];
  uid: string;
  /** The viewer may resolve threats and withdraw relationships. */
  reviewer: boolean;
  busy: boolean;
  name: (id: string) => string;
  onResolve: (d: Declaration, kind: ThreatKind) => void;
  onWithdraw: (d: Declaration, kind: ExclusionKind) => void;
}) {
  if (!declarants.length)
    return <p className="empty-result">Name the engagement team first.</p>;
  return (
    // Scrolls sideways on a narrow pane, so it takes focus (WCAG 2.1.1).
    <div
      className="workflow-table"
      role="region"
      aria-label="Team declarations"
      tabIndex={0}
    >
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
                    {team.includes(id) ? (d?.role ?? "") : "Not on the team"}
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
                          onClick={() => onWithdraw(latest, k)}
                        >
                          Withdraw as declared in error
                        </Button>
                      )}
                    </div>
                  ))}
                  {latest?.exclusionWithdrawals?.map((x, i) => (
                    <small key={x.kind + i} className="subtle block">
                      Withdrawn: {exclusionLabels[x.kind]} · by {name(x.userId)}{" "}
                      · {day(x.at)}: {x.reason}
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
                          onClick={() => onResolve(d, t.kind)}
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
  );
}

export function CompetenceMatrix({
  w,
  team,
  name,
}: {
  w: Workflow;
  team: string[];
  name: (id: string) => string;
}) {
  return (
    // The matrix scrolls sideways on a narrow pane, so it takes focus for
    // keyboard scrolling (WCAG 2.1.1).
    <div
      className="workflow-table"
      role="region"
      aria-label="Competence matrix"
      tabIndex={0}
    >
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
  );
}
