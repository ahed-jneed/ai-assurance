// The events of the practice Access log (#181), shared by the server's read
// model (lib/read-models/access-log.ts), sign-in recording (lib/tenancy.ts)
// and the page (app/access-log.tsx). Dependency-free, so the browser loads it.

/**
 * How long a member may go without a recorded sign-in to a practice before
 * their next request to it is recorded as one. Identity is resolved on every
 * request (lib/identity.ts) and no identity mode reports a session start, so
 * the Access log records the first request after a gap instead.
 */
export const signInGapHours = 8;

/**
 * How long a recorded sign-in is kept (#185): a year plus a margin for an
 * annual audit cycle. Older sign-ins are pruned when a new one is recorded
 * (pruneSignIns in lib/tenancy.ts); management events are kept.
 */
export const signInRetentionDays = 400;

/**
 * The Access log's event types, in the order its filter offers them: members'
 * sign-ins, then the management events about membership, roles and practice
 * administration (lib/commands/management/members.ts, invitations.ts,
 * admins.ts and lib/invitations.ts), each with the name the page shows.
 */
export const accessEventLabels = {
  signIn: "Signed in",
  grantMember: "Member granted",
  updateMember: "Member changed",
  revokeMember: "Member revoked",
  inviteMember: "Invitation sent",
  cancelInvitation: "Invitation cancelled",
  acceptInvitation: "Invitation accepted",
  supersedeInvitation: "Invitation superseded",
  grantAdmin: "Administration granted",
  revokeAdmin: "Administration revoked",
  transferAdmin: "Administration transferred",
} as const;

export type AccessEventType = keyof typeof accessEventLabels;
export const accessEventTypes = Object.keys(
  accessEventLabels,
) as AccessEventType[];

/** The page's name for an Access log event type. */
export function accessEventLabel(action: string) {
  return Object.hasOwn(accessEventLabels, action)
    ? accessEventLabels[action as AccessEventType]
    : action;
}
