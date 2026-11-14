// What the procedure drawer shows as the procedure's readiness. Ordinary
// work gets the generic checklist from planning to sign-off. A release-time
// record (WP-RP-02) is never prepared, executed or signed, so that checklist
// would list steps nobody can take (#94): it shows whether a release has
// recorded it instead.
import type { Engagement } from "./domain/types";
import { isReleaseTimeRecord } from "./domain/release-time";
import { procedureWork } from "./work-items";
import { currentExecution } from "./workflow-state";
import type { Procedure } from "./workflow-types";

export type ProcedureReadiness =
  | { kind: "checks"; checks: (readonly [string, boolean])[] }
  | { kind: "release_time"; recorded: boolean; text: string };

export function procedureReadiness(
  e: Engagement,
  p: Procedure,
): ProcedureReadiness {
  if (isReleaseTimeRecord(p.templateId)) {
    // The latest release that recorded it, released or since superseded.
    const recorded = e.reports
      .filter(
        (r) =>
          r.release?.completion?.templateIds.includes(p.templateId) &&
          ["released", "superseded"].includes(r.release.state),
      )
      .at(-1);
    return recorded
      ? {
          kind: "release_time",
          recorded: true,
          text:
            "Recorded with the release of " +
            recorded.id +
            " on " +
            recorded.release!.completion!.releasedAt.slice(0, 10) +
            ", against both approved package hashes.",
        }
      : {
          kind: "release_time",
          recorded: false,
          text: "Not recorded yet: approving and releasing the final package records it.",
        };
  }
  const x = procedureWork(e, p.id)!;
  return {
    kind: "checks",
    checks: [
      [
        "Scope & program approved",
        e.workflow?.brief?.status === "approved" &&
          e.workflow.program.status === "approved",
      ],
      ["Preparer & reviewer assigned", !!p.ownerId && !!p.reviewerId],
      ["Current execution recorded", !!p.execution && currentExecution(e, p)],
      ["Evidence requests resolved", !x.outstanding.length],
      [
        "Supporting files accepted",
        !!p.execution?.evidenceIds.length &&
          p.execution.evidenceIds.every((id) =>
            e.artifacts.some((a) => a.id === id && a.status === "accepted"),
          ),
      ],
      [
        "Review questions resolved",
        !x.paper?.comments.some((c) => !c.resolved),
      ],
      ["Evidence assessment recorded", !!p.execution?.assessment],
      ["Independent review completed", p.state === "reviewed" && !!p.review],
      ["Working paper signed", x.paper?.status === "signed"],
    ],
  };
}
