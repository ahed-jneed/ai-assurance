"use client";
import { Input } from "@/components/ui/input";
import { canAssignEngagementAccess, isClientRole } from "@/lib/permissions";
import { roles } from "@/lib/domain/types";
import { Choice } from "../workspace-ui";
import type {
  ModalDefinition,
  ModalFieldsProps,
  ModalSubmitContext,
} from "./types";

const clientRole = isClientRole;

/** The engagement checkboxes' flag names: "engagement:<id>". */
const engagementFlag = "engagement:";
/**
 * The engagements the member already held when the form opened:
 * "granted:<id>". An edit that keeps the role keeps them ticked; withdrawing
 * one is Team & runtime's work.
 */
const grantedFlag = "granted:";
const flagged = (checks: Record<string, boolean>, prefix: string) =>
  Object.keys(checks)
    .filter((key) => key.startsWith(prefix) && checks[key])
    .map((key) => key.slice(prefix.length));
/** The engagements ticked in a form that lists them. */
export const checkedEngagements = (checks: Record<string, boolean>) =>
  flagged(checks, engagementFlag);
/**
 * Pre-ticks the given engagements when a form opens, and remembers them as
 * the member's current grants.
 */
export const engagementFlags = (ids: string[]) =>
  Object.fromEntries(
    ids.flatMap((id) => [
      [engagementFlag + id, true],
      [grantedFlag + id, true],
    ]),
  );

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
  keepGranted = false,
}: Pick<ModalFieldsProps, "data" | "checks" | "check"> & {
  legend: string;
  /**
   * The member's current grants stay ticked and cannot be cleared here: an
   * edit that keeps the role only adds engagements (F-24).
   */
  keepGranted?: boolean;
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
      {assign && keepGranted && (
        <p className="subtle">
          Tick engagements to add. To withdraw access to one, use Assurance
          workbench → Team & runtime; changing the role withdraws all of them
          and the runner workers this member sponsored.
        </p>
      )}
      {engagements.map((g) => (
        <label key={g.id}>
          <input
            type="checkbox"
            disabled={!assign || (keepGranted && !!checks[grantedFlag + g.id])}
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
      ) : (
        // Every staff role, the Engagement Quality Reviewer included, holds
        // engagement grants (#225), with or without a change of role.
        <EngagementChecks
          {...props}
          keepGranted={!freshGrant(kind, choices)}
          legend={
            !freshGrant(kind, choices)
              ? "Engagement access"
              : kind === "memberEdit"
                ? "Engagements kept with the new role (all others are withdrawn)"
                : restoring
                  ? "Engagements to grant again"
                  : "Engagement access"
          }
        />
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
/**
 * The engagements a membership form sends. A fresh grant lists them all
 * explicitly and nothing earlier is restored (F-24); an edit that keeps the
 * role sends only those ticked that the member did not already hold, which
 * the server adds to the kept grants.
 */
function engagementGrant(
  kind: string,
  choices: Record<string, string>,
  checks: Record<string, boolean>,
) {
  if (clientRole(choices.role)) return {};
  if (freshGrant(kind, choices))
    return { engagementIds: checkedEngagements(checks) };
  const held = new Set(flagged(checks, grantedFlag)),
    added = checkedEngagements(checks).filter((id) => !held.has(id));
  return added.length ? { engagementIds: added } : {};
}
const saveMember =
  (op: "grantMember" | "updateMember") =>
  ({ manage, choices, checks, values: v, kind }: ModalSubmitContext) =>
    manage(op, {
      userId: choices.userId || v.userId,
      displayName: v.displayName,
      role: choices.role,
      clientId: clientRole(choices.role) ? choices.clientId || null : null,
      ...engagementGrant(kind, choices, checks),
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
