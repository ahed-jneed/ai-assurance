"use client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { finalReportGates, type FinalReport } from "@/lib/domain";
import { packFeatures } from "../../workspace-types";
import {
  assuranceLevelIds,
  assuranceLevels,
  conclusionTypes,
  engagementTypeIds,
  engagementTypes,
  normalizeTerms,
  termsLabel,
} from "@/lib/domain/report-model";
import { AuditGateList } from "../../audit-gates";
import { Choice } from "../workspace-ui";
import type { ModalDefinition, ModalFieldsProps } from "./types";

/** The report the form describes: valid terms and the stated particulars. */
function formReport(choices: Record<string, string>): FinalReport {
  const terms = normalizeTerms({
    engagementType: choices.engagementType,
    assuranceLevel: choices.assuranceLevel || null,
    conclusion: choices.conclusion,
  });
  return {
    ...terms,
    particulars: {
      addressee: choices.addressee ?? "",
      location: choices.location ?? "",
      signatory: choices.signatory ?? "",
      // Only a modified conclusion states a basis for the modification.
      basisForModification: conclusionTypes[terms.conclusion].modified
        ? (choices.basisForModification ?? "")
        : "",
    },
  };
}

function ReportFields({
  choices,
  choice,
  engagement: e,
  data,
  role,
}: ModalFieldsProps) {
  const report = formReport(choices),
    type = engagementTypes[report.engagementType],
    conclusion = conclusionTypes[report.conclusion],
    gates = e ? finalReportGates(e, report, packFeatures(data)) : [];
  /** Changes one term and keeps the others valid for it. */
  const pick = (key: string, value: string) => {
    const t = normalizeTerms({ ...report, [key]: value });
    choice("engagementType", t.engagementType);
    choice("assuranceLevel", t.assuranceLevel ?? "");
    choice("conclusion", t.conclusion);
  };
  const text = (key: string, label: string, hint?: string) => (
    <label>
      {label}
      <Input
        name={key}
        maxLength={300}
        value={choices[key] ?? ""}
        onChange={(ev) => choice(key, ev.target.value)}
      />
      {hint && <small className="subtle">{hint}</small>}
    </label>
  );
  return (
    <>
      <label>
        Package type
        <Choice
          label="Package kind"
          value={choices.kind}
          values={[
            { value: "draft", label: "Draft — review snapshot" },
            {
              value: "final",
              label: "Final — subject to completion gates",
            },
          ]}
          onChange={(v) => choice("kind", v)}
        />
      </label>
      <div className="report-terms">
        <label>
          Engagement type
          <Choice
            label="Engagement type"
            value={report.engagementType}
            values={engagementTypeIds.map((t) => ({
              value: t,
              label: engagementTypes[t].label,
            }))}
            onChange={(v) => pick("engagementType", v)}
          />
        </label>
        <label>
          Assurance level
          <Choice
            label="Assurance level"
            disabled={!type.assurance}
            value={report.assuranceLevel ?? "none"}
            values={
              type.assurance
                ? assuranceLevelIds.map((l) => ({
                    value: l,
                    label: assuranceLevels[l].label,
                  }))
                : [{ value: "none", label: "Not applicable" }]
            }
            onChange={(v) => pick("assuranceLevel", v)}
          />
        </label>
        <label>
          Conclusion
          <Choice
            label="Conclusion"
            value={report.conclusion}
            values={type.conclusions.map((c) => ({
              value: c,
              label: conclusionTypes[c].label,
            }))}
            onChange={(v) => pick("conclusion", v)}
          />
        </label>
        <p className="report-terms-guidance">
          <b>{termsLabel(report)}.</b> {conclusion.guidance}
          {!type.assurance &&
            " The report is labelled as not providing assurance."}
        </p>
      </div>
      {text("addressee", "Addressee", "Who the report is addressed to.")}
      {text(
        "signatory",
        "Signed by",
        "The practitioner or firm signing the report.",
      )}
      {text(
        "location",
        "Location",
        "Where the practitioner practises, e.g. Vienna, Austria.",
      )}
      {conclusion.modified && (
        <label>
          Basis for {termsLabel(report).split(" · ")[0].toLowerCase()}
          <Textarea
            name="basisForModification"
            maxLength={5000}
            value={choices.basisForModification ?? ""}
            onChange={(ev) => choice("basisForModification", ev.target.value)}
          />
          <small className="subtle">
            Describe the matter and why its effects are material
            {report.conclusion === "qualified"
              ? " but not pervasive"
              : report.conclusion === "adverse"
                ? " and pervasive"
                : ", or why the evidence that could not be obtained is pervasive"}
            .
          </small>
        </label>
      )}
      <label>
        Executive summary, scope & limitations
        <Textarea name="summary" required maxLength={5000} />
      </label>
      {e && (
        <section className="report-form-readiness">
          <h3>
            {choices.kind === "final"
              ? "Before final issuance"
              : "Outstanding at capture"}{" "}
            <span className="count-label">{gates.length}</span>
          </h3>
          {choices.kind === "draft" && (
            <p className="subtle">
              A draft can capture the engagement while these requirements remain
              open.
            </p>
          )}
          <AuditGateList
            compact
            gates={gates}
            engagement={e}
            role={role}
            userId={data!.identity.id}
          />
          {choices.kind === "final" && !!gates.length && (
            <p className="form-error">
              Resolve these requirements, or select a draft snapshot.
            </p>
          )}
        </section>
      )}
      <p className="subtle">
        The snapshot is fixed when created. A later report becomes a new package
        with a new digest.
      </p>
    </>
  );
}
/** A final snapshot is refused while completion gates remain open. */
const finalBlocked = (
  choices: Record<string, string>,
  e: ModalFieldsProps["engagement"],
  data: ModalFieldsProps["data"],
) =>
  choices.kind === "final" &&
  !!e &&
  !!finalReportGates(e, formReport(choices), packFeatures(data)).length;
export const reportModal: ModalDefinition = {
  title: "Create immutable report snapshot",
  submitLabel: "Create snapshot",
  Fields: ReportFields,
  blocked: ({ choices, engagement, data }) =>
    finalBlocked(choices, engagement, data),
  validate: ({ choices, engagement, data }) => {
    if (finalBlocked(choices, engagement, data))
      throw Error(
        "Resolve the final-report requirements or choose a draft snapshot.",
      );
  },
  submit: ({ act, choices, values: v }) => {
    const { particulars, ...terms } = formReport(choices);
    return act("createReport", {
      kind: choices.kind,
      ...terms,
      ...particulars,
      summary: v.summary,
    });
  },
};
