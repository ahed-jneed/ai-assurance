"use client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { roles } from "@/lib/domain";
import { qualityStatement } from "@/lib/domain/report-model";
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
          The invitation expires after 30 days. An active member&apos;s email is
          refused: change their access in Members &amp; access instead. Revoking
          a member cancels their pending invitations, and a role change before
          they next sign in supersedes the invitation.
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
export const qualityReviewPolicyModal: ModalDefinition = {
  title: "Quality review policy",
  submitLabel: "Save policy",
  Fields: ({ choices }) => (
    <>
      <label>
        Cooling-off period in days
        <Input
          name="coolingOffDays"
          type="number"
          inputMode="numeric"
          min={0}
          max={3650}
          step={1}
          defaultValue={choices.coolingOffDays}
          required
        />
        <small className="subtle">
          Someone who served on the team of a client&apos;s engagement within
          this period cannot be appointed engagement quality reviewer of another
          engagement for that client. 0 checks only the engagement&apos;s own
          team. Appointments already made keep the period they were checked
          against.
        </small>
      </label>
      <label>
        Reason
        <Input name="reason" required maxLength={5000} autoComplete="off" />
        <small className="subtle">
          Recorded in the practice&apos;s management history with the old and
          new period.
        </small>
      </label>
    </>
  ),
  validate: ({ values: v }) => {
    const days = Number(v.coolingOffDays);
    if (!Number.isInteger(days) || days < 0 || days > 3650)
      throw Error("Enter a whole number of days from 0 to 3650.");
  },
  submit: ({ manage, values: v }) =>
    manage("setQualityReviewPolicy", {
      coolingOffDays: Number(v.coolingOffDays),
      reason: v.reason,
    }),
};
export const reportSettingsModal: ModalDefinition = {
  title: "Report settings",
  submitLabel: "Save report settings",
  Fields: ({ data }) => {
    const s = data?.reportSettings;
    return (
      <>
        <p className="subtle">
          New reports of every engagement state these unless the Lead Auditor
          overrides them on the report. Reports already captured keep what they
          state.
        </p>
        <label>
          Signed by
          <Input
            name="signatory"
            defaultValue={s?.signatory ?? ""}
            maxLength={300}
            autoComplete="off"
          />
          <small className="subtle">
            The practitioner or firm signing reports.
          </small>
        </label>
        <label>
          Location
          <Input
            name="location"
            defaultValue={s?.location ?? ""}
            maxLength={300}
            autoComplete="off"
          />
          <small className="subtle">
            Where the practice practises, e.g. Vienna, Austria.
          </small>
        </label>
        <label>
          Independence and quality management statement
          <Textarea
            name="qualityStatement"
            defaultValue={s?.qualityStatement ?? ""}
            placeholder={qualityStatement}
            maxLength={2000}
          />
          <small className="subtle">
            The ethical requirements the practice complies with and its system
            of quality management, for example ISQM 1 and the IESBA Code. Left
            blank, reports state the default shown.
          </small>
        </label>
      </>
    );
  },
  submit: ({ manage, values: v }) =>
    manage("setReportSettings", {
      signatory: v.signatory ?? "",
      location: v.location ?? "",
      qualityStatement: v.qualityStatement ?? "",
    }),
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
