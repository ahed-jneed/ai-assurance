"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { Engagement } from "@/lib/domain";
import { Choice } from "../workspace-ui";
import type { ModalDefinition, ModalFieldsProps } from "./types";

/** The form starts from the engagement's current classification. */
export function classificationDefaults(e: Engagement | null | undefined): {
  choices: Record<string, string>;
  checks: Record<string, boolean>;
} {
  return {
    choices: {
      operatorRole: e?.classification.operatorRole ?? "Provider",
      annexRoute: e?.classification.annexRoute ?? "Unassessed",
    },
    checks: e
      ? {
          prohibited: e.classification.prohibited,
          highRisk: e.classification.highRisk,
          transparency: e.classification.transparency,
          profiling: e.classification.profiling,
        }
      : {},
  };
}
function ClassificationFields({
  choices,
  choice,
  checks,
  check,
  engagement: e,
}: ModalFieldsProps) {
  return (
    <>
      <label>
        Intended purpose & deployment context
        <Textarea
          name="intendedPurpose"
          defaultValue={e?.classification.intendedPurpose}
          required
        />
      </label>
      <label>
        Operator role
        <Choice
          label="Operator role"
          value={choices.operatorRole}
          values={[
            "Provider",
            "Deployer",
            "Provider and deployer",
            "Importer / distributor",
          ]}
          onChange={(v) => choice("operatorRole", v)}
        />
      </label>
      {[
        ["prohibited", "Article 5 prohibited practice identified"],
        ["highRisk", "High-risk route identified under Article 6"],
        ["transparency", "Article 50 transparency duties apply separately"],
        ["profiling", "Annex III use involves profiling of natural persons"],
      ].map(([key, label]) => (
        <label className="check-row" key={key}>
          <Checkbox
            checked={!!checks[key]}
            onCheckedChange={(v) => check(key, !!v)}
          />
          {label}
        </label>
      ))}
      <label>
        Classification route
        <Choice
          label="Annex route"
          value={choices.annexRoute}
          values={[
            "Unassessed",
            "Annex III — sensitive use case",
            "Annex I Section A — regulated product",
            "Annex I Section B — sector-specific review",
            "Article 6(3) exception assessment",
            "Article 50 only",
            "Outside high-risk scope",
          ]}
          onChange={(v) => choice("annexRoute", v)}
        />
      </label>
      <label>
        Legal rationale, facts, exceptions & transition analysis
        <Textarea
          name="rationale"
          defaultValue={e?.classification.rationale}
          required
        />
      </label>
      <p className="subtle">
        This guided record supports legal review. It does not automatically
        determine the applicability of every prohibition, exception or sector
        regime.
      </p>
    </>
  );
}
export const classificationModal: ModalDefinition = {
  title: "Guided regulatory classification",
  submitLabel: "Save classification",
  Fields: ClassificationFields,
  submit: ({ act, checks, choices, values: v }) =>
    act("classify", {
      prohibited: !!checks.prohibited,
      highRisk: !!checks.highRisk,
      transparency: !!checks.transparency,
      profiling: !!checks.profiling,
      annexRoute: choices.annexRoute,
      operatorRole: choices.operatorRole,
      intendedPurpose: v.intendedPurpose,
      rationale: v.rationale,
    }),
};
