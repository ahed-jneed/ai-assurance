// Special categories of personal data in fairness testing (#60, decision
// D-11). The client's basis for processing such data, under AI Act Art 4a
// or another GDPR Art 9(2) ground, is recorded before the data reach the
// platform, declared with each fairness protocol and frozen with each run.
// Client-side computation is the default route; a hosted run also needs the
// auditor's explicit acknowledgement.
//
// The Art 4a reading behind this gate is pending legal review (LR-06): on its
// face, condition (d) bars access by other parties, so Art 4a alone may not
// let a client hand such data to an external auditor's platform.
import { z } from "zod";
import { calendarDate } from "./dataset-card";
import type { Artifact, Engagement, EvaluationProfile, Run } from "./domain";
import { fairnessSelected } from "./evaluation";
import { ApiError } from "./http";

/** The legal-review item the Art 4a reading waits on (#57). */
export const art4aLegalReview = "LR-06";

/**
 * The Art 4a(1) conditions, each under our own short title. The OJ text
 * governs; the rule pack carries the structured paraphrase.
 */
export const art4aConditions = [
  {
    point: "a",
    title: "Other data, including synthetic or anonymised data, would not work",
  },
  {
    point: "b",
    title: "Limits on re-use; state-of-the-art security and pseudonymisation",
  },
  {
    point: "c",
    title:
      "Strict, documented access by authorised persons under confidentiality",
  },
  {
    point: "d",
    title: "Not transmitted to, transferred to or accessed by other parties",
  },
  { point: "e", title: "Deleted once the bias is corrected or retention ends" },
  {
    point: "f",
    title: "Records of processing state why it was strictly necessary",
  },
] as const;
/** The extra Art 4a(2) condition; paragraph 2 also applies all of the above. */
export const art4aParagraph2Condition = {
  point: "2a",
  title: "Strictly necessary in view of likely harmful or discriminatory bias",
} as const;
/** The GDPR Art 9(2) grounds, each under our own short title. */
export const gdprArt9Grounds = [
  { point: "a", title: "Explicit consent of the data subject" },
  { point: "b", title: "Employment, social security or social protection law" },
  { point: "c", title: "Vital interests where consent cannot be given" },
  {
    point: "d",
    title: "Not-for-profit body with a political, religious or union aim",
  },
  { point: "e", title: "Data manifestly made public by the data subject" },
  {
    point: "f",
    title: "Legal claims, or courts acting in their judicial capacity",
  },
  {
    point: "g",
    title: "Substantial public interest under Union or Member State law",
  },
  {
    point: "h",
    title: "Preventive or occupational medicine, health or social care",
  },
  { point: "i", title: "Public interest in the area of public health" },
  {
    point: "j",
    title: "Archiving, scientific or historical research, or statistics",
  },
] as const;

/** The condition points an Art 4a basis must address, one statement each. */
export function art4aPoints(paragraph: "1" | "2"): string[] {
  return [
    ...(paragraph === "2" ? [art4aParagraph2Condition.point] : []),
    ...art4aConditions.map((c) => c.point),
  ];
}

const statement = z.string().trim().min(1).max(2000),
  person = z.string().trim().min(1).max(300),
  column = z.string().trim().min(1).max(300),
  common = {
    /** The dataset columns the basis covers. */
    columns: z.array(column).min(1).max(20),
    /** Who at the client confirmed the basis: name and role. */
    confirmedBy: person,
    confirmedOn: calendarDate,
  };
export const basisInputSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("art4a"),
        paragraph: z.enum(["1", "2"]),
        /** The client's statement for each condition point, keyed by point. */
        conditions: z.record(statement),
        ...common,
      })
      .strict(),
    z
      .object({
        kind: z.literal("gdpr_art9"),
        point: z.enum(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]),
        statement,
        ...common,
      })
      .strict(),
  ])
  .superRefine((v, issue) => {
    if (v.kind !== "art4a") return;
    const required = art4aPoints(v.paragraph),
      given = Object.keys(v.conditions);
    for (const point of required)
      if (!given.includes(point))
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conditions", point],
          message: "Record the client's statement for condition " + point,
        });
    for (const point of given)
      if (!required.includes(point))
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conditions", point],
          message: "Art 4a(" + v.paragraph + ") has no condition " + point,
        });
  });
