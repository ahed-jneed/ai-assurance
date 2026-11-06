// Engagement quality review (ISQM 2): an Engagement Quality Reviewer outside
// the engagement team evaluates the team's significant judgments and signs
// off the exact final package before it is released. The reviewer is
// appointed by a Lead Auditor, must not be on the engagement team (no
// preparer, reviewer or Lead of the engagement) and must have cooled off from
// the team of the client's other engagements. The checklist titles are our
// own wording with the clause they relate to; no standard text is reproduced
// (D-03).
//
// Every quality review record is internal: the client projection
// (lib/client-projection.ts) never includes it.
import type { Engagement, Report, Role } from "./types";
import type { AuditGate } from "./gates";
import {
  engagementTypes,
  snapshotTerms,
  type EngagementType,
} from "./report-model";

export const qualityReviewerRole = "Engagement Quality Reviewer" satisfies Role;
/**
 * The only engagement commands an Engagement Quality Reviewer may issue: the
 * reviewer reads the engagement and records the review, never audit work.
 */
export const qualityReviewerOps: readonly string[] = [
  "saveQualityReview",
  "signOffQualityReview",
];

/** The stand-back checklist: our own titles with the clause each relates to. */
export const standBackChecklist = [
  {
    id: "understanding",
    clause: "ISQM 2 ¶25",
    title: "Understand the engagement, its subject matter and its risks",
  },
  {
    id: "judgments",
    clause: "ISQM 2 ¶25",
    title: "Discuss the significant matters and judgments with the Lead",
  },
  {
    id: "documentation",
    clause: "ISQM 2 ¶25",
    title: "Review the papers behind significant judgments and conclusions",
  },
  {
    id: "independence",
    clause: "ISQM 2 ¶25",
    title: "Evaluate the basis for the team's independence determination",
  },
  {
    id: "consultation",
    clause: "ISQM 2 ¶25",
    title: "Evaluate consultation on difficult or contentious matters",
  },
  {
    id: "involvement",
    clause: "ISQM 2 ¶25",
    title: "Evaluate whether the Lead's involvement was sufficient",
  },
  {
    id: "report",
    clause: "ISQM 2 ¶25",
    title: "Review the report and whether its conclusion is appropriate",
  },
] as const;
export type ChecklistItemId = (typeof standBackChecklist)[number]["id"];
export const checklistItemIds = standBackChecklist.map((i) => i.id) as [
  ChecklistItemId,
  ...ChecklistItemId[],
];

export type QualityReviewItem = {
  id: ChecklistItemId;
  /** "concern" keeps the item open until the reviewer is satisfied. */
  status: "satisfied" | "concern";
  notes: string;
};
/** The reviewer's sign-off of one final package, bound to its exact hashes. */
export type QualityReviewSignOff = {
  reportId: string;
  internalHash: string;
  clientHash: string;
  /** The checklist revision the sign-off rests on. */
  checklistRevision: number;
  conclusion: string;
  userId: string;
  at: string;
};
export type QualityReview = {
  reviewerId: string;
  appointedBy: string;
  appointedAt: string;
  reason: string;
  /** The cooling-off period the appointment was checked against, in days. */
  coolingOffDays: number;
  /** Counts checklist saves; a sign-off holds only for the revision it rests on. */
  revision: number;
  items: QualityReviewItem[];
  updatedBy?: string;
  updatedAt?: string;
  signOffs: QualityReviewSignOff[];
  history: {
    action: "appoint" | "replace" | "save" | "sign_off";
    actor: string;
    at: string;
    reviewerId: string;
    reason?: string;
    revision?: number;
    reportId?: string;
  }[];
};

/**
 * The engagement team as the engagement record shows it: everyone the
 * acceptance record names, and everyone who prepared, reviewed, commented on,
 * uploaded evidence to, approved, declared for or led any of the engagement's
 * work, with the time of their latest involvement. The
 * quality review records themselves are not team work. Client users' records
 * (evidence uploads, comments) count too: a client's own staff are never
 * independent of the engagement.
 *
 * Work recorded only outside the engagement record (its audit events and
 * assurance records) is read on the server by lib/quality-review-records.ts,
 * which every appointment, checklist save, sign-off, capture and release
 * also consults.
 */
