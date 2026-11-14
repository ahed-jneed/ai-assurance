// Acceptance, independence and competence: the rules the Planning-exit gate
// (lib/domain/gates.ts), the commands (./acceptance-commands.ts) and the
// audit program's acceptance panel share.
//
// A structured engagement leaves Planning only with an approved acceptance
// and continuance record and a current, conflict-free declaration from every
// team member. The team is the people the acceptance record names plus the
// preparers and reviewers of the selected procedures. A declaration is per
// person and per engagement period, dated, and stays current only while
// nobody outside the team it was made for joins the team. A disqualifying
// relationship is not tied to a period: it stands, whatever the period, until
// someone other than the declarant withdraws it.
import type { AuditGate } from "../domain/gates";
import type { Engagement } from "../domain/types";
import {
  acceptancePreconditions,
  type Declaration,
  type Workflow,
} from "../workflow-types";

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

/**
 * A person's latest declaration on the engagement in any period. It carries
 * every disqualifying relationship they declared and nobody withdrew,
 * because a declaration may not drop one (saveDeclaration).
 */
export const latestDeclaration = (
  w: Workflow,
  userId: string,
): Declaration | undefined =>
  (w.declarations ?? []).findLast((d) => d.userId === userId);

/** The disqualifying relationships that stand for a person, in any period. */
export const standingExclusions = (w: Workflow, userId: string) =>
  latestDeclaration(w, userId)?.exclusions ?? [];

export const unresolvedThreats = (d: Declaration) =>
  d.threats.filter((t) => !t.resolution);

export type DeclarationStatus =
  "missing" | "excluded" | "unresolved" | "outdated" | "current";

/** Where a person's declaration for the current period stands. */
export function declarationStatus(
  w: Workflow,
  userId: string,
  team = engagementTeam(w),
): DeclarationStatus {
  if (standingExclusions(w, userId).length) return "excluded";
  const d = currentDeclaration(w, userId);
  if (!d) return "missing";
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

/** The conflict a person's declarations raise against the engagement, if any. */
export function declaredConflict(
  w: Workflow,
  userId: string,
  period?: Period,
): "excluded" | "threat" | undefined {
  if (standingExclusions(w, userId).length) return "excluded";
  const d = currentDeclaration(w, userId, period ?? engagementPeriod(w));
  return d && unresolvedThreats(d).length ? "threat" : undefined;
}

/**
 * Why this person cannot be assigned to the engagement, if any: a
 * disqualifying relationship they declared in any period and nobody
 * withdrew, or a threat in their declaration for `period` (by default the
 * current one) that nobody has resolved. With `name` the reason names them.
 */
export function assignmentConflict(
  w: Workflow,
  userId: string,
  period?: Period,
  name = "This person",
) {
  const conflict = declaredConflict(w, userId, period);
  if (conflict === "excluded")
    return (
      name +
      " declared a disqualifying relationship with the engagement and cannot be assigned"
    );
  if (conflict === "threat")
    return (
      name +
      " declared an unresolved independence threat; resolve it before assigning them"
    );
  return undefined;
}

/**
 * Why a Lead Auditor (`approverId`) cannot approve the acceptance record's
 * current draft, if any, and the status the server refuses it with. The
 * approval command and the acceptance panel's Approve button share it, so
 * the button is disabled with the reason the server gives; a team member's
 * conflict names them by `nameOf` (their display name).
 */
export function approvalRefusal(
  w: Workflow,
  approverId: string,
  nameOf: (userId: string) => string = (id) => id,
): { status: 400 | 409; message: string } | undefined {
  const a = w.acceptance;
  if (!a)
    return { status: 400, message: "Record acceptance and continuance first" };
  if (acceptancePreconditions.some((k) => !a.preconditions[k].met))
    return {
      status: 400,
      message:
        "Every ISAE 3000 precondition must be met before the engagement is accepted",
    };
  if (!a.team.includes(approverId))
    return {
      status: 400,
      message: "Name yourself on the engagement team before accepting it",
    };
  // Whichever period it was declared for, an open threat or a standing
  // relationship blocks acceptance.
  for (const id of engagementTeam(w)) {
    const conflict = declaredConflict(w, id);
    if (conflict)
      return {
        status: 409,
        message:
          nameOf(id) +
          (conflict === "excluded"
            ? " declared a disqualifying relationship with the engagement; remove them from the team before accepting it"
            : " declared an independence threat that nobody has resolved; resolve it before accepting the engagement"),
      };
  }
  return undefined;
}

/** The team members whose declarations block acceptance (approvalRefusal). */
export const conflictedTeam = (w: Workflow) =>
  engagementTeam(w).filter((id) => declaredConflict(w, id));

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
        id: declarationGate + userId,
        kind: "acceptance",
        recordId: userId,
        title: declarationTitle + " · " + userId,
        message: declarationMessages[status],
      });
  }
  return gates;
}

const declarationGate = "declaration:";
const declarationTitle = "Independence and competence declaration";

/**
 * A gate's title for display: a declaration gate names the team member by
 * `nameOf` (their display name) instead of their user id, which stays the
 * fallback for someone no longer in the practice.
 */
export function gateTitle(
  g: AuditGate,
  nameOf: (userId: string) => string | undefined = () => undefined,
) {
  return g.kind === "acceptance" &&
    g.recordId &&
    g.id === declarationGate + g.recordId
    ? declarationTitle + " · " + (nameOf(g.recordId) || g.recordId)
    : g.title;
}

/**
 * Why this person may not be given access to the engagement, if any: the
 * conflict that refuses assigning them (assignmentConflict). Every grant of
 * engagement access applies it (grantMember and updateMember, setAccess,
 * and an accepted invitation, which withholds that engagement), so access
 * never reaches a person the Planning-exit gate would refuse.
 */
export const accessConflict = (
  e: Pick<Engagement, "workflow">,
  userId: string,
) => (e.workflow ? assignmentConflict(e.workflow, userId) : undefined);

/** Declaration work for the inbox (lib/work-items.ts). */
export type AcceptanceTask =
  | {
      kind: "declaration";
      userId: string;
      status: "missing" | "outdated";
    }
  | {
      kind: "threat";
      userId: string;
      declarationId: string;
      threats: number;
    };

/**
 * What team members still owe the acceptance record: a declaration for the
 * current period that is missing or predates a team change (the declarant
 * makes it), and declared threats nobody has resolved (someone other than
 * the declarant evaluates them). Nothing is due before the acceptance record
 * states the period a declaration is made for.
 */
export function acceptanceTasks(w: Workflow | undefined): AcceptanceTask[] {
  if (!acceptanceApplies(w) || !w.acceptance) return [];
  const team = engagementTeam(w),
    tasks: AcceptanceTask[] = [];
  for (const userId of team) {
    const d = currentDeclaration(w, userId),
      open = d ? unresolvedThreats(d).length : 0;
    if (d && open)
      tasks.push({
        kind: "threat",
        userId,
        declarationId: d.id,
        threats: open,
      });
    // A standing relationship ("excluded") is no declaration to make.
    const status = declarationStatus(w, userId, team);
    if (status === "missing" || status === "outdated")
      tasks.push({ kind: "declaration", userId, status });
  }
  return tasks;
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
