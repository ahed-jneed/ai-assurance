// Acceptance commands: the acceptance and continuance record a Lead Auditor
// approves, each team member's dated independence and competence
// declaration, and the evaluation that resolves a declared threat. The rules
// they share with the Planning-exit gate live in ./acceptance.ts.
import { z } from "../zod";
import { isInternalRole } from "../workflow-state";
import {
  acceptancePreconditions,
  accessLevels,
  competenceAreas,
  competenceLevels,
  exclusionKinds,
  threatKinds,
  type DeclaredThreat,
  type Workflow,
} from "../workflow-types";
import {
  approvalRefusal,
  assignmentConflict,
  conflictedTeam,
  currentDeclaration,
  engagementTeam,
  latestDeclaration,
  unresolvedThreats,
  type Period,
} from "./acceptance";
import {
  calendarDate,
  type Context,
  fail,
  optional,
  short,
  snapshot,
  text,
  type WorkflowHandler,
} from "./command";

/** Bounds that keep the engagement record small. */
export const acceptanceLimits = { revisions: 40, declarations: 300 };

const distinct = (v: unknown[]) => new Set(v).size === v.length;
const precondition = z.object({ met: z.boolean(), basis: text }).strict();
const acceptanceFields = z
  .object({
    decision: z.enum(["acceptance", "continuance"]),
    preconditions: z
      .object(
        Object.fromEntries(
          acceptancePreconditions.map((k) => [k, precondition]),
        ) as Record<
          (typeof acceptancePreconditions)[number],
          typeof precondition
        >,
      )
      .strict(),
    scope: text,
    periodStart: calendarDate,
    periodEnd: calendarDate,
    systemBoundary: text,
    accessLevel: z.enum(accessLevels),
    engagementLetter: short,
    team: z
      .array(short)
      .min(1)
      .max(50)
      .refine(distinct, "Name each team member once"),
    competenceConclusion: text,
    changeReason: optional,
  })
  .strict();
const level = z.enum(competenceLevels);
const declarationFields = z
  .object({
    priorWork: optional,
    threats: z
      .array(
        z
          .object({
            kind: z.enum(threatKinds),
            description: text,
            safeguards: optional,
          })
          .strict(),
      )
      .max(threatKinds.length)
      .refine(
        (v) => distinct(v.map((t) => t.kind)),
        "Declare each threat category once",
      ),
    exclusions: z
      .array(z.enum(exclusionKinds))
      .max(exclusionKinds.length)
      .refine(distinct, "Declare each relationship once"),
    competence: z
      .object(
        Object.fromEntries(competenceAreas.map((k) => [k, level])) as Record<
          (typeof competenceAreas)[number],
          typeof level
        >,
      )
      .strict(),
    expertField: z.string().trim().max(300),
    confirmed: z.literal(true),
  })
  .strict();

/**
 * Refuses to assign a person with a disqualifying relationship declared in
 * any period and not withdrawn, or with an unresolved threat in their
 * declaration for `period` (by default the current one). Without a declaration, assignment is allowed: the
 * Planning-exit gate then asks for one.
 */
export function assignable(w: Workflow, userId: string, period?: Period) {
  const conflict = assignmentConflict(w, userId, period);
  if (conflict) fail(400, conflict);
}

/** A member's display name for a refusal, or their user id. */
const nameOf = async (c: Context, userId: string) =>
  (await c.displayName?.(userId)) || userId;