export function engagementTeam(e: Engagement): Map<string, string> {
  const team = new Map<string, string>();
  const add = (userId: string | undefined, at: string | undefined) => {
    if (!userId) return;
    const when = at || e.createdAt || "";
    const seen = team.get(userId);
    if (seen === undefined || when > seen) team.set(userId, when);
  };
  const addAll = (ids: readonly string[] | undefined, at?: string) => {
    for (const id of ids ?? []) add(id, at);
  };
  const w = e.workflow;
  if (w) {
    add(w.adoptedBy, w.adoptedAt);
    // The acceptance record names the team (#23), whether or not they have
    // recorded any work yet; its preparers, approvers and declarants count.
    const acceptance = w.acceptance;
    for (const a of acceptance ? [acceptance, ...acceptance.history] : []) {
      addAll(a.team, a.updatedAt);
      addAll(a.contributors, a.updatedAt);
      add(a.updatedBy, a.updatedAt);
      add(a.approval?.userId, a.approval?.at);
    }
    for (const d of w.declarations ?? []) {
      add(d.userId, d.declaredAt);
      for (const t of d.threats) add(t.resolution?.userId, t.resolution?.at);
    }
    for (const b of [...(w.brief ? [w.brief, ...w.brief.history] : [])]) {
      addAll(b.contributors, b.updatedAt);
      add(b.updatedBy, b.updatedAt);
      add(b.approval?.userId, b.approval?.at);
      add(b.returnedBy, b.returnedAt);
    }
    addAll(w.program.contributors, w.program.updatedAt);
    add(w.program.updatedBy, w.program.updatedAt);
    add(w.program.approval?.userId, w.program.approval?.at);
    for (const h of w.program.history) {
      add(h.actor, h.at);
      add(h.approval?.userId, h.approval?.at);
    }
    for (const p of w.procedures) {
      if (p.selected) {
        add(p.ownerId, p.updatedAt);
        add(p.reviewerId, p.updatedAt);
      }
      addAll(p.contributors, p.updatedAt);
      add(p.updatedBy, p.updatedAt);
      add(p.review?.userId, p.review?.at);
      add(p.execution?.actor, p.execution?.at);
      add(p.execution?.assessment?.actor, p.execution?.assessment?.at);
      add(p.execution?.impactReview?.actor, p.execution?.impactReview?.at);
      for (const h of p.history) {
        add(h.actor, h.at);
        add(h.review?.userId, h.review?.at);
        add(h.execution?.actor, h.execution?.at);
      }
    }
    for (const m of w.monitoring) {
      add(m.createdBy, m.createdAt);
      add(m.ownerId, m.updatedAt);
      addAll(m.contributors, m.updatedAt);
      add(m.closedBy, m.closedAt);
    }
  }
  for (const p of e.papers) {
    add(p.authorId, p.updatedAt);
    addAll(p.contributors, p.updatedAt);
    for (const c of p.comments ?? []) {
      add(c.authorId, c.createdAt);
      for (const r of c.responses ?? []) add(r.actor, r.at);
    }
    for (const r of p.reviews) add(r.userId, r.at);
    for (const s of p.signatures) add(s.userId, s.at);
    for (const h of p.history) {
      add(h.authorId, h.at);
      for (const r of h.reviews) add(r.userId, r.at);
      for (const s of h.signatures) add(s.userId, s.at);
    }
  }
  for (const r of e.evidenceRequests ?? []) {
    add(r.createdBy, r.createdAt);
    add(r.updatedBy, r.updatedAt);
  }
  for (const f of e.findings) {
    add(f.createdBy, undefined);
    add(f.closedBy, undefined);
    add(f.remediationBy, f.remediationAt);
    add(f.support?.actor, f.support?.at);
    add(f.retest?.actor, f.retest?.at);
  }
  for (const a of e.artifacts ?? []) add(a.uploadedBy, a.createdAt);
  for (const m of e.models) add(m.registeredBy, m.registeredAt);
  for (const p of e.evaluationProfiles ?? []) add(p.createdBy, p.createdAt);
  const c = e.classification;
  add(c.approvedBy, c.approvedAt);
  for (const a of Object.values(c.answers ?? {}))
    add(a.answeredBy, a.answeredAt);
  for (const h of c.history ?? []) add(h.by, h.at);
  for (const r of e.reports) {
    add(r.actor, r.createdAt);
    add(r.release?.approval?.userId, r.release?.approval?.at);
    add(r.release?.releasedBy, r.release?.releasedAt);
    for (const h of r.release?.history ?? []) add(h.actor, h.at);
  }
  return team;
}

