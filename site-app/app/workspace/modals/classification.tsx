"use client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  annexRoutes,
  assess,
  contradictions,
  derogationRoute,
  factAsked,
  factDefinitions,
  operatorRoles,
  type FactDefinition,
  type FactSection,
} from "@/lib/domain/classification";
import { legalDate } from "@/lib/rule-pack";
import { LegalReviewLabel } from "../views/rule-pack-views";
import { Choice } from "../workspace-ui";
import {
  classificationPayload,
  factChoice,
  formDraft,
  formRules,
} from "./classification-form";
import type { ModalDefinition, ModalFieldsProps } from "./types";

export { classificationDefaults } from "./classification-form";

const triState = [
  ["yes", "Yes"],
  ["no", "No"],
  ["unknown", "Needs information"],
] as const;

/** One fact answered yes, no or "needs information" (unknown). */
function TriState({
  def,
  value,
  onChange,
}: {
  def: FactDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="tri-state" role="radiogroup" aria-label={def.label}>
      <span className="tri-state-label">
        {def.label}
        {def.appliesFrom && (
          <small> Applies from {legalDate(def.appliesFrom)}.</small>
        )}
        {def.hint && <small> {def.hint}</small>}
        {def.legalReview?.length ? (
          <> {<LegalReviewLabel itemIds={[...def.legalReview]} />}</>
        ) : null}
      </span>
      <span className="tri-state-options">
        {triState.map(([v, text]) => (
          <label key={v}>
            <input
              type="radio"
              name={factChoice(def.id)}
              value={v}
              checked={(value || "unknown") === v}
              onChange={() => onChange(v)}
            />
            {text}
          </label>
        ))}
      </span>
    </div>
  );
}

const sections: [FactSection, string][] = [
  ["art5", "Prohibited practices (Art 5)"],
  ["gpai", "General-purpose AI and the AI Office"],
  ["organisation", "Organisation"],
  ["art50Provider", "Transparency: provider duties (Art 50(1) and (2))"],
  ["art50Deployer", "Transparency: deployer duties (Art 50(3) and (4))"],
  ["art50Shared", "Transparency: exceptions for either role"],
  ["dates", "Dates and legacy-system facts"],
];

function ClassificationFields({
  choices,
  choice,
  data,
  engagement: e,
}: ModalFieldsProps) {
  const rules = formRules(data?.catalog),
    { draft, facts } = formDraft(choices),
    answers = e?.classification.answers ?? {},
    asked = factDefinitions(rules).filter((d) => factAsked(d, draft, facts)),
    art6 = rules.guidance.find(
      (g) => g.id === "GUID-ART6-HIGH-RISK-CLASSIFICATION",
    ),
    derived = assess(draft, rules),
    problems = contradictions(draft, rules);
  const fact = (def: FactDefinition) => {
    if (def.kind === "date")
      return (
        <label key={def.id}>
          {def.label}
          {def.hint && <small className="subtle"> {def.hint}</small>}
          {def.legalReview?.length ? (
            <> {<LegalReviewLabel itemIds={[...def.legalReview]} />}</>
          ) : null}
          <Input
            type="date"
            name={"date:" + def.id}
            defaultValue={
              typeof answers[def.id]?.value === "string"
                ? (answers[def.id].value as string)
                : ""
            }
          />
        </label>
      );
    if (def.kind === "enumeration")
      return (
        <label key={def.id}>
          {def.label}
          <Choice
            label={def.label}
            value={choices[factChoice(def.id)] || "unknown"}
            values={[
              ...(def.values ?? []),
              { value: "unknown", label: "Needs information" },
            ]}
            onChange={(v) => choice(factChoice(def.id), v)}
          />
        </label>
      );
    const value = choices[factChoice(def.id)] || "unknown";
    return (
      <div key={def.id} className="tri-state-group">
        <TriState
          def={def}
          value={value}
          onChange={(v) => choice(factChoice(def.id), v)}
        />
        {value === "yes" && def.exception && (
          <label className="tri-state-detail">
            Evidence the exception rests on (evidence id, document or link)
            <Input
              name={"evidence:" + def.id}
              defaultValue={answers[def.id]?.evidence}
              maxLength={500}
            />
          </label>
        )}
        {value === "yes" && def.checkedOn && (
          <label className="tri-state-detail">
            Signatory list checked on
            <Input
              type="date"
              name={"checkedOn:" + def.id}
              defaultValue={answers[def.id]?.checkedOn}
            />
          </label>
        )}
      </div>
    );
  };
  return (
    <>
      <fieldset className="classification-section">
        <legend>Purpose and operator role</legend>
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
            values={[...operatorRoles]}
            onChange={(v) => choice("operatorRole", v)}
          />
        </label>
      </fieldset>
      <fieldset className="classification-section">
        <legend>High-risk route (Art 6)</legend>
        <label>
          Classification route
          <Choice
            label="Annex route"
            value={choices.annexRoute}
            values={[...annexRoutes]}
            onChange={(v) => choice("annexRoute", v)}
          />
        </label>
        {asked.filter((d) => d.section === "route").map(fact)}
        {draft.annexRoute === derogationRoute &&
          choices[factChoice("art6_3Derogation")] === "yes" && (
            <>
              <label>
                Art 6(3) derogation rationale
                <Textarea
                  name="derogationRationale"
                  defaultValue={e?.classification.derogation?.rationale}
                />
              </label>
              <label>
                Registration evidence (Art 49(2))
                <Input
                  name="registrationEvidence"
                  defaultValue={
                    e?.classification.derogation?.registrationEvidence
                  }
                  maxLength={500}
                />
              </label>
            </>
          )}
        {art6 && (
          <p className="subtle">
            Cites {art6.title} ({art6.status}
            {art6.date ? ", " + legalDate(art6.date) : ""}). A re-review is
            raised when the final guidelines are adopted.
          </p>
        )}
      </fieldset>
      {sections.map(([section, title]) => {
        const defs = asked.filter((d) => d.section === section);
        return defs.length ? (
          <fieldset className="classification-section" key={section}>
            <legend>{title}</legend>
            {defs.map(fact)}
          </fieldset>
        ) : null;
      })}
      <label>
        Legal rationale, facts, exceptions & transition analysis
        <Textarea
          name="rationale"
          defaultValue={e?.classification.rationale}
          required
        />
      </label>
      <div className="classification-derived" aria-live="polite">
        <p>
          <b>Derived now:</b> {derived.label}
          {derived.needsInformation.length
            ? " · " +
              derived.needsInformation.length +
              " facts need information"
            : ""}
        </p>
        {problems.map((p) => (
          <p className="form-error" key={p}>
            {p}
          </p>
        ))}
      </div>
      <p className="subtle">
        Unanswered facts are recorded as unknown and block the independent
        approval. Guidance used:{" "}
        {rules.guidance.map((g) => g.reference).join("; ") ||
          "no rule pack guidance"}
        . This guided record supports legal review; it does not decide the
        applicability of every prohibition, exception or sector regime.
      </p>
    </>
  );
}
export const classificationModal: ModalDefinition = {
  title: "Guided regulatory classification",
  submitLabel: "Save classification",
  Fields: ClassificationFields,
  validate: ({ choices, data }) => {
    const problems = contradictions(
      formDraft(choices).draft,
      formRules(data?.catalog),
    );
    if (problems.length) throw new Error(problems.join("; "));
  },
  submit: ({ act, choices, data, values }) =>
    act(
      "classify",
      classificationPayload(formRules(data?.catalog), choices, values),
    ),
};
