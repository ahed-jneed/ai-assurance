import type { CriterionOption, ObligationOptions } from "@/lib/criteria/types";
import {
  label,
  obligationOptionLabel,
  type Engagement,
  type Field,
  type FieldOption,
} from "./types";

/** What the form fields offer as options, derived from the workbench state. */
export type FieldContext = {
  engagement: Engagement;
  // The pinned AI Act framework's subitems, when the pack assesses them.
  obligations: ObligationOptions | undefined;
  requirements: CriterionOption[] | undefined;
  lead: boolean;
  artifactOptions: (category?: string) => FieldOption[];
  models: FieldOption[];
  profiles: FieldOption[];
  procedures: FieldOption[];
  // The loaded records of a kind (system, prediction) as options.
  options: (kind: string) => FieldOption[];
  members: FieldOption[];
  workers: FieldOption[];
  activeJobs: FieldOption[];
};

/** The fields of the obligation, briefing, evidence, sample and impact forms. */
export function assessmentFields({
  engagement: e,
  obligations,
  requirements,
  artifactOptions,
  procedures,
}: FieldContext): Record<string, Field[]> {
  return {
    obligationDecision: [
      {
        name: "code",
        label: "Obligation subitem",
        options: (obligations?.items ?? []).map((o) => ({
          value: o.code,
          label: obligationOptionLabel(o),
        })),
        required: true,
      },
      {
        name: "actor",
        label: "Reviewed operator role",
        options: [
          "Provider",
          "Deployer",
          "Importer",
          "Distributor",
          "Authorised representative",
        ].map((x) => ({ value: x, label: x })),
        required: true,
      },
      {
        name: "applicability",
        label: "Applicability decision",
        options: [
          "applicable",
          "readiness",
          "not_applicable",
          "needs_information",
        ].map((x) => ({ value: x, label: label(x) })),
        required: true,
      },
      {
        name: "rationale",
        label: "Actor, trigger facts and scope rationale",
        multiline: true,
        required: true,
      },
      {
        name: "periodAnalysis",
        label: "Application date, transitional and sector analysis",
        multiline: true,
        required: true,
      },
      {
        name: "evidenceId",
        label: "Accepted supporting evidence",
        options: artifactOptions(),
      },
      {
        name: "assessment",
        label: "Evidence sufficiency and unresolved gaps",
        multiline: true,
        required: true,
      },
      {
        name: "outcome",
        label: "Proposed assessment",
        options: ["unassessed", "supported", "qualified", "unsupported"].map(
          (x) => ({ value: x, label: label(x) }),
        ),
        required: true,
      },
    ],

    exportBriefing: [
      {
        name: "processingDestination",
        label: "Approved processing destination identity",
        required: true,
        help: "Must match the independently approved provider configuration. Export does not send data to the provider.",
      },
      {
        name: "governanceArtifactId",
        label: "Accepted processing / privacy decision",
        options: artifactOptions("Governance"),
        required: true,
      },
      {
        name: "reason",
        label: "Scope, data minimization and export rationale",
        multiline: true,
        required: true,
      },
    ],

    importBriefing: [
      {
        name: "artifactId",
        label: "Accepted cited briefing JSON",
        options: artifactOptions().filter((x) =>
          x.label.toLowerCase().endsWith(".json"),
        ),
        required: true,
      },
      {
        name: "assessment",
        label: "Origin and citation assessment",
        multiline: true,
        required: true,
      },
    ],

    addLocation: [
      {
        name: "artifactId",
        label: "Accepted source",
        options: artifactOptions(),
        required: true,
      },
      { name: "label", label: "Location title", required: true },
      {
        name: "kind",
        label: "Source type",
        options: ["document", "table", "code", "log", "dataset"].map((x) => ({
          value: x,
          label: label(x),
        })),
        required: true,
      },
      {
        name: "locator",
        label: "Exact location",
        help: "For example: page 12, paragraph 3; commit/path/lines; row IDs; UTC log interval.",
        required: true,
      },
      {
        name: "excerpt",
        label: "Source observation / exact excerpt",
        multiline: true,
        required: true,
      },
      {
        name: "quality",
        label: "Extraction quality and limitations",
        multiline: true,
        required: true,
      },
    ],

    addAssertion: [
      {
        name: "statement",
        label: "Claimed fact",
        multiline: true,
        required: true,
      },
      {
        name: "criterion",
        label: obligations ? "Criterion / obligation subitem" : "Criterion",
        options: obligations
          ? obligations.items.map((o) => ({
              value: o.code,
              label: obligationOptionLabel(o),
            }))
          : (requirements ?? []).map((r) => ({
              value: r.reference,
              label: r.citation + (r.title ? " · " + r.title : ""),
            })),
        required: true,
      },
      {
        name: "procedureId",
        label: "Actual audit procedure",
        options: procedures,
      },
      {
        name: "paperId",
        label: "Working paper",
        options: e.papers.map((p) => ({
          value: p.id,
          label: p.templateId + " · " + p.title,
        })),
      },
      {
        name: "missingEvidence",
        label: "Missing support / unresolved evidence",
        multiline: true,
      },
      {
        name: "assessment",
        label: "Auditor judgment of sufficiency and contradictions",
        multiline: true,
        required: true,
      },
      {
        name: "conclusion",
        label: "Proposed assessment",
        options: ["unassessed", "supported", "qualified", "unsupported"].map(
          (x) => ({ value: x, label: label(x) }),
        ),
        required: true,
      },
    ],

    sample: [
      {
        name: "procedureId",
        label: "Related audit procedure",
        options: procedures,
      },
      {
        name: "datasetId",
        label: "Accepted population snapshot",
        options: artifactOptions("Dataset"),
        required: true,
      },
      { name: "idColumn", label: "Unique record-ID column", required: true },
      {
        name: "method",
        label: "Sampling method",
        options: [
          { value: "simple_random", label: "Simple random" },
          { value: "stratified", label: "Stratified — size per stratum" },
        ],
        required: true,
      },
      { name: "stratumColumn", label: "Stratum column (stratified only)" },
      {
        name: "size",
        label: "Requested sample size",
        type: "number",
        initial: "30",
        required: true,
      },
      {
        name: "seed",
        label: "Reproducible seed",
        type: "number",
        initial: "42",
        required: true,
      },
      {
        name: "rationale",
        label: "Population completeness, suitability and sampling rationale",
        multiline: true,
        required: true,
      },
    ],

    impact: [
      {
        name: "sourceType",
        label: "Change type",
        options: [
          "system",
          "legal_source",
          "evidence",
          "protocol",
          "operational_change",
        ].map((x) => ({ value: x, label: label(x) })),
        required: true,
      },
      {
        name: "previousId",
        label: "Previous source / revision",
        required: true,
      },
      { name: "newId", label: "New source / revision", required: true },
      {
        name: "description",
        label: "What changed",
        multiline: true,
        required: true,
      },
      {
        name: "assessment",
        label: "Affected claims, risks and audit work",
        multiline: true,
        required: true,
      },
      {
        name: "decision",
        label: "Proposed action",
        options: ["review_required", "retest_required", "no_effect"].map(
          (x) => ({ value: x, label: label(x) }),
        ),
        required: true,
      },
      {
        name: "reason",
        label: "Decision rationale",
        multiline: true,
        required: true,
      },
    ],
  };
}
