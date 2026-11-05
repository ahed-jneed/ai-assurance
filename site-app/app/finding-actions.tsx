"use client";
import { Button } from "@/components/ui/button";
import { findingWorkflow } from "@/lib/finding-workflow";
import type { Artifact, Finding, Role } from "@/lib/domain";

export function FindingActions({
  finding,
  artifacts,
  role,
  userId,
  busy,
  onRemediate,
  onRetest,
  compact = false,
}: {
  finding: Finding;
  artifacts: Artifact[];
  role: Role;
  userId: string;
  busy: boolean;
  onRemediate: (id: string) => void;
  onRetest: (id: string) => void;
  compact?: boolean;
}) {
  const state = findingWorkflow(finding, artifacts, role, userId);
  if (!state.canRemediate && !state.showRetest) return null;
  return (
    <div className={compact ? "finding-actions compact" : "finding-actions"}>
      <div className="row-actions">
        {state.canRemediate && (
          <Button
            size={compact ? "sm" : "default"}
            variant={state.canRetest || compact ? "outline" : "default"}
            disabled={busy}
            onClick={() => onRemediate(finding.id)}
          >
            Update remediation
          </Button>
        )}
        {state.showRetest && (
          <Button
            size={compact ? "sm" : "default"}
            variant={compact ? "outline" : "default"}
            disabled={busy || !state.canRetest}
            title={state.reason || undefined}
            aria-describedby={
              state.reason
                ? "retest-reason-" + finding.id + (compact ? "-row" : "-detail")
                : undefined
            }
            onClick={() => onRetest(finding.id)}
          >
            Review retest
          </Button>
        )}
      </div>
      {state.reason && (
        <p
          className={compact ? "sr-only" : "subtle workflow-reason"}
          id={"retest-reason-" + finding.id + (compact ? "-row" : "-detail")}
        >
          {state.reason}
        </p>
      )}
    </div>
  );
}
