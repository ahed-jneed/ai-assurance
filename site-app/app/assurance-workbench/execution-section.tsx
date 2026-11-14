"use client";

import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AssuranceRecord } from "@/lib/assurance-core";
import { ExternalJobDetail } from "../external-job-detail";
import { ExecutionPlanner } from "../testing-readiness";
import type { Role } from "@/lib/domain/types";
import {
  label,
  type Act,
  type Engagement,
  type OpenForm,
  type Snapshot,
} from "./types";

/** Execution: the execution planner and the external execution requests. */
export function ExecutionSection({
  snapshot,
  records,
  engagement,
  role,
  writer,
  busy,
  initialProcedure,
  open,
  act,
  onSystems,
  onNavigate,
  onHosted,
  onCompiled,
}: {
  snapshot: Snapshot;
  records: AssuranceRecord[];
  engagement: Engagement;
  role: Role;
  writer: boolean;
  busy: boolean;
  initialProcedure?: string;
  open: OpenForm;
  act: Act;
  onSystems: () => void;
  onNavigate: (s: string) => void;
  onHosted: (procedureId: string, cardId: string) => void;
  /** A draft paper was compiled; the workbench opens it once settled. */
  onCompiled: (paperId: string) => void;
}) {
  return (
    <>
      <ExecutionPlanner
        onNavigate={onNavigate}
        onSystems={onSystems}
        key={initialProcedure ?? "choose"}
        engagement={engagement}
        role={role}
        records={records}
        workers={snapshot.workers}
        // open() starts the form in the plan's execution mode.
        onPlan={(v) => open("queueExternal", null, v)}
        onHosted={onHosted}
        initialProcedure={initialProcedure}
      />
      <div className="section-toolbar">
        <h2>Execution requests</h2>
        <span className="subtle external-queue-telemetry">
          {snapshot.telemetry.total.toLocaleString()} requests ·{" "}
          {snapshot.telemetry.queued.toLocaleString()} queued ·{" "}
          {snapshot.telemetry.running.toLocaleString()} running ·{" "}
          {snapshot.telemetry.stalled.toLocaleString()} expired leases
          {snapshot.telemetry.total > snapshot.jobs.length &&
            " · listing the " +
              snapshot.jobs.length.toLocaleString() +
              " most recent"}
        </span>
      </div>
      <div className="assurance-register">
        {snapshot.jobs.map((j) => (
          <div className="execution-row" key={j.id}>
            <div>
              <b>{j.system_name}</b>
              <small className="block subtle">
                {label(j.mode)} · attempt {j.fence} ·{" "}
                {new Date(j.created_at).toLocaleString()}
              </small>
              <ExternalJobDetail job={j} />
            </div>
            <span
              className={
                "badge " +
                (j.state === "succeeded"
                  ? "green"
                  : j.state === "failed"
                    ? "red"
                    : "neutral")
              }
            >
              {label(j.state)}
            </span>
            <div className="row-actions">
              {writer && ["queued", "running"].includes(j.state) && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => open("cancelJob", null, { jobId: j.id })}
                >
                  Cancel
                </Button>
              )}
              {writer && j.state === "succeeded" && !j.compiled && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act("importJob", { jobId: j.id })
                      .then((result) => {
                        if (result.record?.body.paperId)
                          onCompiled(result.record.body.paperId);
                      })
                      .catch(() => {})
                  }
                >
                  <FileCheck2 size={15} />
                  Compile draft paper
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {!snapshot.jobs.length && (
        <p className="empty-result">No external execution requests.</p>
      )}
    </>
  );
}
