"use client";
import type { ModalDefinition, ModalFieldsProps } from "./types";

function MemberRevokeFields({ choices }: ModalFieldsProps) {
  return (
    <p>
      Revoke <b>{choices.displayName}</b>&apos;s access to this practice? Their
      prior audit contributions and approvals will remain in the history.
    </p>
  );
}
export const memberRevokeModal: ModalDefinition = {
  title: "Revoke practice access",
  submitLabel: "Revoke access",
  Fields: MemberRevokeFields,
  submit: ({ manage, choices }) =>
    manage("revokeMember", { userId: choices.userId }),
};
