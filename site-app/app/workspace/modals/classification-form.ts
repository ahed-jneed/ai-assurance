// The guided classification form's state (#19): tri-state and enumeration
// answers live in the form's choices as "fact:<id>", dates, evidence links
// and the Art 6(3) record in its named fields. Only the facts the form asks
// for the chosen role, route and answers are submitted; the rest are unknown.
import { classificationRules } from "@/lib/classification-rules";
import {
  annexRoutes,
  classificationFactValues,
  factAsked,
  factDefinitions,
  type Answer,
  type ClassificationInput,
  type ClassificationRules,
} from "@/lib/domain/classification";
import type { Engagement } from "@/lib/domain/types";
import { asRulePack } from "@/lib/rule-pack";

export const factChoice = (id: string) => "fact:" + id;

/** The rules of the catalog the workspace API sent. */
export function formRules(catalog: unknown): ClassificationRules {
  return classificationRules(
    asRulePack(
      (catalog as { regulatorySnapshot?: unknown } | null | undefined)
        ?.regulatorySnapshot,
    ),
  );
}

/** The form opens with the engagement's current classification. */
export function classificationDefaults(e: Engagement | null | undefined): {
  choices: Record<string, string>;
  checks: Record<string, boolean>;
} {
  const c = e?.classification;
  const choices: Record<string, string> = {
    operatorRole: c?.operatorRole ?? "Provider",
    annexRoute:
      c && (annexRoutes as readonly string[]).includes(c.annexRoute)
        ? c.annexRoute
        : "Unassessed",
  };
  for (const [id, a] of Object.entries(c?.answers ?? {}))
    if (typeof a.value === "boolean")
      choices[factChoice(id)] = a.value ? "yes" : "no";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(a.value))
      choices[factChoice(id)] = a.value;
  return { choices, checks: {} };
}

/** The classification the form's choices describe, for what it asks next. */
export function formDraft(choices: Record<string, string>) {
  const answers: Record<string, Answer> = {};
  for (const [key, v] of Object.entries(choices)) {
    if (!key.startsWith("fact:") || !v || v === "unknown") continue;
    answers[key.slice(5)] = {
      value: v === "yes" ? true : v === "no" ? false : v,
    } as Answer;
  }
  const draft = {
    operatorRole: choices.operatorRole ?? "Provider",
    annexRoute: choices.annexRoute ?? "Unassessed",
    answers,
    status: "provisional" as const,
  };
  return { draft, facts: classificationFactValues(draft) };
}

/** The classify payload: every asked fact, its evidence and the derogation. */
export function classificationPayload(
  rules: ClassificationRules,
  choices: Record<string, string>,
  values: Record<string, string>,
): ClassificationInput {
  const { draft, facts } = formDraft(choices),
    out: ClassificationInput = {
      operatorRole: draft.operatorRole,
      annexRoute: draft.annexRoute,
      intendedPurpose: values.intendedPurpose ?? "",
      rationale: values.rationale ?? "",
      facts: {},
      evidence: {},
      checkedOn: {},
    };
  for (const def of factDefinitions(rules)) {
    if (!factAsked(def, draft, facts)) continue;
    if (def.kind === "date") {
      out.facts[def.id] = (values["date:" + def.id] ?? "").trim();
      continue;
    }
    const v = choices[factChoice(def.id)] || "unknown";
    out.facts[def.id] = v;
    if (v !== "yes") continue;
    if (def.exception)
      out.evidence![def.id] = values["evidence:" + def.id] ?? "";
    if (def.checkedOn)
      out.checkedOn![def.id] = values["checkedOn:" + def.id] ?? "";
  }
  if (draft.answers.art6_3Derogation?.value === true)
    out.derogation = {
      rationale: values.derogationRationale ?? "",
      registrationEvidence: values.registrationEvidence ?? "",
    };
  return out;
}
