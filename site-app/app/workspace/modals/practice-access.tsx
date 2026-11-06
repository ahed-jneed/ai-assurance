"use client";
import { Input } from "@/components/ui/input";
import { roles } from "@/lib/domain";
import { Choice } from "../workspace-ui";
import { checkedEngagements, EngagementChecks } from "./member";
import type { ModalDefinition, ModalFieldsProps } from "./types";

// Practice administration, invitations by email, the practice's name and its
// signing key.

const clientRole = (role: string) =>
  ["Client Viewer", "Client Contributor"].includes(role);

function InviteFields(props: ModalFieldsProps) {
  const { choices, choice, data } = props;
  return (
    <>
      <label>
        Email
        <Input
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="off"
        />
        <small className="subtle">
          They join this practice the next time they sign in with this email.
          The invitation expires after 30 days. Inviting someone who is already
          an active member keeps their role and only adds the engagements you
          choose; a revocation or role change before they next sign in cancels
          the invitation.
        </small>
      </label>
      <label>
        Name (optional)
        <Input name="displayName" maxLength={300} />
      </label>
      <label>
        Role
        <Choice
          label="Role"
          value={choices.role}
          values={roles}
          onChange={(v) => choice("role", v)}
        />
      </label>
      {clientRole(choices.role) ? (
        <label>
          Client
          <Choice
            label="Client"
            value={choices.clientId ?? ""}
            values={
              data?.clients.map((c) => ({ value: c.id, label: c.name })) ?? []
            }
            onChange={(v) => choice("clientId", v)}
          />
        </label>
      ) : (
        <EngagementChecks {...props} legend="Engagement access" />
      )}
      <p className="subtle">
        Site sharing must also allow this person to open the platform.
      </p>
    </>
  );
}
export const inviteModal: ModalDefinition = {
  title: "Invite by email",
  submitLabel: "Save invitation",
  Fields: InviteFields,
  validate: ({ choices }) => {
    if (!choices.role || (clientRole(choices.role) && !choices.clientId))
      throw Error(
        clientRole(choices.role)
          ? "Choose the client this person belongs to."
          : "Choose a role for this person.",
      );
  },
  submit: ({ manage, choices, checks, values: v }) =>
    manage("inviteMember", {
      email: v.email,
      ...(v.displayName?.trim() ? { displayName: v.displayName.trim() } : {}),
      role: choices.role,
      ...(clientRole(choices.role)
        ? { clientId: choices.clientId }
        : { engagementIds: checkedEngagements(checks) }),
    }),
};
export const invitationCancelModal: ModalDefinition = {
  title: "Cancel invitation",
  submitLabel: "Cancel invitation",
  Fields: ({ choices }) => (
    <p>
      Cancel the pending invitation for <b>{choices.email}</b>? They will not
      join the practice when they sign in.
    </p>
  ),
  submit: ({ manage, choices }) =>
    manage("cancelInvitation", { invitationId: choices.invitationId }),
};
export const practiceRenameModal: ModalDefinition = {
  title: "Rename practice",
  submitLabel: "Save name",
  Fields: ({ choices }) => (
    <label>
      Practice name
      <Input name="name" defaultValue={choices.name} required maxLength={80} />
      <small className="subtle">
        Members of several practices see this name in the practice switcher.
      </small>
    </label>
  ),
  submit: ({ manage, values: v }) => manage("renamePractice", { name: v.name }),
};
export const signingKeyRotateModal: ModalDefinition = {
  title: "Rotate signing key",
  submitLabel: "Rotate key",
  Fields: () => (
    <>
      <p>
        Dossiers and briefing packets from every engagement of this practice are
        signed with a new key from now on. The current key retires: its private
        half is erased and its public half stays listed, so everything it signed
        still verifies. Give recipients who pin keys the new key through an
        independent channel.
      </p>
      <label>
        Reason
        <Input name="reason" required maxLength={500} autoComplete="off" />
        <small className="subtle">
          Recorded in the practice&apos;s management history, for example a
          scheduled rotation or a suspected exposure.
        </small>
      </label>
    </>
  ),
  submit: ({ manage, values: v }) =>
    manage("rotateSigningKey", { reason: v.reason }),
};
export const adminGrantModal: ModalDefinition = {
  title: "Grant practice administration",
  submitLabel: "Grant administration",
  Fields: ({ choices }) => (
    <p>
      <b>{choices.displayName}</b> will manage clients, members, invitations and
      administrators of this practice.
    </p>
  ),
  submit: ({ manage, choices }) =>
    manage("grantAdmin", { userId: choices.userId }),
};
export const adminRevokeModal: ModalDefinition = {
  title: "Remove practice administration",
  submitLabel: "Remove administration",
  Fields: ({ choices }) => (
    <p>
      <b>{choices.displayName}</b> keeps their role and engagement access but no
      longer manages the practice. A practice always keeps at least one active
      administrator.
    </p>
  ),
  submit: ({ manage, choices }) =>
    manage("revokeAdmin", { userId: choices.userId }),
};
export const adminTransferModal: ModalDefinition = {
  title: "Transfer practice administration",
  submitLabel: "Transfer administration",
  Fields: ({ choices }) => (
    <p>
      <b>{choices.displayName}</b> becomes a practice administrator and you stop
      being one. Your role and engagement access stay as they are.
    </p>
  ),
  submit: ({ manage, choices }) =>
    manage("transferAdmin", { userId: choices.userId }),
};
