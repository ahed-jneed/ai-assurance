// The NYC Local Law 144 bias audit of an engagement (#30): the auditor maps
// an accepted dataset's columns, attests the data source (6 RCNY 5-302) and
// that no demographic category was inferred or imputed (DCWP FAQ), and the
// platform computes the DCWP tables (lib/ll144.ts). A reviewer other than the
// preparer approves the audit; a final report captures the publishable
// summary of every approved audit in both snapshots, so a client reads it
// only from a released report (report model v2, lib/client-projection.ts).
//
// The legal reading here is the methodology's, pending the qualified legal
// review tracked in #57 (D-02); docs/research/ll144-2026-11.md lists the
// points (LR-LL144-01 to LR-LL144-08).
import { z } from "./zod";
import { calendarDate } from "./dataset-card";
import { parseCSV } from "./diagnostics";
import type { Engagement } from "./domain/types";
import { ApiError } from "./http";
import {
  Ll144Error,
  ll144Audit,
  type Ll144Dimension,
  type Ll144Exclusion,
  type Ll144Record,
  type Ll144Result,
} from "./ll144";
import { basisFor, basisSummary, specialColumns } from "./special-category";
import type { CriterionInterval } from "./statistics";

/** EEO-1 Component 1 categories, in the order of the DCWP examples (5-300 "category"). */
export const EEO1_SEX = ["Male", "Female"];
export const EEO1_RACE_ETHNICITY = [
  "Hispanic or Latino",
  "White",
  "Black or African American",
  "Native Hawaiian or Pacific Islander",
  "Asian",
  "Native American or Alaska Native",
  "Two or More Races",
];
export const ll144LegalReview = "pending";
export const LL144_LAW =
  "NYC Local Law 144 of 2021 (NYC Administrative Code §§ 20-870 to 20-874) and the DCWP rules, 6 RCNY §§ 5-300 to 5-304";
/** 1.1 (#144): the classification group of a per-group run. */
export const ll144SummaryVersion = "1.1";

const dataSourceSchema = z
  .object({
    kind: z.enum(["historical", "test"]),
    /** 5-303(a)(1): the source and explanation of the data. */
    source: z.string().trim().min(1).max(2000),
    explanation: z.string().trim().min(1).max(5000),
    /** 5-302(b): why historical data was not used, and how the test data was generated and obtained. */
    whyNotHistorical: z.string().trim().max(5000).optional(),
    testDataGeneration: z.string().trim().max(5000).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.kind === "test" && !d.whyNotHistorical)
      ctx.addIssue({
        code: "custom",
        path: ["whyNotHistorical"],
        message:
          "Explain why historical data was not used (6 RCNY 5-302(b)): test data is allowed only when historical data is insufficient for a statistically significant audit",
      });
    if (d.kind === "test" && !d.testDataGeneration)
      ctx.addIssue({
        code: "custom",
        path: ["testDataGeneration"],
        message:
          "Explain how the test data was generated and obtained (6 RCNY 5-302(b))",
      });
    if (d.kind === "historical" && (d.whyNotHistorical || d.testDataGeneration))
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: "Test-data explanations apply only to test data",
      });
  });

