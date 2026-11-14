"use client";
// Evaluation setup, step 3 (Procedures): the protocol's name, its procedures,
// acceptance criteria and plan options, and the fairness declarations.
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { tests } from "@/lib/evaluation";
import type { Engagement, EvaluationConfig } from "@/lib/domain/types";
import type { PlanForm } from "@/lib/hosted-statistics";
import { specialCategoryGroupFloor } from "@/lib/special-category";
import { ProtocolDeclaration } from "../special-category";
import { Field, SelectField } from "./lab-ui";
import type { LabSetup } from "./use-lab-setup";

const wholeNumbers = [
  "minimumSampleSize",
  "minimumGroupSize",
  "minimumClassCount",
];

export function ProceduresStep({
  engagement: e,
  setup,
}: {
  engagement: Engagement;
  setup: LabSetup;
}) {
  const {
    draft,
    setDraft,
    config,
    planForm,
    locked,
    model,
    fair,
    cols,
    declaration,
    savedDeclaration,
  } = setup;
  function numeric(
    key: keyof EvaluationConfig,
    label: string,
    min: number,
    max: number,
    help?: string,
  ) {
    return (
      <Field key={key} label={label} help={help}>
        <Input
          type="number"
          min={min}
          max={max}
          step={wholeNumbers.includes(key) ? 1 : "any"}
          value={draft.config[key] ?? ""}
          onChange={(ev) => config(key, Number(ev.target.value))}
          required
          disabled={locked}
        />
      </Field>
    );
  }
  return (
    <>
      <div className="ml-form-grid">
        <Field label="Protocol name">
          <Input
            required
            disabled={locked}
            value={draft.name}
            onChange={(ev) => setDraft({ ...draft, name: ev.target.value })}
          />
        </Field>
        <Field label="Protocol version">
          <Input
            required
            disabled={locked}
            value={draft.version}
            onChange={(ev) => setDraft({ ...draft, version: ev.target.value })}
          />
        </Field>
      </div>
      <div className="ml-procedures">
        {tests
          .filter(
            (t) =>
              t.mode === "interactive" &&
              (t.tasks as readonly string[]).includes(draft.task),
          )
          .map((t) => (
            <label key={t.id}>
              <input
                type="checkbox"
                disabled={locked}
                checked={draft.suite.includes(t.id)}
                onChange={(ev) =>
                  setDraft({
                    ...draft,
                    suite: ev.target.checked
                      ? [...draft.suite, t.id]
                      : draft.suite.filter((x) => x !== t.id),
                  })
                }
              />
              <span>
                <b>{t.label}</b>
                <small className="block subtle">{t.requires}</small>
              </span>
            </label>
          ))}
      </div>
      <div className="ml-form-grid">
        {numeric(
          "minimumSampleSize",
          "Minimum total rows",
          30,
          10000,
          "At least 30, the platform floor.",
        )}
        {model?.task !== "Regression" &&
          numeric(
            "minimumClassCount",
            "Minimum rows per class-conditional denominator",
            10,
            1000,
            "At least 10, the platform floor.",
          )}
        <SelectField
          label="Confidence level"
          value={String(draft.plan.confidenceLevel)}
          disabled={locked}
          onChange={(v) =>
            planForm({
              confidenceLevel: Number(v || 0.95) as PlanForm["confidenceLevel"],
            })
          }
          options={[0.9, 0.95, 0.99].map((v) => ({
            value: String(v),
            label: `${v * 100}% intervals`,
          }))}
        />
        {draft.suite.includes("performance") && (
          <>
            {numeric("minimumAccuracy", "Minimum accuracy (0–1)", 0, 1)}
            {model?.task === "Binary classification" && (
              <Field
                label="Performance positive class"
                help="Recall is measured on this class and specificity on the other. Leave empty to use the favourable label."
              >
                <Input
                  disabled={locked}
                  placeholder={draft.config.positiveLabel}
                  value={draft.config.performancePositiveLabel ?? ""}
                  onChange={(ev) =>
                    config("performancePositiveLabel", ev.target.value)
                  }
                />
              </Field>
            )}
            {numeric(
              model?.task === "Binary classification"
                ? "minimumRecall"
                : "minimumMacroF1",
              model?.task === "Binary classification"
                ? "Minimum recall of the positive class"
                : "Minimum macro F1",
              0,
              1,
            )}
          </>
        )}
        {draft.suite.includes("regression") &&
          numeric(
            "maximumRmse",
            "Maximum RMSE",
            0.000000001,
            1e100,
            "In the target’s original units.",
          )}
      </div>
      {fair && (
        <>
          <SelectField
            label="Protected-group column"
            value={draft.config.groupColumn}
            disabled={locked}
            onChange={(v) => config("groupColumn", v)}
            options={cols}
          />
          <ProtocolDeclaration
            engagement={e}
            column={draft.config.groupColumn}
            value={declaration}
            onChange={setup.setDeclaration}
            saved={locked ? (savedDeclaration ?? null) : undefined}
          />
          <Field label="Reviewed basis for protected-data handling">
            <Textarea
              disabled={locked}
              required
              value={draft.datasetContext.sensitiveDataBasis}
              onChange={(ev) =>
                setDraft({
                  ...draft,
                  datasetContext: {
                    ...draft.datasetContext,
                    sensitiveDataBasis: ev.target.value,
                  },
                })
              }
            />
          </Field>
          <div className="ml-form-grid">
            {numeric(
              "minimumGroupSize",
              "Minimum rows per group",
              30,
              1000,
              "At least 30, the platform floor. Smaller groups are reported but never decide. A special-category group column needs at least " +
                specialCategoryGroupFloor +
                ".",
            )}
            <Field
              label="Minimum coverage (0.5–1)"
              help="Share of rows the eligible groups must cover for a pass."
            >
              <Input
                type="number"
                min={0.5}
                max={1}
                step="any"
                disabled={locked}
                value={draft.plan.minimumCoverage}
                onChange={(ev) =>
                  planForm({
                    minimumCoverage: Number(ev.target.value),
                  })
                }
              />
            </Field>
            {draft.suite.includes("demographic_parity") &&
              numeric(
                "maximumParityGap",
                "Maximum selection-rate gap (0–1)",
                0,
                1,
              )}
            {draft.suite.includes("disparate_impact") &&
              numeric(
                "minimumImpactRatio",
                "Minimum selection-rate ratio",
                0,
                1,
              )}
            {draft.suite.includes("disparate_impact") && (
              <SelectField
                label="Ratio threshold basis"
                value={draft.plan.impactBasis}
                disabled={locked}
                onChange={(v) =>
                  planForm({
                    impactBasis: (v ||
                      "policy.eu-aia.impact-ratio") as PlanForm["impactBasis"],
                  })
                }
                options={[
                  {
                    value: "policy.eu-aia.impact-ratio",
                    label: "Internal AI Act policy (no legal safe harbour)",
                  },
                  {
                    value: "screen.us.four-fifths",
                    label:
                      "US four-fifths screen (a heuristic, not a legal test)",
                  },
                ]}
              />
            )}
            {draft.suite.includes("equalized_odds") &&
              numeric("maximumOddsGap", "Maximum TPR / FPR gap (0–1)", 0, 1)}
          </div>
          {draft.plan.minimumCoverage < 1 && (
            <Field label="Why a coverage below 100% is acceptable">
              <Textarea
                disabled={locked}
                required
                value={draft.plan.coverageRationale}
                onChange={(ev) =>
                  planForm({ coverageRationale: ev.target.value })
                }
              />
            </Field>
          )}
        </>
      )}
      <Field
        label="Why these acceptance criteria are appropriate"
        help="Internal thresholds need context; they do not certify legal compliance."
      >
        <Textarea
          required
          disabled={locked}
          value={draft.rationale}
          onChange={(ev) => setDraft({ ...draft, rationale: ev.target.value })}
        />
      </Field>
    </>
  );
}
