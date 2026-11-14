"use client";
import type { ProgramScope } from "./program-scope";
import { acceptanceGates } from "@/lib/workflow/acceptance";
function WorkflowStep({
  number,
  title,
  status,
  done = false,
  onClick,
}: {
  number: string;
  title: string;
  status: string;
  done?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={done ? "done" : ""} onClick={onClick}>
      <span>{number}</span>
      <div>
        <b>{title}</b>
        <small>{status}</small>
      </div>
    </button>
  );
}
/** The six workflow steps above the program tabs. */
export function WorkflowSpine({
  scope,
  onTab: setTab,
  onFilter: setFilter,
  onNavigate,
}: {
  scope: ProgramScope;
  onTab: (tab: string) => void;
  onFilter: (filter: string) => void;
  onNavigate: (v: string) => void;
}) {
  const { e, w } = scope,
    b = w.brief,
    acceptanceGaps = acceptanceGates(e).length;
  const completed = w.procedures.filter(
      (p) => p.selected && p.state === "reviewed",
    ).length,
    inScope = w.procedures.filter((p) => p.selected).length;
  return (
    <div className="workflow-spine">
      <WorkflowStep
        number="1"
        title="Acceptance"
        status={
          w.acceptance
            ? w.acceptance.status +
              (acceptanceGaps ? " · " + acceptanceGaps + " open" : "")
            : "Not started"
        }
        done={w.acceptance?.status === "approved" && !acceptanceGaps}
        onClick={() => setTab("acceptance")}
      />
      <WorkflowStep
        number="2"
        title="Engagement brief"
        status={b?.status ?? "Not started"}
        done={b?.status === "approved"}
        onClick={() => setTab("brief")}
      />
      <WorkflowStep
        number="3"
        title="Audit program"
        status={w.program.status}
        done={w.program.status === "approved"}
        onClick={() => setTab("program")}
      />
      <WorkflowStep
        number="4"
        title="Execute & evaluate"
        status={completed + " / " + inScope + " reviewed"}
        onClick={() => {
          setTab("program");
          setFilter("selected");
        }}
      />
      <WorkflowStep
        number="5"
        title="Independent review"
        status={
          w.procedures.filter((p) => p.state === "submitted").length +
          " pending"
        }
        onClick={() => setTab("review")}
      />
      <WorkflowStep
        number="6"
        title="Report & release"
        status="Open reports"
        onClick={() => onNavigate("Reports & sign-off")}
      />
    </div>
  );
}