export const ll144InputSchema = z
  .object({
    datasetId: z.string().trim().min(1).max(300),
    toolName: z.string().trim().min(1).max(300),
    /** 5-300: the date the employer or employment agency began using the AEDT. */
    distributionDate: calendarDate,
    /** The date of this bias audit; the summary states it (5-303(a)(1)). */
    auditDate: calendarDate,
    rate: z.enum(["selection", "scoring"]),
    sexColumn: z.string().trim().min(1).max(300),
    raceEthnicityColumn: z.string().trim().min(1).max(300),
    /** Selection: the outcome column and the values that mean selected or classified. */
    outcomeColumn: z.string().trim().max(300).optional(),
    selectedValues: z
      .array(z.string().trim().min(1).max(300))
      .max(20)
      .optional(),
    /**
     * Selection by a tool that classifies individuals into several groups
     * (6 RCNY 5-301(b)(4)): the outcome values that are its groups. Each
     * group gets its own audit, in which "selected" means classified into
     * that group (#144). Replaces selectedValues.
     */
    classificationGroups: z
      .array(z.string().trim().min(1).max(300))
      .min(2)
      .max(20)
      .optional(),
    /** Scoring: the score column. */
    scoreColumn: z.string().trim().max(300).optional(),
    /** Cell values that mean the individual's category is unknown. */
    unknownValues: z
      .array(z.string().trim().min(1).max(300))
      .max(20)
      .default([]),
    exclusions: z
      .array(
        z
          .object({
            dimension: z.enum(["sex", "raceEthnicity", "intersectional"]),
            category: z.string().min(1).max(700),
            justification: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    dataSource: dataSourceSchema,
    /** DCWP FAQ: imputed or inferred demographic data cannot be used. */
    demographicsNotInferred: z.literal(true, {
      error:
        "Confirm that every sex and race/ethnicity value was reported by the individual and none was inferred or imputed: DCWP does not allow inferred or imputed data in a bias audit",
    }),
    demographicsStatement: z.string().trim().min(1).max(2000),
    /** Required when a mapped column holds special-category data. */
    acknowledgeHostedProcessing: z.boolean().default(false),
  })
  .strict()
  .superRefine((d, ctx) => {
    const groups = d.classificationGroups;
    if (!groups) return;
    if (d.rate !== "selection")
      ctx.addIssue({
        code: "custom",
        path: ["classificationGroups"],
        message:
          "Classification groups apply to selection rates: a tool that classifies individuals into groups is audited by the share classified into each group",
      });
    if (d.selectedValues?.length)
      ctx.addIssue({
        code: "custom",
        path: ["selectedValues"],
        message:
          "List either the values meaning selected or the classification groups, not both",
      });
    if (new Set(groups).size !== groups.length)
      ctx.addIssue({
        code: "custom",
        path: ["classificationGroups"],
        message: "Each classification group is listed once",
      });
  });
export type Ll144AuditInput = z.infer<typeof ll144InputSchema>;
/** One group of a per-group run (6 RCNY 5-301(b)(4), #144). */
export type Ll144Classification = {
  /** Shared by the audits of one run. */
  runId: string;
  /** The group whose share this audit computes. */
  group: string;
  /** Every group of the run, in the order given. */
  groups: string[];
};

export type Ll144Audit = {
  id: string;
  status: "draft" | "approved";
  createdAt: string;
  createdBy: string;
  approvedAt?: string;
  approvedBy?: string;
  toolName: string;
  distributionDate: string;
  auditDate: string;
  dataSource: z.infer<typeof dataSourceSchema>;
  demographicsStatement: string;
  dataset: { artifactId: string; name: string; sha256: string; rows: number };
  mapping: {
    rate: "selection" | "scoring";
    sexColumn: string;
    raceEthnicityColumn: string;
    outcomeColumn?: string;
    selectedValues?: string[];
    scoreColumn?: string;
    unknownValues: string[];
  };
  exclusions: Ll144Exclusion[];
  /** Set on each audit of a per-group run (6 RCNY 5-301(b)(4)). */
  classification?: Ll144Classification;
  /** Values that are not EEO-1 categories: the reviewer checks the mapping. */
  warnings: string[];
  /** The special-category processing the platform recorded, if any. */
  limitations: string[];
  result: Ll144Result;
};

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** The individual records of an LL144 audit from the dataset rows and the auditor's mapping. */
export function ll144Records(
  rows: Record<string, string>[],
  a: Pick<
    Ll144AuditInput,
    | "rate"
    | "sexColumn"
    | "raceEthnicityColumn"
    | "outcomeColumn"
    | "selectedValues"
    | "scoreColumn"
    | "unknownValues"
  >,
): Ll144Record[] {
  const outcome = a.rate === "selection" ? a.outcomeColumn : a.scoreColumn;
  if (!outcome)
    throw new ApiError(
      400,
      a.rate === "selection"
        ? "Map the outcome column and the values that mean selected"
        : "Map the score column",
    );
  if (a.rate === "selection" && !a.selectedValues?.length)
    throw new ApiError(
      400,
      "List the outcome values that mean selected or classified",
    );
  const columns = [a.sexColumn, a.raceEthnicityColumn, outcome];
  if (new Set(columns).size !== 3)
    throw new ApiError(400, "Mapped columns must be distinct");
  if (!rows.length) throw new ApiError(400, "The dataset has no rows");
  for (const c of columns)
    if (!(c in rows[0]))
      throw new ApiError(400, "Required column missing: " + c);
  const unknown = new Set(a.unknownValues.map((v) => v.toLowerCase()));
  const category = (v: string) => {
    const t = v.trim();
    return !t || unknown.has(t.toLowerCase()) ? null : t;
  };
  const selected = new Set(a.selectedValues ?? []);
  return rows.map((r, i) => {
    const cell = (r[outcome] ?? "").trim();
    const base = {
      sex: category(r[a.sexColumn] ?? ""),
      raceEthnicity: category(r[a.raceEthnicityColumn] ?? ""),
    };
    if (!cell)
      throw new ApiError(
        400,
        `Row ${i + 2} has no ${a.rate === "selection" ? "outcome" : "score"}; every assessed individual needs one`,
      );
    if (a.rate === "selection")
      return { ...base, selected: selected.has(cell) };
    if (!NUMBER.test(cell) || !Number.isFinite(Number(cell)))
      throw new ApiError(400, `Row ${i + 2} score is not a number`);
    return { ...base, score: Number(cell) };
  });
}

/** Values the mapping found that are not EEO-1 categories. */
function categoryWarnings(result: Ll144Result) {
  const out: string[] = [];
  const check = (dimension: Ll144Dimension, known: string[]) => {
    const table = result.tables.find((t) => t.dimension === dimension)!;
    const other = table.categories
      .map((c) => c.category)
      .filter((c) => !known.includes(c));
    if (other.length)
      out.push(
        (dimension === "sex" ? "Sex" : "Race/ethnicity") +
          " values that are not EEO-1 categories: " +
          other.slice(0, 10).join(", ") +
          ". Map them to EEO-1 categories, or list them as unknown values.",
      );
  };
  check("sex", EEO1_SEX);
  check("raceEthnicity", EEO1_RACE_ETHNICITY);
  return out;
}

/**
 * Computes a draft LL144 audit from an accepted dataset's CSV. Mapped
 * columns that hold special-category data need the client's recorded basis
 * and the auditor's acknowledgement of processing on the platform.
 */
export function computeAudit(
  e: Engagement,
  a: Ll144AuditInput,
  dataset: { id: string; name: string; sha256: string },
  csv: string,
  ids: { id: string; actor: string; at: string },
  classification?: Ll144Classification,
): Ll144Audit {
  if (classification) a = { ...a, selectedValues: [classification.group] };
  else if (a.classificationGroups)
    throw new ApiError(
      400,
      "Compute a per-group run with computeClassificationAudits",
    );
  if (a.auditDate > ids.at.slice(0, 10))
    throw new ApiError(400, "The audit date cannot be in the future");
  let rows: Record<string, string>[];
  try {
    rows = parseCSV(csv, { blankRows: "reject" });
  } catch (error) {
    throw new ApiError(400, (error as Error).message);
  }
  const mapped = [a.sexColumn, a.raceEthnicityColumn];
  const special = specialColumns(mapped, e);
  const limitations: string[] = [];
  for (const s of special) {
    const basis = basisFor(e, s.column);
    if (!basis)
      throw new ApiError(
        409,
        "Column " +
          s.column +
          " may hold special-category data. Record the client's basis for it before computing on the platform, or compute the tables in the client's environment with python -m engine.ll144.",
      );
    limitations.push(
      "Special-category column " +
        s.column +
        " was processed on the platform under " +
        basisSummary(basis) +
        ".",
    );
  }
  if (special.length && !a.acknowledgeHostedProcessing)
    throw new ApiError(
      409,
      "Acknowledge that this audit processes special-category column " +
        special.map((s) => s.column).join(", ") +
        " on the platform under the recorded basis",
    );
  const records = ll144Records(rows, a);
  let result: Ll144Result;
  try {
    result = ll144Audit({
      rate: a.rate,
      records,
      categories: { sex: EEO1_SEX, raceEthnicity: EEO1_RACE_ETHNICITY },
      exclusions: a.exclusions,
    });
  } catch (error) {
    if (error instanceof Ll144Error) throw new ApiError(400, error.message);
    throw error;
  }
  return {
    id: ids.id,
    status: "draft",
    createdAt: ids.at,
    createdBy: ids.actor,
    toolName: a.toolName,
    distributionDate: a.distributionDate,
    auditDate: a.auditDate,
    dataSource: a.dataSource,
    demographicsStatement: a.demographicsStatement,
    dataset: {
      artifactId: dataset.id,
      name: dataset.name,
      sha256: dataset.sha256,
      rows: rows.length,
    },
    mapping: {
      rate: a.rate,
      sexColumn: a.sexColumn,
      raceEthnicityColumn: a.raceEthnicityColumn,
      ...(a.rate === "selection"
        ? { outcomeColumn: a.outcomeColumn, selectedValues: a.selectedValues }
        : { scoreColumn: a.scoreColumn }),
      unknownValues: a.unknownValues,
    },
    exclusions: a.exclusions,
    ...(classification ? { classification } : {}),
    warnings: [
      ...(a.rate === "selection" && !records.some((r) => r.selected)
        ? [
            classification
              ? `No individual was classified into group ${classification.group}: check the value against the ${a.outcomeColumn} column.`
              : `No individual has an outcome value meaning selected: check the values against the ${a.outcomeColumn} column.`,
          ]
        : []),
      ...categoryWarnings(result),
    ],
    limitations,
    result,
  };
}

/**
 * The audits of a tool that classifies individuals into several groups
 * (6 RCNY 5-301(b)(4), #144): one per group, in the order given, each
 * computing the share of every category classified into its group. They
 * share a run id and are approved one by one, like any audit.
 */
export function computeClassificationAudits(
  e: Engagement,
  a: Ll144AuditInput & { classificationGroups: string[] },
  dataset: { id: string; name: string; sha256: string },
  csv: string,
  ids: { id: () => string; runId: string; actor: string; at: string },
): Ll144Audit[] {
  const groups = a.classificationGroups;
  return groups.map((group) =>
    computeAudit(
      e,
      a,
      dataset,
      csv,
      { id: ids.id(), actor: ids.actor, at: ids.at },
      { runId: ids.runId, group, groups },
    ),
  );
}

/**
 * The per-group runs some of whose audits are approved and others not
 * (#144). A final report captures every approved audit, so it would carry
 * the summaries of only some groups of such a run: an incomplete
 * 6 RCNY 5-301(b)(4) bias audit. Runs with no approved audit are not
 * captured at all and are not listed.
 */
export function incompleteLl144Runs(
  audits: readonly Pick<Ll144Audit, "status" | "classification">[],
): { runId: string; approved: number; groups: number }[] {
  const runs = new Map<string, { approved: number; total: number }>();
  for (const a of audits) {
    if (!a.classification) continue;
    const run = runs.get(a.classification.runId) ?? { approved: 0, total: 0 };
    run.total += 1;
    if (a.status === "approved") run.approved += 1;
    runs.set(a.classification.runId, run);
  }
  return [...runs]
    .filter(([, r]) => r.approved > 0 && r.approved < r.total)
    .map(([runId, r]) => ({ runId, approved: r.approved, groups: r.total }));
}

/** Why final capture waits for an incomplete per-group run (#144). */
export const incompleteRunMessage = (r: {
  runId: string;
  approved: number;
  groups: number;
}) =>
  `Approve every group of LL144 run ${r.runId} before final capture (${r.approved} of ${r.groups} approved): a report carries the bias audit of every classification group (6 RCNY 5-301(b)(4))`;

/** One year after the audit date: the tool may not be used after it without a new audit (5-301(a)). */
export function oneYearAfter(auditDate: string) {
  const d = new Date(auditDate + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

const DIMENSION_LABELS: Record<Ll144Dimension, string> = {
  sex: "Sex categories",
  raceEthnicity: "Race/ethnicity categories",
  intersectional: "Intersectional categories (sex and race/ethnicity)",
};

/**
 * The publishable summary of an audit (6 RCNY 5-303): the fields the rule
 * requires, with the supplementary intervals marked as such. It carries no
 * user id, no dataset key and no row data, so it may be captured into the
 * client snapshot of a report and posted by the employer.
 */
export function publishableSummary(audit: Ll144Audit) {
  const r = audit.result;
  const rateName = r.rate === "selection" ? "selectionRate" : "scoringRate";
  const countName = r.rate === "selection" ? "selected" : "scoredAboveMedian";
  const tables = r.tables.map((t) => ({
    dimension: t.dimension,
    title: DIMENSION_LABELS[t.dimension],
    referenceCategory: t.referenceCategory,
    unknownCategoryCount: t.unknownCategoryCount,
    notes: t.notes,
    categories: t.categories.map((c) => ({
      category: c.category,
      components: c.components,
      n: c.n,
      [countName]: c[countName] as number,
      rate: c[rateName] as number | null,
      impactRatio: c.impactRatio,
      excluded: c.excluded,
      exclusionJustification: c.exclusionJustification,
      shareOfData: c.shareOfData,
      supplementary: {
        rateInterval: (c[rateName + "Interval"] ??
          null) as CriterionInterval | null,
        impactRatioInterval: c.impactRatioInterval,
      },
    })),
  }));
  const unknown = Object.fromEntries(
    r.tables.map((t) => [t.dimension, t.unknownCategoryCount]),
  ) as Record<Ll144Dimension, number>;
  const excluded = tables.flatMap((t) =>
    t.categories
      .filter((c) => c.excluded)
      .map((c) => ({
        dimension: t.dimension,
        category: c.category,
        justification: c.exclusionJustification,
        n: c.n,
        rate: c.rate,
      })),
  );
  const until = oneYearAfter(audit.auditDate);
  const dataText =
    audit.dataSource.kind === "historical"
      ? "Historical data"
      : "Test data (historical data was not used)";
  return {
    summaryVersion: ll144SummaryVersion,
    law: LL144_LAW,
    legalReview: ll144LegalReview,
    status: audit.status,
    auditId: audit.id,
    ...(audit.approvedAt ? { approvedOn: audit.approvedAt.slice(0, 10) } : {}),
    tool: { name: audit.toolName, distributionDate: audit.distributionDate },
    auditDate: audit.auditDate,
    useAllowedUntil: until,
    rate: r.rate,
    ...(audit.classification
      ? {
          classification: {
            rule: "6 RCNY § 5-301(b)(4)",
            group: audit.classification.group,
            groups: audit.classification.groups,
          },
        }
      : {}),
    medianScore: r.medianScore,
    numberOfApplicants: r.totalIndividuals,
    unknownCategoryCounts: unknown,
    dataSource: {
      kind: audit.dataSource.kind,
      source: audit.dataSource.source,
      explanation: audit.dataSource.explanation,
      ...(audit.dataSource.kind === "test"
        ? {
            whyHistoricalDataWasNotUsed: audit.dataSource.whyNotHistorical,
            howTestDataWasGeneratedAndObtained:
              audit.dataSource.testDataGeneration,
          }
        : {}),
    },
    demographicData: audit.demographicsStatement,
    tables,
    exclusions: excluded,
    /** The elements 6 RCNY 5-303 requires, each with where the summary gives it. */
    requiredElements: [
      {
        rule: "6 RCNY § 5-303(a)(1)",
        element: "Date of the most recent bias audit",
        value: audit.auditDate,
      },
      {
        rule: "6 RCNY § 5-303(a)(1)",
        element: "Source and explanation of the data used",
        value:
          dataText +
          ": " +
          audit.dataSource.source +
          (audit.dataSource.kind === "test"
            ? " Why historical data was not used: " +
              audit.dataSource.whyNotHistorical +
              " How the test data was generated and obtained: " +
              audit.dataSource.testDataGeneration
            : ""),
      },
      {
        rule: "6 RCNY § 5-303(a)(1)",
        element: "Number of individuals assessed",
        value: String(r.totalIndividuals),
      },
      {
        rule: "6 RCNY §§ 5-301(b)(5), (c)(5), 5-303(a)(1)",
        element: "Number of individuals in an unknown category",
        value: `sex ${unknown.sex}; race/ethnicity ${unknown.raceEthnicity}; intersectional ${unknown.intersectional}`,
      },
      ...(audit.classification
        ? [
            {
              rule: "6 RCNY § 5-301(b)(4)",
              element: "Classification group these rates are calculated for",
              value: `${audit.classification.group} (one of ${audit.classification.groups.length} groups: ${audit.classification.groups.join(", ")})`,
            },
          ]
        : []),
      {
        rule: "6 RCNY §§ 5-301, 5-303(a)(1)",
        element:
          (r.rate === "selection" ? "Selection" : "Scoring") +
          " rates and impact ratios for all categories",
        value: "tables",
      },
      ...(excluded.length
        ? [
            {
              rule: "6 RCNY § 5-301(d)",
              element:
                "Excluded categories: justification, number of applicants and rate",
              value: "exclusions",
            },
          ]
        : []),
      {
        rule: "6 RCNY § 5-303(a)(2)",
        element: "Distribution date of the AEDT",
        value: audit.distributionDate,
      },
    ],
    notes: [
      ...(audit.classification
        ? [
            `The tool classifies individuals into ${audit.classification.groups.length} groups, so the rates are calculated for each group (6 RCNY § 5-301(b)(4)). In this summary a category's selection rate is the share of its individuals classified into ${audit.classification.group}; each other group has its own summary.`,
          ]
        : []),
      "Impact ratios compare each category's rate with the highest rate among the categories not excluded. NYC Local Law 144 requires these figures to be published; it sets no pass or fail threshold.",
      ...(r.rate === "scoring"
        ? [
            `The median score (${r.medianScore}) is taken over every scored individual, including those in an unknown category (6 RCNY § 5-301(c)(1)); a scoring rate counts the scores strictly above it.`,
          ]
        : []),
      r.intervalNote,
      `The tool may not be used after ${until} unless a new bias audit has been done (6 RCNY § 5-301(a)).`,
      "The employer keeps this summary and the distribution date posted for at least six months after the tool's latest use for an employment decision (6 RCNY § 5-303(c)).",
      "This reading of the rules is pending qualified legal review.",
    ],
  };
}
export type Ll144Summary = ReturnType<typeof publishableSummary>;
