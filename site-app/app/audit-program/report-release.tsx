"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Engagement, Report, Role } from "@/lib/domain/types";
import { releaseChecklist, releaseChecklistLines } from "@/lib/domain/gates";
import { opinionLabel } from "@/lib/domain/report-model";
import { packageGuidance, packageStatusLabel } from "@/lib/report-presentation";
import { releaseApprovalMessage, releaseRefusal } from "@/lib/preconditions";
import { isWithdrawable, releaseState } from "@/lib/workflow-state";
import { can, decisionState } from "@/lib/permissions";
import { DecisionButton } from "../workspace/decision-button";
import { FrozenReportDetails } from "../report-details";
import { area, checklistOptions, choice, label, reason } from "./fields";
import { WorkflowDialog, type Form, type WorkflowAct } from "./workflow-dialog";
export function ReportRelease({
  report: r,
  engagement,
  role,
  userId,
  busy,
  act,
  onEditing,
  reports,
}: {
  reports: Report[];
  report: Report;
  /** The engagement the server checks the release against (#210). */
  engagement?: Engagement | null;
  role: Role;
  userId: string;
  busy: boolean;
  act: WorkflowAct;
  onEditing: (v: boolean) => void;
}) {
  const [preview, setPreview] = useState(false),
    [form, setForm] = useState<Form | null>(null),
    state = releaseState(r),
    lead = can(role, "releaseReport"),
    reviewer = can(role, "approveReportPackage"),
    // Release is disabled with the reason the server would refuse it with.
    releaseBlocked =
      state === "approved"
        ? engagement
          ? (releaseRefusal(engagement, r, userId)?.message ?? "")
          : r.release?.approval?.userId === userId
            ? releaseApprovalMessage
            : ""
        : "";
  return (
    <section className="release-controls">
      <div className="panel-head">
        <h3>
          {r.kind === "draft" ? "Client preview" : "Approval & client release"}
        </h3>
        <span className="badge neutral">{packageStatusLabel(r)}</span>
      </div>
      <p className="subtle">{packageGuidance(r, engagement ?? undefined)}</p>
      <div className="row-actions">
        <Button
          variant="outline"
          disabled={busy || !r.clientSnapshot}
          title={
            !r.clientSnapshot
              ? "No client projection was captured in this package"
              : undefined
          }
          onClick={() => setPreview(true)}
        >
          Preview exact client package
        </Button>
        {reviewer &&
          r.kind === "final" &&
          ["internal", "approved"].includes(state) && (
            <DecisionButton
              // Disabled for the report's creator with the reason the server
              // refuses them with (#226 item 5).
              state={decisionState(role, userId, {
                action: "approveReportPackage",
                report: r,
              })}
              disabled={busy || !r.snapshot.workflow}
              title={
                !r.snapshot.workflow
                  ? "Prepare a current final package capturing the approved scope and program"
                  : undefined
              }
              onClick={() =>
                setForm({
                  title: "Approve both exact packages",
                  action: "Approve package",
                  fields: [
                    ...releaseChecklist.map((item) =>
                      choice(
                        "checklist." + item.id,
                        item.label,
                        checklistOptions,
                        r.release?.approval?.checklist?.items.find(
                          (i) => i.id === item.id,
                        )?.answer,
                      ),
                    ),
                    area(
                      "checklistNote",
                      "Why any item marked not applicable does not apply",
                      r.release?.approval?.checklist?.note,
                      true,
                    ),
                    ...reason(),
                  ],
                  description:
                    "Review the internal report and client preview before approving their captured digests. Your completion checklist answers are recorded with the approval and in the completion and issue memo (MEM-SO-01).",
                  save: ({ reason, checklistNote, ...answers }) =>
                    act("approveReportPackage", {
                      reportId: r.id,
                      internalHash: r.sha256,
                      clientHash: r.clientSha256,
                      reason,
                      checklistNote,
                      checklist: Object.fromEntries(
                        Object.entries(answers).map(([name, answer]) => [
                          name.slice("checklist.".length),
                          answer,
                        ]),
                      ),
                    }),
                })
              }
            >
              Approve package
            </DecisionButton>
          )}
        {lead && state === "approved" && (
          <Button
            disabled={busy || !!releaseBlocked}
            aria-describedby={
              releaseBlocked ? "release-blocked-" + r.id : undefined
            }
            onClick={() =>
              setForm({
                title: "Authorize client release",
                action: "Release to client",
                description:
                  "This makes the captured client package visible to authorized Client Viewers and granted Client Contributors belonging to this engagement’s client. A report released before is superseded, and the release records the client notification.",
                fields: [
                  area(
                    "recipientScope",
                    "Recipient scope and authorized use",
                    "Authorized members of this engagement’s client",
                  ),
                  choice(
                    "supersedes",
                    "Released report it replaces (the latest if none is chosen)",
                    reports
                      .filter(
                        (q) => q.id !== r.id && releaseState(q) === "released",
                      )
                      .map((q) => ({
                        value: q.id,
                        label:
                          new Date(q.createdAt).toLocaleDateString() +
                          " · " +
                          opinionLabel(q.snapshot),
                      })),
                    "",
                    true,
                  ),
                  ...reason(),
                ],
                save: (v) => act("releaseReport", { reportId: r.id, ...v }),
              })
            }
          >
            Release to client
          </Button>
        )}
        {lead && isWithdrawable(r) && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              setForm({
                title: "Withdraw report package",
                action: "Withdraw package",
                fields: reason(),
                save: (v) => act("withdrawReport", { reportId: r.id, ...v }),
              })
            }
          >
            Withdraw
          </Button>
        )}
      </div>
      {lead && releaseBlocked && (
        <p className="subtle" id={"release-blocked-" + r.id}>
          {releaseBlocked}
        </p>
      )}
      {r.release?.approval && (
        <p className="subtle">
          Approved {new Date(r.release.approval.at).toLocaleString()} ·{" "}
          {r.release.approval.reason}
        </p>
      )}
      {r.release?.approval?.checklist && (
        <details className="provenance">
          <summary>Completion checklist (MEM-SO-01)</summary>
          <ul className="record-list">
            {releaseChecklistLines(r.release.approval.checklist).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
      {r.release?.releasedAt && (
        <p className="subtle">
          Released {new Date(r.release.releasedAt).toLocaleString()} ·{" "}
          {r.release.recipientScope}
        </p>
      )}
      <details className="provenance">
        <summary>Release history and digests</summary>
        <p className="hash-text">Internal {r.sha256}</p>
        <p className="hash-text">
          Client {r.clientSha256 ?? "No projection captured"}
        </p>
        {r.release?.completion && (
          <p>
            Completion and issue records{" "}
            {r.release.completion.templateIds.join(", ")} bound to both approved
            digests at release
          </p>
        )}
        {r.release?.history.map((h, i) => (
          <p key={i}>
            {new Date(h.at).toLocaleString()} · {label(h.action)} · {h.reason}
          </p>
        ))}
      </details>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="audit-dialog ml-dialog">
          <DialogHeader>
            <DialogTitle>Client package preview</DialogTitle>
            <DialogDescription>
              Exact captured projection · read only
            </DialogDescription>
          </DialogHeader>
          <FrozenReportDetails
            value={{ ...r, snapshot: r.clientSnapshot, sha256: r.clientSha256 }}
          />
        </DialogContent>
      </Dialog>
      <WorkflowDialog
        form={form}
        onClose={() => setForm(null)}
        busy={busy}
        onEditing={onEditing}
      />
    </section>
  );
}
