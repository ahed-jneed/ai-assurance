"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Engagement, Finding, Role } from "@/lib/domain/types";
import { can, decisionState } from "@/lib/permissions";
import { useAttest } from "../workspace/attestation-dialog";
import { DecisionButton } from "../workspace/decision-button";
import { area, choice, evidence, label, options, reason } from "./fields";
import { WorkflowDialog, type Form, type WorkflowAct } from "./workflow-dialog";
export function FindingAssurance({
  finding: f,
  engagement: e,
  role,
  userId,
  busy,
  act,
  onEditing,
}: {
  finding: Finding;
  engagement: Engagement;
  role: Role;
  userId: string;
  busy: boolean;
  act: WorkflowAct;
  onEditing: (v: boolean) => void;
}) {
  const [form, setForm] = useState<Form | null>(null),
    writer = can(role, "linkFindingSupport"),
    reviewer = can(role, "recordFindingRetest");
  const attest = useAttest();
  return (
    <section className="release-controls">
      <h3>Support and independent retest</h3>
      {f.support && (
        <p>
          {f.support.evidenceIds.length} evidence files ·{" "}
          {f.support.paperIds.length} papers · {f.support.runIds.length}{" "}
          evaluations ·{" "}
          {e.workflow?.procedures.find((p) => p.id === f.support?.procedureId)
            ?.title ?? "No linked procedure"}
        </p>
      )}
      {f.retest && (
        <div className="comment-box">
          <b>{label(f.retest.conclusion)}</b>
          <p>{f.retest.performed}</p>
          <p>{f.retest.results}</p>
          <p>{f.retest.rationale}</p>
          <small>{new Date(f.retest.at).toLocaleString()}</small>
        </div>
      )}
      <div className="row-actions">
        {writer && f.status !== "closed" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              setForm({
                title: "Link finding support",
                action: "Save support",
                fields: [
                  choice(
                    "procedureId",
                    "Originating procedure",
                    e.workflow?.procedures.map((p) => ({
                      value: p.id,
                      label: p.templateId + " · " + p.title,
                    })) ?? [],
                    f.support?.procedureId,
                    true,
                  ),
                  evidence(e, f.support?.evidenceIds),
                  {
                    name: "paperIds",
                    label: "Working papers",
                    type: "checklist",
                    ids: f.support?.paperIds,
                    options: e.papers.map((p) => ({
                      value: p.id,
                      label: p.title,
                    })),
                  },
                  {
                    name: "runIds",
                    label: "Evaluations",
                    type: "checklist",
                    ids: f.support?.runIds,
                    options: e.runs.map((r) => ({
                      value: r.id,
                      label: r.id + " · " + r.state,
                    })),
                  },
                ],
                save: (v) =>
                  act("linkFindingSupport", { findingId: f.id, ...v }),
              })
            }
          >
            Link support
          </Button>
        )}
        {reviewer && f.status === "ready_for_retest" && (
          <Button
            disabled={
              busy || f.createdBy === userId || f.remediationBy === userId
            }
            onClick={() =>
              setForm({
                title: "Record independent remediation retest",
                action: "Save retest assessment",
                fields: [
                  area(
                    "performed",
                    "Retest procedures actually performed",
                    f.retest?.performed,
                  ),
                  area("results", "Observed results", f.retest?.results),
                  area(
                    "rationale",
                    "Evidence assessment and conclusion rationale",
                    f.retest?.rationale,
                  ),
                  {
                    ...evidence(
                      e,
                      f.retest?.evidenceIds ?? f.retestEvidenceIds,
                    ),
                    requiredMessage: "Select the evidence the retest relied on",
                  },
                  choice(
                    "conclusion",
                    "Remediation effectiveness",
                    options(["effective", "not_effective"]),
                    f.retest?.conclusion,
                  ),
                ],
                save: (v) =>
                  act("recordFindingRetest", { findingId: f.id, ...v }),
              })
            }
          >
            Record independent retest
          </Button>
        )}
        {f.status === "ready_for_retest" &&
          f.retest?.conclusion === "effective" && (
            <DecisionButton
              state={decisionState(role, userId, {
                action: "closeFinding",
                finding: f,
              })}
              disabled={busy}
              onClick={() => attest("closeFinding", { findingId: f.id })}
            >
              Close verified finding
            </DecisionButton>
          )}
        {can(role, "reopenFinding") && f.status === "closed" && (
          <Button
            variant="outline"
            onClick={() =>
              setForm({
                title: "Reopen closed finding",
                action: "Reopen finding",
                fields: reason(),
                save: (v) => act("reopenFinding", { findingId: f.id, ...v }),
              })
            }
          >
            Reopen finding
          </Button>
        )}
      </div>
      <WorkflowDialog
        form={form}
        onClose={() => setForm(null)}
        busy={busy}
        onEditing={onEditing}
      />
    </section>
  );
}
