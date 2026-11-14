"use client";
import { Input } from "@/components/ui/input";
import { canAssignEngagementAccess, isClientRole } from "@/lib/permissions";
import { roles } from "@/lib/domain";
import { Choice } from "../workspace-ui";
import type {
  ModalDefinition,
  ModalFieldsProps,
  ModalSubmitContext,
} from "./types";

const clientRole = isClientRole;

/** The engagement checkboxes' flag names: "engagement:<id>". */
const engagementFlag = "engagement:";
/** The engagements ticked in a form that lists them. */
export const checkedEngagements = (checks: Record<string, boolean>) =>
  Object.keys(checks)
    .filter((key) => key.startsWith(engagementFlag) && checks[key])
    .map((key) => key.slice(engagementFlag.length));
/** Pre-ticks the given engagements when a form opens. */
export const engagementFlags = (ids: string[]) =>
  Object.fromEntries(ids.map((id) => [engagementFlag + id, true]));

/**
 * Whether the form starts a fresh grant, which withdraws every earlier
 * engagement grant: a new member, a restored one, or a change of role.
 */
const freshGrant = (kind: string, choices: Record<string, string>) =>
  kind === "member" || choices.role !== choices.originalRole;

/**
 * Engagements to grant with a membership or invitation. Only a Lead Auditor
 * may assign them; the list holds the engagements the caller can open.
 */
export function EngagementChecks({
  data,
  checks,
  check,
  legend,
}: Pick<ModalFieldsProps, "data" | "checks" | "check"> & {
  legend: string;
}) {
  const engagements = data?.engagements ?? [],
    assign = !!data && canAssignEngagementAccess(data.identity);
  return (
    <fieldset className="onboarding-options">
      <legend>{legend}</legend>
      {!assign && (
        <p className="subtle">
          Only a Lead Auditor can assign engagements. A Lead can grant them in
          Assurance workbench → Team & runtime.
        </p>
      )}
      {engagements.map((g) => (
        <label key={g.id}>
          <input
            type="checkbox"
            disabled={!assign}
            checked={!!checks[engagementFlag + g.id]}
            onChange={(ev) => check(engagementFlag + g.id, ev.target.checked)}
          />
          <span>{g.title}</span>
        </label>
      ))}
      {!engagements.length && (
        <p className="subtle">You have no engagements to assign.</p>
      )}
    </fieldset>
  );
}

/** Member access, shared by the add, restore and edit-access forms. */
function MemberFields(props: ModalFieldsProps) {
  const { kind, choices, choice, data } = props;
  const restoring = kind === "member" && !!choices.userId;
  return (
    <>
      {kind === "member" && (
        <label>
          Account ID
          <Input
            name="userId"
            defaultValue={choices.userId}
            readOnly={!!choices.userId}
            required
            maxLength={300}
          />
          <small className="subtle">
            {restoring
              ? "Restoring access grants nothing from before the revocation."
              : "Ask your colleague to copy this from Members & access after signing in, or invite them by email instead."}
          </small>
        </label>
      )}
      <label>
        Name
        <Input
          name="displayName"
          defaultValue={choices.displayName}
          required
          maxLength={300}
        />
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
              data?.clients.map((c) => ({
                value: c.id,
                label: c.name,
              })) ?? []
            }
            onChange={(v) => choice("clientId", v)}
          />
        </label>
      ) : freshGrant(kind, choices) ? (
        <EngagementChecks
          {...props}
          legend={
            kind === "memberEdit"
              ? "Engagements kept with the new role (all others are withdrawn)"
              : restoring
                ? "Engagements to grant again"
                : "Engagement access"
          }
        />
      ) : (
        <p className="subtle">
          Assign this member to specific engagements in Assurance workbench →
          Team & runtime. Changing the role withdraws their engagement access
          and the runner workers they sponsored.
        </p>
      )}
      <p className="subtle">
        Site sharing must also allow this person to open the platform.
      </p>
    </>
  );
}
function validateMember({ choices }: ModalSubmitContext) {
  if (!choices.role || (clientRole(choices.role) && !choices.clientId))
    throw Error(
      clientRole(choices.role)
        ? "Choose the client this viewer can access."
        : "Choose a role for this member.",
    );
}
const saveMember =
  (op: "grantMember" | "updateMember") =>
  ({ manage, choices, checks, values: v, kind }: ModalSubmitContext) =>
    manage(op, {
      userId: choices.userId || v.userId,
      displayName: v.displayName,
      role: choices.role,
      clientId: clientRole(choices.role) ? choices.clientId || null : null,
      // A fresh grant lists its engagements explicitly; nothing earlier is
      // restored (F-24).
      ...(!clientRole(choices.role) && freshGrant(kind, choices)
        ? { engagementIds: checkedEngagements(checks) }
        : {}),
    });
export const memberModal: ModalDefinition = {
  title: "Add member",
  submitLabel: "Add member",
  Fields: MemberFields,
  validate: validateMember,
  submit: saveMember("grantMember"),
};
export const memberEditModal: ModalDefinition = {
  title: "Edit access",
  submitLabel: "Update access",
  Fields: MemberFields,
  validate: validateMember,
  submit: saveMember("updateMember"),
};