export type SpecialCategoryBasisInput = z.infer<typeof basisInputSchema>;
/** A recorded basis, as the engagement holds it and runs freeze it. */
export type SpecialCategoryBasis = SpecialCategoryBasisInput & {
  id: string;
  recordedBy: string;
  recordedAt: string;
};

/** What the auditor declares about a fairness protocol's group column. */
export const declarationInputSchema = z
  .object({
    /** The group column holds special-category data. Defaults to true. */
    specialCategory: z.boolean().default(true),
    /** Where the fairness tests run; client-side unless chosen otherwise. */
    route: z.enum(["client_side", "hosted"]).default("client_side"),
    /** A recorded basis covering the group column. */
    basisId: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type SpecialCategoryDeclarationInput = z.input<
  typeof declarationInputSchema
>;
/** The declaration as a protocol stores it, with a copy of its basis. */
export type SpecialCategoryDeclaration = {
  column: string;
  specialCategory: boolean;
  route: "client_side" | "hosted";
  basis: SpecialCategoryBasis | null;
  declaredBy: string;
  declaredAt: string;
};

/** Who acknowledged hosted processing of special-category data, and when. */
export type SpecialCategoryAcknowledgement = {
  column: string;
  acknowledgedBy: string;
  acknowledgedAt: string;
  /** A retry carries over the acknowledgement of this source run. */
  inheritedFrom?: string;
};

/** A column name compared without case, spacing or punctuation. */
export function normalizeColumn(name: string) {
  return name
    .normalize("NFKC")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1_$2")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}
// Words naming GDPR Art 9(1) categories. A column whose name contains one is
// treated as special-category until the uploader records a basis or declares
// that it holds no special-category personal data.
const categoryWords = new Set([
  "race",
  "racial",
  "ethnic",
  "ethnicity",
  "religion",
  "religious",
  "belief",
  "beliefs",
  "faith",
  "political",
  "politics",
  "genetic",
  "genome",
  "biometric",
  "health",
  "medical",
  "diagnosis",
  "disability",
  "disabled",
  "sexuality",
  "sexual",
  "pregnancy",
  "pregnant",
]);
const categoryPhrases = ["trade_union", "sex_life"];
/** The column's name suggests a GDPR Art 9(1) category. */
export function namesSpecialCategory(name: string) {
  const n = normalizeColumn(name);
  return (
    n.split("_").some((w) => categoryWords.has(w)) ||
    categoryPhrases.some((p) => ("_" + n + "_").includes("_" + p + "_"))
  );
}
/** The protocol's group column counts as special-category data. */
export function groupColumnIsSpecial(
  profile: Pick<EvaluationProfile, "suite" | "config" | "specialCategory">,
) {
  return (
    fairnessSelected(profile.suite) &&
    !!profile.config.groupColumn &&
    // Protocols saved before declarations existed count as special-category.
    (profile.specialCategory?.specialCategory ?? true)
  );
}
/** The latest recorded basis that covers `column`. */
export function basisFor(
  e: Pick<Engagement, "specialCategoryBases">,
  column: string,
) {
  const n = normalizeColumn(column);
  return (e.specialCategoryBases ?? [])
    .filter((b) => b.columns.some((c) => normalizeColumn(c) === n))
    .at(-1);
}
export type SpecialColumn = {
  column: string;
  why: ("category_name" | "protocol_group_column" | "recorded_basis")[];
  basisId?: string;
};
/**
 * The columns of `headers` that hold, or may hold, special-category data: a
 * column covered by a recorded basis, the group column of a protocol that
 * declares it special-category, or a column whose name suggests an Art 9(1)
 * category. Each carries the basis that covers it, if one is recorded.
 */
export function specialColumns(
  headers: readonly string[],
  e: Pick<Engagement, "specialCategoryBases" | "evaluationProfiles">,
): SpecialColumn[] {
  const groupColumns = new Set(
    (e.evaluationProfiles ?? [])
      .filter(groupColumnIsSpecial)
      .map((p) => normalizeColumn(p.config.groupColumn)),
  );
  return headers.flatMap((column): SpecialColumn[] => {
    const basis = basisFor(e, column),
      why: SpecialColumn["why"] = [
        ...(basis ? (["recorded_basis"] as const) : []),
        ...(groupColumns.has(normalizeColumn(column))
          ? (["protocol_group_column"] as const)
          : []),
        ...(namesSpecialCategory(column) ? (["category_name"] as const) : []),
      ];
    return why.length ? [{ column, why, basisId: basis?.id }] : [];
  });
}

/** The header row of a CSV, or null when the bytes do not start with one. */
export function csvHeader(text: string): string[] | null {
  const cells: string[] = [];
  let cell = "",
    quoted = false,
    i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === ",") {
      cells.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") break;
    else cell += c;
  }
  if (quoted) return null;
  cells.push(cell);
  const names = cells.map((c) => c.trim());
  return names.some(Boolean) ? names.filter(Boolean) : null;
}
/** Bytes read from the start of an upload to find its header row. */
export const headerScanBytes = 64 * 1024;
// Windows-1252 code points of bytes 0x80-0x9F. The other bytes match
// Latin-1; the five unassigned ones keep their C1 code point.
const cp1252High = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030,
  0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d,
  0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e,
  0x178,
];
function fromCodes(codes: ArrayLike<number>) {
  let text = "";
  for (let i = 0; i < codes.length; i += 8192)
    text += String.fromCharCode(
      ...Array.prototype.slice.call(codes, i, i + 8192),
    );
  return text;
}
/**
 * The text of an upload's first bytes, for finding its header row: UTF-16
 * when a byte order mark says so (Excel's "Unicode Text"), UTF-8 when the
 * bytes are valid UTF-8, and Windows-1252 otherwise (Excel's "CSV (Comma
 * delimited)" on Western-European systems). Decoded by hand, so the result
 * does not depend on the legacy encodings the runtime's TextDecoder knows.
 */
export function headerText(bytes: ArrayBuffer) {
  const b = new Uint8Array(bytes.slice(0, headerScanBytes));
  if (b[0] === 0xff && b[1] === 0xfe)
    return fromCodes(
      new Uint16Array(b.length >> 1)
        .map((_, i) => b[2 * i] | (b[2 * i + 1] << 8))
        .subarray(1),
    );
  if (b[0] === 0xfe && b[1] === 0xff)
    return fromCodes(
      new Uint16Array(b.length >> 1)
        .map((_, i) => (b[2 * i] << 8) | b[2 * i + 1])
        .subarray(1),
    );
  try {
    // `stream` tolerates a multi-byte character cut at the scan limit.
    return new TextDecoder("utf-8", { fatal: true }).decode(b, {
      stream: true,
    });
  } catch {
    return fromCodes(
      Array.from(b, (c) => (c >= 0x80 && c <= 0x9f ? cp1252High[c - 0x80] : c)),
    );
  }
}
/**
 * The header of an upload whose first bytes are text, whatever its name or
 * encoding: the external worker reads every Dataset as CSV, so a file
 * without a .csv extension is inspected too, and a file that is not UTF-8
 * still brings its columns onto the platform although no run can read it.
 * Tab-separated when the name says so, or when the first line holds tabs
 * and no commas. Null for binary formats (Parquet, spreadsheets), which
 * cannot be inspected.
 */
export function uploadHeader(name: string, bytes: ArrayBuffer) {
  const text = headerText(bytes);
  if (!text || text.includes("\u0000")) return null;
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  return /\.tsv$/i.test(name) || (first.includes("\t") && !first.includes(","))
    ? first
        .split("\t")
        .map((c) => c.trim())
        .filter(Boolean)
    : csvHeader(text);
}
/**
 * The upload gate: a Dataset upload whose header holds special-category
 * columns needs the client's recorded basis for each of them, unless the
 * uploader declares that the columns hold no special-category personal data
 * (synthetic, anonymised or aggregate evidence only). Returns the audit
 * details to record, or null when no such column is present.
 */
export function uploadGate(
  e: Pick<Engagement, "specialCategoryBases" | "evaluationProfiles">,
  upload: {
    category: string;
    headers: readonly string[] | null;
    handlingBasis: string;
    /**
     * "not_personal": the uploader's declaration for uncovered columns; null
     * where the uploader cannot declare (client submissions).
     */
    declaration: string | null;
  },
) {
  if (upload.category !== "Dataset" || !upload.headers) return null;
  const found = specialColumns(upload.headers, e);
  if (!found.length) return null;
  const uncovered = found.filter((c) => !c.basisId);
  if (uncovered.length) {
    if (upload.declaration !== "not_personal")
      throw new ApiError(
        409,
        "Special-category data needs the client's recorded basis before upload: " +
          uncovered.map((c) => c.column).join(", ") +
          (upload.declaration === null
            ? ". Ask the audit team to record your Art 4a or GDPR Art 9(2) basis for these columns first, or compute the fairness tests in your own environment and send only the approved aggregates."
            : ". Record the client's Art 4a or GDPR Art 9(2) basis for these columns, or run the fairness tests client-side and upload only the approved aggregates. If the columns hold no special-category personal data, declare that with a synthetic or anonymised handling basis."),
      );
    if (!["synthetic", "anonymized"].includes(upload.handlingBasis))
      throw new ApiError(
        400,
        "Only synthetic or anonymised evidence can be declared free of special-category personal data",
      );
  }
  return {
    columns: found.map((c) => c.column),
    bases: [...new Set(found.flatMap((c) => c.basisId ?? []))],
    ...(uncovered.length
      ? {
          declaredNotPersonal: uncovered.map((c) => c.column),
          declaration: "not_personal",
        }
      : {}),
  };
}

/**
 * The declaration a fairness protocol stores: the group column, whether it
 * is special-category, the route its tests take and a copy of the basis.
 */
export function declareProtocol(
  e: Pick<Engagement, "specialCategoryBases">,
  profile: Pick<EvaluationProfile, "suite" | "config">,
  input: SpecialCategoryDeclarationInput | undefined,
  actor: string,
  at: string,
): SpecialCategoryDeclaration | undefined {
  if (!fairnessSelected(profile.suite) || !profile.config.groupColumn) {
    if (input)
      throw new ApiError(
        400,
        "Declare special-category data only for a fairness protocol's group column",
      );
    return undefined;
  }
  const v = declarationInputSchema.parse(input ?? {}),
    column = profile.config.groupColumn;
  let basis: SpecialCategoryBasis | null = null;
  if (v.basisId) {
    const found = (e.specialCategoryBases ?? []).find(
      (b) => b.id === v.basisId,
    );
    if (
      !found ||
      !found.columns.some((c) => normalizeColumn(c) === normalizeColumn(column))
    )
      throw new ApiError(
        400,
        "Choose a recorded basis that covers the group column " + column,
      );
    basis = structuredClone(found);
  }
  if (v.specialCategory && v.route === "hosted" && !basis)
    throw new ApiError(
      400,
      "A hosted fairness protocol on special-category column " +
        column +
        " needs the client's recorded Art 4a or GDPR Art 9(2) basis. Record it, or keep the client-side route.",
    );
  return {
    column,
    specialCategory: v.specialCategory,
    route: v.route,
    basis,
    declaredBy: actor,
    declaredAt: at,
  };
}

/** One line naming the basis: its provision, who confirmed it and when. */
export function basisSummary(b: SpecialCategoryBasis) {
  return (
    (b.kind === "art4a"
      ? "AI Act Art 4a(" +
        b.paragraph +
        ") conditions " +
        art4aPoints(b.paragraph)
          .map((p) => "(" + p.replace(/^2/, "") + ")")
          .join(", ") +
        " recorded point by point (Art 4a reading pending legal review, " +
        art4aLegalReview +
        ")"
      : "GDPR Art 9(2)(" +
        b.point +
        "): " +
        (gdprArt9Grounds.find((g) => g.point === b.point)?.title ?? "")) +
    "; confirmed by " +
    b.confirmedBy +
    " on " +
    b.confirmedOn +
    "; basis " +
    b.id
  );
}

/**
 * Refuses a hosted run of a fairness protocol on special-category data
 * unless the protocol takes the hosted route with a recorded basis and the
 * auditor acknowledges hosted processing. Returns the limitation the run
 * freezes, or null when the gate does not apply.
 */
export function hostedGate(
  profile: EvaluationProfile | null,
  frozen: Pick<EvaluationProfile, "suite" | "config">,
  acknowledged: boolean,
) {
  // A legacy explicit run (retried without a protocol) has no declaration,
  // so its group column counts as special-category like an old protocol.
  if (!groupColumnIsSpecial(profile ?? frozen)) return null;
  const d = profile?.specialCategory,
    column = (profile ?? frozen).config.groupColumn;
  if (!d)
    throw new ApiError(
      409,
      (profile
        ? "This fairness protocol predates special-category declarations. Create a new protocol version"
        : "This explicit fairness run predates special-category declarations. Save a fairness protocol") +
        " that declares whether " +
        column +
        " is special-category data.",
    );
  if (d.route !== "hosted" || !d.basis)
    throw new ApiError(
      409,
      "Special-category fairness tests on " +
        column +
        " run client-side by default: queue them for the external worker or the runtime package, which return approved aggregates. A hosted run needs a protocol version on the hosted route with the client's recorded basis.",
    );
  if (!acknowledged)
    throw new ApiError(
      409,
      "Acknowledge that this hosted run processes special-category column " +
        column +
        " on the platform under the recorded basis",
    );
  return (
    "Special-category column " +
    column +
    " was processed on the platform under " +
    basisSummary(d.basis) +
    "."
  );
}

/**
 * A client-held dataset pin (#102): what the client confirmed about a file
 * it keeps. The platform records the pin and never receives the bytes.
 */
export const clientPinInputSchema = z
  .object({
    /** The client's file name, for the record; the worker selects by hash. */
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\x00-\x1f/\\]+$/, "Give the file name without a path"),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "Give the SHA-256 as 64 lowercase hex digits"),
    /** The file's exact byte count, within the external route's 100 MB. */
    size: z
      .number()
      .int()
      .min(1)
      .max(100 * 1024 * 1024),
    /** Who at the client computed the hash: name and role. */
    confirmedBy: person,
    confirmedOn: calendarDate,
    /** Where the client keeps the file and who runs its worker. */
    custodyNote: statement,
  })
  .strict();