export const acceptanceCommands: Record<string, WorkflowHandler> = {
  async saveAcceptance({ c, writer, lead, authorized, w }, data) {
    writer();
    const a = acceptanceFields.parse(data),
      x = w(),
      old = x.acceptance;
    if (a.periodStart > a.periodEnd)
      fail(400, "The engagement period ends before it starts");
    if (old?.status === "approved") {
      lead();
      if (!a.changeReason)
        fail(400, "Explain why the approved acceptance record changes");
      if (old.history.length >= acceptanceLimits.revisions)
        fail(
          413,
          "The acceptance record reached its revision limit; continue in a follow-up engagement",
        );
    }
    for (const id of a.team) {
      await authorized(id, ["Auditor", "Lead Auditor", "Reviewer"]);
      // The refusal names the person, as the team checklist marks them.
      if (assignmentConflict(x, id, a))
        fail(400, assignmentConflict(x, id, a, await nameOf(c, id))!);
    }
    // An approved revision enters the history when a Lead revises it; drafts
    // are amended without entries.
    x.acceptance = {
      ...a,
      revision: (old?.revision ?? 0) + 1,
      status: "draft",
      contributors: [...new Set([...(old?.contributors ?? []), c.userId])],
      updatedBy: c.userId,
      updatedAt: c.at,
      history:
        old?.status === "approved"
          ? [...old.history, snapshot(old)]
          : (old?.history ?? []),
    };
    return { acceptanceRevision: String(x.acceptance.revision) };
  },
  async approveAcceptance({ e, c, lead, w }, data) {
    lead();
    const a = z
      .object({ revision: z.number().int(), reason: text })
      .strict()
      .parse(data);
    const x = w(),
      r = x.acceptance ?? fail(400, "Record acceptance and continuance first");
    if (r.status !== "draft" || r.revision !== a.revision)
      fail(409, "Review the current draft of the acceptance record");
    // The acceptance panel's Approve button applies the same precondition
    // (approvalRefusal), naming a conflicted team member the same way.
    const names = new Map<string, string>();
    for (const id of conflictedTeam(x)) names.set(id, await nameOf(c, id));
    const refusal = approvalRefusal(x, c.userId, (id) => names.get(id) ?? id);
    if (refusal) fail(refusal.status, refusal.message);
    r.approval = {
      userId: c.userId,
      at: c.at,
      revision: r.revision,
      hash: await c.sha256(
        JSON.stringify({ ...r, history: undefined, approval: undefined }),
      ),
      reason: a.reason,
      stage: e.stage,
    };
    r.status = "approved";
    return { acceptanceRevision: String(r.revision) };
  },
  async saveDeclaration({ c, w }, data) {
    if (!isInternalRole(c.role))
      fail(
        403,
        "Only Auditors, Lead Auditors and Reviewers declare independence",
      );
    const a = declarationFields.parse(data),
      x = w(),
      period =
        x.acceptance ??
        fail(
          409,
          "Record the acceptance record and its engagement period before declaring",
        );
    if (a.priorWork && !a.threats.some((t) => t.kind === "self_review"))
      fail(
        400,
        "Declare the self-review threat that earlier work on the system creates",
      );
    if ((x.declarations?.length ?? 0) >= acceptanceLimits.declarations)
      fail(
        413,
        "This engagement reached its declaration limit; continue in a follow-up engagement",
      );
    // A renewal never clears a conflict: the declarant cannot drop a
    // disqualifying relationship (declared for any period) or an unresolved
    // threat (for this period) by declaring again, so changing the period
    // does not help either. Someone else withdraws the one and evaluates the
    // other. An evaluation carries forward while the threat is unchanged, and
    // withdrawals carry forward so the record keeps showing them.
    const latest = latestDeclaration(x, c.userId),
      prior = currentDeclaration(x, c.userId, period);
    if (latest?.exclusions.some((k) => !a.exclusions.includes(k)))
      fail(
        409,
        "A renewal cannot remove a disqualifying relationship you declared; a Lead Auditor or Reviewer other than you withdraws it with a reason",
      );
    if (
      prior &&
      unresolvedThreats(prior).some(
        (t) => !a.threats.some((n) => n.kind === t.kind),
      )
    )
      fail(
        409,
        "A renewal cannot drop an independence threat nobody has resolved; a Lead Auditor or Reviewer other than you evaluates it",
      );
    const threats = a.threats.map((t): DeclaredThreat => {
      const p = prior?.threats.find((p) => p.kind === t.kind);
      return {
        kind: t.kind,
        description: t.description,
        safeguards: t.safeguards,
        ...(p?.resolution &&
        p.description === t.description &&
        p.safeguards === t.safeguards
          ? { resolution: p.resolution }
          : {}),
      };
    });
    const id = c.id("DEC");
    x.declarations = [
      ...(x.declarations ?? []),
      {
        id,
        userId: c.userId,
        role: c.role,
        declaredAt: c.at,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        team: [...new Set([...engagementTeam(x), c.userId])].sort(),
        priorWork: a.priorWork,
        threats,
        exclusions: a.exclusions,
        ...(latest?.exclusionWithdrawals?.length
          ? { exclusionWithdrawals: latest.exclusionWithdrawals }
          : {}),
        competence: a.competence,
        expertField: a.expertField,
      },
    ];
    return { declarationId: id };
  },
  async resolveDeclaredThreat({ c, reviewer, w }, data) {
    reviewer();
    const a = z
      .object({
        declarationId: short,
        kind: z.enum(threatKinds),
        reason: text,
      })
      .strict()
      .parse(data);
    const x = w(),
      d =
        x.declarations?.find((d) => d.id === a.declarationId) ??
        fail(404, "Declaration not found in this engagement");
    if (d.userId === c.userId)
      fail(403, "Someone other than the declarant must evaluate the threat");
    if (currentDeclaration(x, d.userId) !== d)
      fail(409, "Evaluate the person's current declaration");
    const t =
      d.threats.find((t) => t.kind === a.kind) ??
      fail(404, "This threat was not declared");
    if (t.resolution) fail(409, "This threat is already resolved");
    t.resolution = { userId: c.userId, at: c.at, reason: a.reason };
    return { declarationId: d.id };
  },
  async withdrawDeclaredExclusion({ c, reviewer, w }, data) {
    reviewer();
    const a = z
      .object({
        declarationId: short,
        kind: z.enum(exclusionKinds),
        reason: text,
      })
      .strict()
      .parse(data);
    const x = w(),
      d =
        x.declarations?.find((d) => d.id === a.declarationId) ??
        fail(404, "Declaration not found in this engagement");
    if (d.userId === c.userId)
      fail(
        403,
        "Someone other than the declarant must withdraw a disqualifying relationship",
      );
    // Relationships stand across periods, so the person's latest declaration
    // in any period holds them.
    if (latestDeclaration(x, d.userId) !== d)
      fail(409, "Withdraw from the person's latest declaration");
    if (!d.exclusions.includes(a.kind))
      fail(404, "This relationship is not declared");
    // A correction, not a safeguard: the relationship was declared in error
    // or does not exist. The withdrawal stays on the declaration.
    d.exclusions = d.exclusions.filter((k) => k !== a.kind);
    d.exclusionWithdrawals = [
      ...(d.exclusionWithdrawals ?? []),
      { kind: a.kind, userId: c.userId, at: c.at, reason: a.reason },
    ];
    return { declarationId: d.id };
  },
};
