// Field builders shared by the audit program's forms.
import type { Engagement } from "@/lib/domain/types";
import type { Field, Option } from "./workflow-dialog";
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/([A-Z])/g, " $1");
export const options = (items: string[]) =>
  items.map((value) => ({ value, label: label(value) }));
export const area = (
  name: string,
  title: string,
  value = "",
  optional = false,
): Field => ({ name, label: title, value, type: "area", optional });
export const choice = (
  name: string,
  title: string,
  opts: Option[],
  value = "",
  optional = false,
): Field => ({
  name,
  label: title,
  options: opts,
  value,
  type: "select",
  optional,
});
export const reason = () => [area("reason", "Review decision and rationale")];
export const checklistOptions: Option[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "not_applicable", label: "Not applicable" },
];
export const evidence = (e: Engagement, ids: string[] = []): Field => ({
  name: "evidenceIds",
  label: "Accepted supporting evidence",
  type: "checklist",
  options: e.artifacts
    .filter((a) => a.status === "accepted")
    .map((a) => ({ value: a.id, label: a.name + " · " + a.category })),
  ids,
  hint: "File acceptance and evidential sufficiency are separate decisions.",
});