export type ClientPinInput = z.infer<typeof clientPinInputSchema>;
/** The dataset stays with the client; the platform holds only its pin. */
export function heldByClient(a: Pick<Artifact, "custody">) {
  return a.custody === "client";
}
/** Refuses to read the bytes of a client-held pin, which has none here. */
export function assertPlatformBytes(a: Pick<Artifact, "custody" | "name">) {
  if (heldByClient(a))
    throw new ApiError(
      409,
      a.name +
        " is held by the client: the platform holds only its SHA-256 pin, so only a client-local job on the client's own worker can use it",
    );
}
/** The storage key of evidence whose bytes the platform holds. */
export function platformKey(a: Pick<Artifact, "custody" | "name" | "key">) {
  assertPlatformBytes(a);
  return a.key;
}

/**
 * Refuses an external run of a fairness protocol on special-category data
 * unless a basis is recorded or the data reach no one but the client: a
 * client-local job on a client-held pin, whose worker reads the file in the
 * client's environment (#102). The auditor's worker, or the platform's copy
 * of uploaded bytes, would also give others access to the data.
 */
export function externalGate(
  profile: EvaluationProfile,
  mode: string,
  clientHeld: boolean,
) {
  if (
    !groupColumnIsSpecial(profile) ||
    (mode === "client_local" && clientHeld) ||
    profile.specialCategory?.basis
  )
    return;
  throw new ApiError(
    409,
    "Special-category column " +
      profile.config.groupColumn +
      (mode === "client_local"
        ? " can run without a recorded basis only on a client-held dataset pin, which the client's worker reads in the client's environment; this dataset's bytes are on the platform."
        : " can run without a recorded basis only on the client's own worker (client-local mode) reading a client-held dataset pin.") +
      " Record the client's basis in a new protocol version, or pin the client's file instead of uploading it.",
  );
}

