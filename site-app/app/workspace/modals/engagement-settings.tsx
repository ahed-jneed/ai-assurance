"use client";
import { Input } from "@/components/ui/input";
import type { ModalDefinition, ModalFieldsProps } from "./types";

function EngagementSettingsFields({ engagement: e }: ModalFieldsProps) {
  return (
    <>
      <label>
        Title
        <Input name="title" defaultValue={e?.title} required maxLength={300} />
      </label>
      <label>
        Target completion
        <Input name="dueDate" type="date" defaultValue={e?.dueDate} />
      </label>
    </>
  );
}
/** Renames the engagement and sets its target date (form "rename"). */
export const engagementSettingsModal: ModalDefinition = {
  title: "Engagement settings",
  submitLabel: "Save engagement",
  Fields: EngagementSettingsFields,
  submit: ({ act, values: v }) =>
    act("renameEngagement", { title: v.title, dueDate: v.dueDate }),
};
