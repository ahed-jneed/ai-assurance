"use client";
import { Input } from "@/components/ui/input";
import { Choice } from "../workspace-ui";
import type { ModalDefinition, ModalFieldsProps } from "./types";

function EngagementFields({ choices, choice, data }: ModalFieldsProps) {
  return (
    <>
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
      <label>
        Engagement title
        <Input name="title" required maxLength={300} />
      </label>
    </>
  );
}
export const engagementModal: ModalDefinition = {
  title: "New engagement",
  submitLabel: "Create engagement",
  Fields: EngagementFields,
  validate: ({ choices }) => {
    if (!choices.clientId) throw Error("Choose a client for this engagement.");
  },
  submit: async ({ manage, load, data, values: v, choices, followUps }) => {
    const result = await manage("createEngagement", {
      clientId: choices.clientId,
      title: v.title,
    });
    if (result.details?.engagementId) {
      await load(data!.tenantId, result.details.engagementId);
      followUps.showEngagementOverview();
    }
  },
};