/** The report limitation for each run that evaluated special-category data. */
export function specialCategoryLimitations(runs: readonly Run[]) {
  return runs.flatMap((r) => {
    const p = r.manifest?.profile;
    if (r.state !== "succeeded" || !p || !groupColumnIsSpecial(p)) return [];
    const d = p.specialCategory,
      where =
        r.manifest!.executionMode === "saved_predictions"
          ? "on the platform"
          : r.manifest!.executionMode === "client_local"
            ? r.manifest!.dataset?.custody === "client"
              ? "on the client's own worker in the client's environment, which returned only aggregates and withheld groups below the minimum group size,"
              : "on the client's own worker"
            : "on the auditor's external worker";
    return [
      "Run " +
        r.id +
        " evaluated special-category column " +
        p.config.groupColumn +
        " " +
        where +
        (d?.basis
          ? " under " + basisSummary(d.basis) + "."
          : " with no basis recorded on its protocol."),
    ];
  });
}

/** What the audit trail records about a run's special-category processing. */
export function runAuditDetails(run: Run) {
  const ack = run.manifest?.specialCategoryAcknowledgement;
  return ack
    ? {
        specialCategory: {
          ...ack,
          basisId: run.manifest?.profile?.specialCategory?.basis?.id,
        },
      }
    : {};
}