/** Whether this user is on the engagement team. */
export const onEngagementTeam = (e: Engagement, userId: string) =>
  engagementTeam(e).has(userId);

/**
 * The client's other engagements on whose team the user served within the
 * cooling-off period before `at`: the period runs from their latest recorded
 * involvement there.
 */
export function coolingOffConflicts(
  others: readonly Engagement[],
  userId: string,
  coolingOffDays: number,
  at: string,
) {
  const since = new Date(Date.parse(at) - coolingOffDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return others
    .map((o) => ({ engagement: o, last: engagementTeam(o).get(userId) }))
    .filter(
      (x): x is { engagement: Engagement; last: string } =>
        x.last !== undefined && x.last.slice(0, 10) >= since,
    )
    .map((x) => ({
      id: x.engagement.id,
      title: x.engagement.title,
      last: x.last,
    }));
}

/**
 * Whether final issuance needs an engagement quality review: an appointed
 * reviewer always does, and an assurance engagement type always needs one.
 */
export function qualityReviewRequired(
  e: Engagement,
  engagementType?: EngagementType,
) {
  return (
    !!e.qualityReview ||
    (!!engagementType && !!engagementTypes[engagementType]?.assurance)
  );
}

/** Why the stand-back checklist is not complete; empty when it is. */
export function checklistProblem(q: QualityReview) {
  const open = standBackChecklist.filter((item) => {
    const answer = q.items.find((i) => i.id === item.id);
    return !answer || answer.status !== "satisfied" || !answer.notes.trim();
  });
  if (!open.length) return "";
  return q.items.some((i) => i.status === "concern")
    ? "The engagement quality reviewer has raised concerns that remain open"
    : "The engagement quality reviewer must complete the stand-back checklist";
}

/**
 * What the quality review needs before a final package is captured: an
 * appointed reviewer outside the engagement team and a complete stand-back
 * checklist. The sign-off itself covers the captured package, so release
 * checks it (`qualityReviewReleaseProblem`).
 */
export function qualityReviewGates(
  e: Engagement,
  engagementType?: EngagementType,
): AuditGate[] {
  if (!qualityReviewRequired(e, engagementType)) return [];
  const q = e.qualityReview;
  const gate = (id: string, title: string, message: string): AuditGate => ({
    id,
    kind: "quality_review",
    title,
    message,
  });
  if (!q)
    return [
      gate(
        "quality-review",
        "Appoint an engagement quality reviewer",
        "An assurance engagement needs an engagement quality reviewer before final issuance",
      ),
    ];
  if (onEngagementTeam(e, q.reviewerId))
    return [
      gate(
        "quality-review",
        "Appoint an independent engagement quality reviewer",
        "The engagement quality reviewer is on the engagement team; appoint an eligible reviewer",
      ),
    ];
  const problem = checklistProblem(q);
  return problem
    ? [gate("quality-review:checklist", "Complete the quality review", problem)]
    : [];
}

/**
 * Whether the appointed reviewer has signed off this exact package: both
 * hashes and the current checklist revision.
 */
export const qualityReviewSignedOff = (q: QualityReview, r: Report) =>
  q.signOffs.some(
    (s) =>
      s.reportId === r.id &&
      s.userId === q.reviewerId &&
      s.internalHash === r.sha256 &&
      s.clientHash === r.clientSha256 &&
      s.checklistRevision === q.revision,
  );

/**
 * Why this final package may not be released yet for want of the quality
 * review; empty when the review does not apply or covers the exact package.
 */
export function qualityReviewReleaseProblem(e: Engagement, r: Report) {
  const terms = snapshotTerms(r.snapshot);
  if (!qualityReviewRequired(e, terms?.engagementType)) return "";
  const q = e.qualityReview;
  if (!q)
    return "Appoint an engagement quality reviewer and obtain their sign-off before release";
  if (onEngagementTeam(e, q.reviewerId))
    return "The engagement quality reviewer is on the engagement team; appoint an eligible reviewer";
  return qualityReviewSignedOff(q, r)
    ? ""
    : "The engagement quality reviewer must sign off both exact packages before release";
}
