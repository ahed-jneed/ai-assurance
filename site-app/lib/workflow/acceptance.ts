// Acceptance, independence and competence: the rules the Planning-exit gate
// (lib/domain/gates.ts), the commands (./acceptance-commands.ts) and the
// audit program's acceptance panel share.
//
// A structured engagement leaves Planning only with an approved acceptance
// and continuance record and a current, conflict-free declaration from every
// team member. The team is the people the acceptance record names plus the
// preparers and reviewers of the selected procedures. A declaration is per
// person and per engagement period, dated, and stays current only while
// nobody outside the team it was made for joins the team.
//
// Keep this module free of runtime imports other than relative pure modules:
// the check harnesses load lib/domain.ts, and so this file, through
// scripts/ts-modules.mjs, which does not resolve packages.
import type { AuditGate } from "../domain/gates";
import type { Engagement } from "../domain/types";
import type { Declaration, Workflow } from "../workflow-types";

/**
 * Whether the gate applies: to every workflow adopted or created since it
 * exists, and to an older one once it starts an acceptance record. Other
 * older workflows are prompted to complete one (`acceptancePrompt`).
 */
export const acceptanceApplies = (w: Workflow | undefined): w is Workflow =>
  !!w && (w.acceptanceRequired === true || w.acceptance !== undefined);

/**
 * Everyone who must declare, sorted: the team the acceptance record names
 * and the preparers and reviewers of the selected procedures.
 */
export function engagementTeam(w: Workflow) {
  const ids = new Set(w.acceptance?.team ?? []);
  for (const p of w.procedures)
    if (p.selected)
      for (const id of [p.ownerId, p.reviewerId]) if (id) ids.add(id);
  return [...ids].sort();
}

export type Period = { periodStart: string; periodEnd: string };

/** The engagement period the acceptance record states, if any. */
export const engagementPeriod = (w: Workflow): Period | undefined =>
  w.acceptance && {
    periodStart: w.acceptance.periodStart,
    periodEnd: w.acceptance.periodEnd,
  };

/** A person's latest declaration for the period (by default the current one). */
export function currentDeclaration(
  w: Workflow,
  userId: string,
  period = engagementPeriod(w),
): Declaration | undefined {
  if (!period) return undefined;
  return (w.declarations ?? []).findLast(
    (d) =>
      d.userId === userId &&
      d.periodStart === period.periodStart &&
      d.periodEnd === period.periodEnd,
  );
}

export const unresolvedThreats = (d: Declaration) =>
  d.threats.filter((t) => !t.resolution);

/** A disqualifying relationship or a threat nobody has resolved. */
export const declarationConflicted = (d: Declaration) =>
  d.exclusions.length > 0 || unresolvedThreats(d).length > 0;

export type DeclarationStatus =
  "missing" | "excluded" | "unresolved" | "outdated" | "current";

/** Where a person's declaration for the current period stands. */
export function declarationStatus(
  w: Workflow,
  userId: string,
  team = engagementTeam(w),
): DeclarationStatus {
  const d = currentDeclaration(w, userId);
  if (!d) return "missing";
  if (d.exclusions.length) return "excluded";
  if (unresolvedThreats(d).length) return "unresolved";
  if (team.some((id) => !d.team.includes(id))) return "outdated";
  return "current";
}

export const declarationMessages: Record<
  Exclude<DeclarationStatus, "current">,
  string
> = {
  missing:
    "A team member has not declared independence and competence for this engagement period",
  excluded:
    "A team member declared a disqualifying relationship and must leave the team",
  unresolved:
    "A team member declared an independence threat that nobody has resolved",
  outdated:
    "A declaration predates a change to the engagement team and must be renewed",
};

/**
 * Why this person cannot be assigned to the engagement, if their current
 * declaration (for `period`, by default the current one) is conflicted.
 */
export function assignmentConflict(
  w: Workflow,
  userId: string,
  period?: Period,
) {
  const d = currentDeclaration(w, userId, period ?? engagementPeriod(w));
  if (!d || !declarationConflicted(d)) return undefined;
  return d.exclusions.length
    ? "This person declared a disqualifying relationship with the engagement and cannot be assigned"
    : "This person declared an unresolved independence threat; resolve it before assigning them";
}

/**
 * What the Planning-exit gate still needs: the approved acceptance record,
 * its period agreeing with the engagement brief, and a current,
 * conflict-free declaration from every team member.
 */
export function acceptanceGates(e: Engagement): AuditGate[] {
  const w = e.workflow;
  if (!acceptanceApplies(w)) return [];
  const gates: AuditGate[] = [];
  const a = w.acceptance;
  if (a?.status !== "approved")
    gates.push({
      id: "acceptance",
      kind: "acceptance",
      title: a
        ? "Approve the acceptance and continuance record"
        : "Record acceptance and continuance",
      message:
        "A Lead Auditor must approve the acceptance and continuance record",
    });
  else if (
    w.brief &&
    (w.brief.periodStart !== a.periodStart || w.brief.periodEnd !== a.periodEnd)
  )
    gates.push({
      id: "acceptance-period",
      kind: "acceptance",
      title: "Align the accepted period with the engagement brief",
      message:
        "The accepted engagement period differs from the engagement brief",
    });
  const team = engagementTeam(w);
  for (const userId of team) {
    const status = declarationStatus(w, userId, team);
    if (status !== "current")
      gates.push({
        id: "declaration:" + userId,
        kind: "acceptance",
        recordId: userId,
        title: "Independence and competence declaration · " + userId,
        message: declarationMessages[status],
      });
  }
  return gates;
}

/**
 * A prompt for an engagement the gate did not hold at Planning exit: an
 * older workflow without a record, or one past Planning whose acceptance or
 * declarations are incomplete. Nothing is blocked; the work stays usable.
 */
export function acceptancePrompt(e: Engagement) {
  const w = e.workflow;
  if (!w) return undefined;
  if (!acceptanceApplies(w))
    return "This engagement started before acceptance records. Record its acceptance and continuance and each team member's declaration.";
  if (e.stage !== "Planning" && acceptanceGates(e).length)
    return "This engagement left Planning without a complete acceptance record or current declarations. Complete them so the file shows them.";
  return undefined;
}
