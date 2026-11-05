"use client";
import { Textarea } from "@/components/ui/textarea";
import { finalReportGates } from "@/lib/domain";
import { AuditGateList } from "../../audit-gates";
import { Choice } from "../workspace-ui";
import type { ModalDefinition, ModalFieldsProps } from "./types";

function ReportFields({
  choices,
  choice,
  engagement: e,
  data,
  role,
}: ModalFieldsProps) {
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
      <label>
        Scoped opinion
        <Choice
          label="Opinion"
          value={choices.opinion}
          values={[
            "Readiness assessment",
            "Qualified conclusion",
            "Adverse conclusion",
            "Unable to conclude",
          ]}
          onChange={(v) => choice("opinion", v)}
        />
      </label>
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
            <span className="count-label">
              {finalReportGates(e, choices.opinion).length}
            </span>
          </h3>
          {choices.kind === "draft" && (
            <p className="subtle">
              A draft can capture the engagement while these requirements remain
              open.
            </p>
          )}
          <AuditGateList
            compact
            gates={finalReportGates(e, choices.opinion)}
            engagement={e}
            role={role}
            userId={data!.identity.id}
          />
          {choices.kind === "final" &&
            !!finalReportGates(e, choices.opinion).length && (
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
) =>
  choices.kind === "final" &&
  !!e &&
  !!finalReportGates(e, choices.opinion).length;
export const reportModal: ModalDefinition = {
  title: "Create immutable report snapshot",
  submitLabel: "Create snapshot",
  Fields: ReportFields,
  blocked: ({ choices, engagement }) => finalBlocked(choices, engagement),
  validate: ({ choices, engagement }) => {
    if (finalBlocked(choices, engagement))
      throw Error(
        "Resolve the final-report requirements or choose a draft snapshot.",
      );
  },
  submit: ({ act, choices, values: v }) =>
    act("createReport", {
      kind: choices.kind,
      opinion: choices.opinion,
      summary: v.summary,
    }),
};
