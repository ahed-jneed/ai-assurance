"use client";
import { Input } from "@/components/ui/input";
import type { ModalDefinition, ModalFieldsProps } from "./types";

/** Client details, shared by the new-client and edit-client forms. */
function ClientFields({ choices }: ModalFieldsProps) {
  return (
    <>
      <label>
        Client name
        <Input
          name="name"
          defaultValue={choices.name}
          required
          maxLength={300}
        />
      </label>
      <label>
        Sector
        <Input
          name="sector"
          defaultValue={choices.sector}
          required
          maxLength={300}
        />
      </label>
    </>
  );
}
export const clientModal: ModalDefinition = {
  title: "New client",
  submitLabel: "Create client",
  Fields: ClientFields,
  submit: async ({ manage, values: v, followUps }) => {
    const result = await manage("createClient", {
      name: v.name,
      sector: v.sector,
    });
    followUps.showClient(result.details.clientId);
  },
};
export const clientEditModal: ModalDefinition = {
  title: "Edit client",
  submitLabel: "Save client details",
  Fields: ClientFields,
  submit: ({ manage, values: v, choices }) =>
    manage("updateClient", {
      clientId: choices.clientId,
      name: v.name,
      sector: v.sector,
    }),
};
