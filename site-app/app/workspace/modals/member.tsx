"use client";
import { Input } from "@/components/ui/input";
import { roles } from "@/lib/domain";
import { Choice } from "../workspace-ui";
import type {
  ModalDefinition,
  ModalFieldsProps,
  ModalSubmitContext,
} from "./types";

const clientRole = (role: string) =>
  ["Client Viewer", "Client Contributor"].includes(role);

/** Member access, shared by the add-member and edit-access forms. */
function MemberFields({ kind, choices, choice, data }: ModalFieldsProps) {
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
            Ask your colleague to copy this from Members & access after signing
            in.
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
        <p className="subtle">
          Assign this member to specific engagements in Assurance workbench →
          Team & runtime.
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
  ({ manage, choices, values: v }: ModalSubmitContext) =>
    manage(op, {
      userId: choices.userId || v.userId,
      displayName: v.displayName,
      role: choices.role,
      clientId: choices.clientId || null,
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
