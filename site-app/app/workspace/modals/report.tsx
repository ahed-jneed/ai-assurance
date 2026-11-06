"use client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { finalReportGates, type FinalReport } from "@/lib/domain";
import {
  assuranceLevelIds,
  assuranceLevels,
  conclusionTypes,
  engagementTypeIds,
  engagementTypes,
  normalizeTerms,
  resolveParticulars,
  statesBasis,
  termsLabel,
  type PracticeReportSettings,
} from "@/lib/domain/report-model";
import { AuditGateList } from "../../audit-gates";
import { Choice } from "../workspace-ui";
import type { ModalDefinition, ModalFieldsProps } from "./types";

/** The report the form describes: valid terms and the stated particulars. */
function formReport(
  choices: Record<string, string>,
  settings: PracticeReportSettings | null | undefined,
): FinalReport {
  const terms = normalizeTerms({
    engagementType: choices.engagementType,
    assuranceLevel: choices.assuranceLevel || null,
    conclusion: choices.conclusion,
  });
  return {
    ...terms,
    // Blank fields fall back to the practice's report settings, as on the
    // server (resolveParticulars), so the gates check what will be printed.
    particulars: resolveParticulars(
      {
        addressee: choices.addressee ?? "",
        location: choices.location ?? "",
        signatory: choices.signatory ?? "",
        // Only a modified conclusion states a basis for the modification,
        // and only a readiness assessment with gaps describes its gaps.
        basisForModification: statesBasis(terms.conclusion)
          ? (choices.basisForModification ?? "")
          : "",
        qualityStatement: choices.qualityStatement ?? "",
      },
      settings ?? undefined,
    ),
  };
}

function ReportFields({
  choices,
  choice,
  engagement: e,
  data,
  role,
}: ModalFieldsProps) {
  const settings = data?.reportSettings,
    report = formReport(choices, settings),
    type = engagementTypes[report.engagementType],
    conclusion = conclusionTypes[report.conclusion],
    gates = e ? finalReportGates(e, report) : [];
  /** Changes one term and keeps the others valid for it. */
  const pick = (key: string, value: string) => {
    const t = normalizeTerms({ ...report, [key]: value });
    choice("engagementType", t.engagementType);
    choice("assuranceLevel", t.assuranceLevel ?? "");
    choice("conclusion", t.conclusion);
  };
  /**
   * A field the practice's report settings can fill: left blank, the report
   * states the setting, which the field shows as its placeholder.
   */
  const fromSettings = (key: "signatory" | "location" | "qualityStatement") =>
    settings?.[key]
      ? " Leave it blank to state the practice's report setting."
      : key === "qualityStatement"
        ? " Left blank, the report states the default shown."
        : "";
  const text = (
    key: "addressee" | "signatory" | "location",
    label: string,
    hint: string,
  ) => (
    <label>
      {label}
      <Input
        name={key}
        maxLength={300}
        value={choices[key] ?? ""}
        placeholder={
          key === "addressee" ? undefined : report.particulars?.[key]
        }
        onChange={(ev) => choice(key, ev.target.value)}
      />
      <small className="subtle">
        {hint}
        {key === "addressee" ? "" : fromSettings(key)}
      </small>
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
      <label>
        Independence and quality management statement
        <Textarea
          name="qualityStatement"
          maxLength={2000}
          value={choices.qualityStatement ?? ""}
          placeholder={report.particulars?.qualityStatement}
          onChange={(ev) => choice("qualityStatement", ev.target.value)}
        />
        <small className="subtle">
          The firm&apos;s ethical requirements and system of quality management
          as the report states them.{fromSettings("qualityStatement")}
        </small>
      </label>
      {statesBasis(report.conclusion) &&
        (report.conclusion === "readiness_gaps" ? (
          <label>
            Gaps identified
            <Textarea
              name="basisForModification"
              maxLength={5000}
              value={choices.basisForModification ?? ""}
              onChange={(ev) => choice("basisForModification", ev.target.value)}
            />
            <small className="subtle">
              Describe each gap against the criteria, such as an open High or
              Critical finding or an unsupported conclusion, and what remains to
              be addressed. The report states that it is not assurance and does
              not state readiness.
            </small>
          </label>
        ) : (
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
        ))}
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
const finalBlocked = ({
  choices,
  engagement: e,
  data,
}: Pick<ModalFieldsProps, "choices" | "engagement" | "data">) =>
  choices.kind === "final" &&
  !!e &&
  !!finalReportGates(e, formReport(choices, data?.reportSettings)).length;
export const reportModal: ModalDefinition = {
  title: "Create immutable report snapshot",
  submitLabel: "Create snapshot",
  Fields: ReportFields,
  blocked: finalBlocked,
  validate: (ctx) => {
    if (finalBlocked(ctx))
      throw Error(
        "Resolve the final-report requirements or choose a draft snapshot.",
      );
  },
  submit: ({ act, choices, values: v }) => {
    // The fields as entered: the server fills blank ones from the practice's
    // report settings as they are at capture.
    const { particulars, ...terms } = formReport(choices, null);
    return act("createReport", {
      kind: choices.kind,
      ...terms,
      addressee: particulars?.addressee ?? "",
      signatory: choices.signatory?.trim() ?? "",
      location: choices.location?.trim() ?? "",
      qualityStatement: choices.qualityStatement?.trim() ?? "",
      basisForModification: particulars?.basisForModification ?? "",
      summary: v.summary,
    });
  },
};
