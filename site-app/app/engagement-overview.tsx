"use client";
import {
  ArrowUpRight,
  CheckCircle2,
  FileCheck2,
  Database,
  AlertTriangle,
  FlaskConical,
  BookOpen,
} from "lucide-react";
import { EngagementTaskQueue } from "./business-workspace";
import { currentExecution } from "@/lib/workflow-state";
import type { WorkspaceData } from "./workspace-types";
import type { WorkItem } from "@/lib/work-items";
import { NextSteps } from "./next-steps";
import { AuditGateList, type GateAction } from "./audit-gates";
import { Button } from "@/components/ui/button";
import {
  stages,
  stageGates,
  isReleaseTimeRecord,
  paperCurrent,
  paperRequired,
} from "@/lib/domain";
import type { Engagement, Paper, Role } from "@/lib/domain";
import type { PaperTarget } from "@/lib/paper-workflow";
import { classificationRules } from "@/lib/classification-rules";
import { reReviewTriggers } from "@/lib/domain/classification";
import { asRulePack, isoToday } from "@/lib/rule-pack";

export function EngagementOverview({
  data,
  onWork,
  engagement: e,
  role,
  userId,
  onPaper,
  onNavigate,
  onGate,
  onAdvance,
  onRequests,
  busy,
}: {
  data: WorkspaceData;
  onWork: (i: WorkItem) => void;
  engagement: Engagement;
  role: Role;
  userId: string;
  onPaper: (paper: Paper, target?: PaperTarget) => void;
  onNavigate: (
    view: string,
    options?: { filter?: string; search?: string; facet?: string },
  ) => void;
  onGate: GateAction;
  onAdvance: (stage: string) => void;
  busy: boolean;
  onRequests: () => void;
}) {
  const required = e.papers.filter(
      (p) =>
        paperRequired(e, p) ||
        (paperCurrent(p) &&
          !isReleaseTimeRecord(p.templateId) &&
          p.body.conclusionStatus === "not_applicable"),
    ),
    signed = required.filter((p) => p.status === "signed").length;
  const paperView =
    signed === required.length && required.length
      ? "signed"
      : required.some((p) => p.status === "reviewed")
        ? "reviewed"
        : required.some((p) => p.status === "in_review")
          ? "in_review"
          : "draft";
  const paperHint = {
    signed: "Open signed papers",
    reviewed: "Open papers awaiting sign-off",
    in_review: "Open papers awaiting independent review",
    draft: "Open papers needing preparation",
  }[paperView];
  // The release-time records are recorded by the release, not reviewed as
  // procedures, so they count towards no progress.
  const inProgram =
      e.workflow?.procedures.filter(
        (p) => p.selected && p.applicability !== "not_applicable",
      ) ?? [],
    selectedProcedures = inProgram.filter(
      (p) => !isReleaseTimeRecord(p.templateId),
    ),
    atRelease = inProgram.length - selectedProcedures.length;
  const reviewedProcedures = selectedProcedures.filter(
    (p) => p.state === "reviewed" && currentExecution(e, p),
  ).length;
  const nextStage = stages[stages.indexOf(e.stage) + 1],
    gates = nextStage ? stageGates(e, nextStage) : [];
  const waitingEvidence = e.artifacts.filter(
    (a) => a.status === "unverified",
  ).length;
  const openFindings = e.findings.filter(
    (f) => f.status !== "closed" && ["High", "Critical"].includes(f.severity),
  ).length;
  const activeRuns = e.runs.filter((r) =>
    ["queued", "running"].includes(r.state),
  ).length;
  const outstandingRequests = (e.evidenceRequests ?? []).filter(
    (r) => !["accepted", "waived"].includes(r.status),
  );
  // #19: final Art 6 guidelines, a due Code or interoperability milestone or
  // a new rule pack call for a re-review of an approved classification.
  const reReview =
    e.classification.status === "approved"
      ? reReviewTriggers(
          e.classification,
          classificationRules(asRulePack(data.catalog?.regulatorySnapshot)),
          isoToday(),
        ).filter((t) => t.state === "due")
      : [];
  const checkpoints = [
    ...(reReview.length
      ? [
          {
            icon: BookOpen,
            title: "Re-review classification",
            detail: reReview.map((t) => t.title).join("; "),
            view: "Regulatory mapping",
            filter: "all",
          },
        ]
      : []),
    ...(e.classification.status !== "approved" &&
    !gates.some((g) => g.kind === "classification")
      ? [
          {
            icon: BookOpen,
            title: e.classification.intendedPurpose
              ? "Review classification"
              : "Assess classification",
            detail: e.classification.intendedPurpose
              ? "Independent approval required"
              : "Record the system’s purpose and risk route",
            view: "Regulatory mapping",
            filter: "all",
          },
        ]
      : []),
    ...(waitingEvidence
      ? [
          {
            icon: Database,
            title: `Review ${waitingEvidence} evidence ${waitingEvidence === 1 ? "file" : "files"}`,
            detail: "Awaiting acceptance",
            view: "Evidence vault",
            filter: "unverified",
          },
        ]
      : []),
    ...(openFindings
      ? [
          {
            icon: AlertTriangle,
            title: `${openFindings} high-risk ${openFindings === 1 ? "finding" : "findings"}`,
            detail: "Review remediation progress",
            view: "Findings",
            filter: "high",
          },
        ]
      : []),
    ...(activeRuns
      ? [
          {
            icon: FlaskConical,
            title: `${activeRuns} active ${activeRuns === 1 ? "evaluation" : "evaluations"}`,
            detail: "Queued or running",
            view: "Testing lab",
            filter: "all",
          },
        ]
      : []),
  ];
  return (
    <>
      <ol className="audit-stage-path" aria-label="Audit lifecycle">
        {stages.map((stage, i) => (
          <li
            key={stage}
            aria-current={stage === e.stage ? "step" : undefined}
            className={i < stages.indexOf(e.stage) ? "complete" : ""}
          >
            <span>{i < stages.indexOf(e.stage) ? "✓" : i + 1}</span>
            {stage}
          </li>
        ))}
      </ol>
      <section
        className="overview-assurance-progress"
        aria-label="Audit completion progress"
      >
        {e.workflow && (
          <button type="button" onClick={() => onNavigate("Audit program")}>
            <div>
              <span>Procedure review</span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </div>
            <b className={!selectedProcedures.length ? "progress-empty" : ""}>
              {selectedProcedures.length ? (
                <>
                  {reviewedProcedures}{" "}
                  <small>/ {selectedProcedures.length}</small>
                </>
              ) : (
                "No procedures selected"
              )}
            </b>
            <div
              className="overview-progress-track"
              role="progressbar"
              aria-label="Reviewed procedure coverage"
              aria-valuemin={0}
              aria-valuemax={selectedProcedures.length || 1}
              aria-valuenow={reviewedProcedures}
            >
              <span
                style={{
                  width:
                    (selectedProcedures.length
                      ? (reviewedProcedures / selectedProcedures.length) * 100
                      : 0) + "%",
                }}
              />
            </div>
            <p>
              Scope {e.workflow.brief?.status ?? "not recorded"} · Program{" "}
              {e.workflow.program.status}
              {atRelease > 0 && " · " + atRelease + " recorded at release"}
            </p>
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            onNavigate("Working papers", {
              filter: paperView,
              search: "",
              facet: "all",
            })
          }
        >
          <div>
            <span>Paper sign-off</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </div>
          <b>
            {signed} <small>/ {required.length}</small>
          </b>
          <div
            className="overview-progress-track"
            role="progressbar"
            aria-label="Signed working paper coverage"
            aria-valuemin={0}
            aria-valuemax={required.length || 1}
            aria-valuenow={signed}
          >
            <span
              style={{
                width:
                  (required.length ? (signed / required.length) * 100 : 0) +
                  "%",
              }}
            />
          </div>
          <p>{paperHint}</p>
        </button>
      </section>
      <div className="overview-workspace">
        {e.workflow ? (
          <EngagementTaskQueue data={data} onOpen={onWork} />
        ) : (
          <NextSteps
            engagement={e}
            role={role}
            userId={userId}
            onPaper={onPaper}
            onViewAll={() =>
              onNavigate("Working papers", {
                filter: "all",
                search: "",
                facet: "all",
              })
            }
          />
        )}
        <aside className="overview-checkpoints">
          {nextStage ? (
            <section className="stage-handoff">
              <div className="panel-head">
                <h2>To start {nextStage}</h2>
                <span className="count-label">{gates.length}</span>
              </div>
              {gates.length ? (
                <AuditGateList
                  compact
                  gates={gates}
                  engagement={e}
                  role={role}
                  userId={userId}
                  people={data.people}
                  onGate={onGate}
                />
              ) : (
                <div className="queue-empty">
                  <CheckCircle2 size={18} />
                  <span>Stage requirements met.</span>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy || role !== "Lead Auditor" || !!gates.length}
                onClick={() => onAdvance(nextStage)}
              >
                Move to {nextStage}
              </Button>
              <p className="stage-handoff-reason">
                {role !== "Lead Auditor"
                  ? "A Lead Auditor advances the engagement."
                  : gates.length
                    ? "Resolve the requirements above to advance."
                    : "Advancing the stage records a lifecycle decision."}
              </p>
            </section>
          ) : (
            <section className="stage-handoff">
              <h2>Report handoff</h2>
              <button
                className="checkpoint-action"
                onClick={() => onNavigate("Reports & sign-off")}
              >
                <FileCheck2 size={17} />
                <span>
                  <b>Review final report readiness</b>
                </span>
                <ArrowUpRight size={14} />
              </button>
            </section>
          )}
          {(!!checkpoints.length || !!outstandingRequests.length) && (
            <section>
              <div className="panel-head">
                <h2>Engagement checkpoints</h2>
              </div>
              {!!outstandingRequests.length && (
                <button className="checkpoint-action" onClick={onRequests}>
                  <Database size={17} />
                  <span>
                    <b>
                      {outstandingRequests.length} outstanding evidence{" "}
                      {outstandingRequests.length === 1
                        ? "request"
                        : "requests"}
                    </b>
                    <small>Track receipt, follow-up and sufficiency</small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              )}
              {checkpoints.map(({ icon: Icon, ...item }) => (
                <button
                  className="checkpoint-action"
                  key={item.view}
                  onClick={() =>
                    onNavigate(item.view, {
                      filter: item.filter,
                      search: "",
                      facet: "all",
                    })
                  }
                >
                  <Icon size={17} />
                  <span>
                    <b>{item.title}</b>
                    <small>{item.detail}</small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
