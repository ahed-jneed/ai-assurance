// The report model (v2): the engagement type, the assurance level and the
// conclusion a report expresses, as data. ISAE 3000 (Revised) distinguishes
// limited from reasonable assurance and unmodified from modified (qualified,
// adverse, disclaimer) conclusions; agreed-upon procedures and readiness
// assessments are not assurance engagements and say so. The wording below is
// our own drafting around the conventional report phrases; no standard text is
// reproduced (D-03).
//
// Reports captured before v2 carry only a free `opinion` string ("Readiness
// assessment", "Qualified conclusion", "Adverse conclusion", "Unable to
// conclude"). Their snapshots are never rewritten: `legacyConclusion` maps the
// string for the gates, and `opinionLabel` renders it unchanged.

export const engagementTypeIds = [
  "attestation",
  "direct",
  "certification",
  "agreed_upon_procedures",
  "readiness",
] as const;
export const assuranceLevelIds = ["limited", "reasonable"] as const;
export const conclusionTypeIds = [
  "unmodified",
  "qualified",
  "adverse",
  "disclaimer",
  "readiness",
  "factual_findings",
  "certification_recommended",
  "certification_deferred",
  "certification_not_recommended",
] as const;
/** The conclusions of a certification audit: a recommendation (#28). */
export const certificationConclusionIds = [
  "certification_recommended",
  "certification_deferred",
  "certification_not_recommended",
] as const;
export type CertificationConclusion =
  (typeof certificationConclusionIds)[number];
export const isCertificationConclusion = (
  c: string,
): c is CertificationConclusion =>
  (certificationConclusionIds as readonly string[]).includes(c);
export type EngagementType = (typeof engagementTypeIds)[number];
export type AssuranceLevel = (typeof assuranceLevelIds)[number];
export type ConclusionType = (typeof conclusionTypeIds)[number];
type AssuranceConclusion =
  "unmodified" | "qualified" | "adverse" | "disclaimer";
const isAssuranceConclusion = (c: ConclusionType): c is AssuranceConclusion =>
  ["unmodified", "qualified", "adverse", "disclaimer"].includes(c);

/** What a report expresses: its engagement type, level and conclusion. */
export type ReportTerms = {
  engagementType: EngagementType;
  /** Null for engagements that provide no assurance. */
  assuranceLevel: AssuranceLevel | null;
  conclusion: ConclusionType;
};
/** The report elements the Lead Auditor states when capturing a report. */
export type ReportParticulars = {
  addressee: string;
  location: string;
  signatory: string;
  /** Required for a qualified, adverse or disclaimer conclusion. */
  basisForModification: string;
};

export const engagementTypes: Record<
  EngagementType,
  {
    label: string;
    /** Whether the engagement provides assurance (limited or reasonable). */
    assurance: boolean;
    /** The standard the report states it applied. */
    standard: string;
    conclusions: ConclusionType[];
    /** How the conclusion names the subject matter. */
    subject: "information" | "underlying";
    guidance: string;
  }
> = {
  attestation: {
    label: "Attestation engagement",
    assurance: true,
    standard: "ISAE 3000 (Revised), attestation engagement",
    conclusions: ["unmodified", "qualified", "adverse", "disclaimer"],
    subject: "information",
    guidance:
      "The responsible party measures the subject matter and presents information; we conclude on that information.",
  },
  direct: {
    label: "Direct engagement",
    assurance: true,
    standard: "ISAE 3000 (Revised), direct engagement",
    conclusions: ["unmodified", "qualified", "adverse", "disclaimer"],
    subject: "underlying",
    guidance:
      "We measure or evaluate the underlying subject matter against the criteria ourselves.",
  },
  // A certification audit states no ISAE 3000 assurance level and no
  // assurance conclusion: it ends in the audit team's recommendation to the
  // certification body's decision (#28). It still needs an engagement quality
  // review (qualityReviewRequired).
  certification: {
    label: "Certification audit",
    assurance: false,
    standard:
      "ISO/IEC 17021-1 with ISO/IEC 42006, AI management system certification audit",
    conclusions: [...certificationConclusionIds],
    subject: "underlying",
    guidance:
      "A Stage 1 and Stage 2 audit of a management system against ISO/IEC 42001 that ends in a recommendation to the certification decision. Needs a criteria pack with certification recommendations.",
  },
  agreed_upon_procedures: {
    label: "Agreed-upon procedures",
    assurance: false,
    standard: "ISRS 4400 (Revised), agreed-upon procedures engagement",
    conclusions: ["factual_findings"],
    subject: "underlying",
    guidance:
      "We perform the procedures agreed with the engaging party and report factual findings without a conclusion.",
  },
  readiness: {
    label: "Readiness assessment",
    assurance: false,
    standard:
      "No assurance standard applies: an advisory readiness assessment under our methodology",
    conclusions: ["readiness"],
    subject: "underlying",
    guidance:
      "An advisory view of preparedness against the criteria. It is not assurance and must not be presented as such.",
  },
};

/**
 * The engagement types a report on a pack may choose: a certification audit
 * only on packs with certification recommendations (#28).
 */
export const offeredEngagementTypes = (certification: boolean) =>
  engagementTypeIds.filter((t) => certification || t !== "certification");

export const assuranceLevels: Record<
  AssuranceLevel,
  { label: string; statement: string }
> = {
  limited: {
    label: "Limited assurance",
    statement:
      "Our limited assurance procedures differ in nature and timing from, and are less extensive than, those of a reasonable assurance engagement, so the assurance obtained is substantially lower than reasonable assurance would provide.",
  },
  reasonable: {
    label: "Reasonable assurance",
    statement:
      "Reasonable assurance is a high, but not absolute, level of assurance.",
  },
};

export const conclusionTypes: Record<
  ConclusionType,
  {
    label: string;
    /**
     * Whether the conclusion is positive: every in-scope conclusion supported,
     * no open High or Critical finding, no scope limitation and no prohibited
     * practice.
     */
    requiresSupport: boolean;
    /** Whether the report must state a basis for the modification. */
    modified: boolean;
    guidance: string;
  }
> = {
  unmodified: {
    label: "Unmodified",
    requiresSupport: true,
    modified: false,
    guidance:
      "Sufficient appropriate evidence and no material deviation from the criteria. Open High or Critical findings, unsupported conclusions and scope limitations block it.",
  },
  qualified: {
    label: "Qualified",
    requiresSupport: false,
    modified: true,
    guidance:
      "Material but not pervasive deviations, or a scope limitation whose possible effects are material but not pervasive.",
  },
  adverse: {
    label: "Adverse",
    requiresSupport: false,
    modified: true,
    guidance:
      "Material and pervasive deficiencies: evidence shows the subject matter does not conform to the criteria.",
  },
  disclaimer: {
    label: "Disclaimer",
    requiresSupport: false,
    modified: true,
    guidance:
      "A pervasive inability to obtain sufficient appropriate evidence: no conclusion can be formed, so none is expressed.",
  },
  readiness: {
    label: "Readiness assessment (not assurance)",
    requiresSupport: true,
    modified: false,
    guidance:
      "States readiness against the criteria. Open High or Critical findings, unsupported conclusions and scope limitations block it.",
  },
  factual_findings: {
    label: "Factual findings (not assurance)",
    requiresSupport: false,
    modified: false,
    guidance:
      "Reports the procedures performed and their factual findings, with no opinion or conclusion.",
  },
  // The certification gates are in lib/domain/management-system.ts: they read
  // nonconformity grades, not paper conclusions, because accepted plans for
  // minor nonconformities do not block a recommendation.
  certification_recommended: {
    label: "Certification recommended",
    requiresSupport: false,
    modified: false,
    guidance:
      "No unresolved major nonconformity, an accepted corrective action plan for every unresolved minor one, and a reviewed Statement of Applicability.",
  },
  certification_deferred: {
    label: "Recommendation deferred",
    requiresSupport: false,
    modified: true,
    guidance:
      "A major nonconformity awaits verification of its correction and corrective action; every unresolved nonconformity has an accepted plan.",
  },
  certification_not_recommended: {
    label: "Certification not recommended",
    requiresSupport: false,
    modified: true,
    guidance:
      "The management system does not meet the criteria, or the evidence does not allow a recommendation.",
  },
};

/** Report headings and wording by assurance level, our own drafting. */
const assuranceWording: Record<
  AssuranceLevel,
  Record<AssuranceConclusion, { heading: string; basis?: string; text: string }>
> = {
  reasonable: {
    unmodified: {
      heading: "Opinion",
      text: "In our opinion, {subject} is, in all material respects, in accordance with {criteria}.",
    },
    qualified: {
      heading: "Qualified opinion",
      basis: "Basis for qualified opinion",
      text: "In our opinion, except for the effects, or possible effects, of the matter described in the Basis for qualified opinion section, {subject} is, in all material respects, in accordance with {criteria}.",
    },
    adverse: {
      heading: "Adverse opinion",
      basis: "Basis for adverse opinion",
      text: "In our opinion, because of the significance of the matter described in the Basis for adverse opinion section, {subject} is not in accordance with {criteria}.",
    },
    disclaimer: {
      heading: "Disclaimer of opinion",
      basis: "Basis for disclaimer of opinion",
      text: "Because of the significance of the matter described in the Basis for disclaimer of opinion section, we have not been able to obtain sufficient appropriate evidence to form an opinion. Accordingly, we do not express an opinion on {subject}.",
    },
  },
  limited: {
    unmodified: {
      heading: "Conclusion",
      text: "Based on the procedures we have performed and the evidence we have obtained, nothing has come to our attention that causes us to believe that {subject} is not, in all material respects, in accordance with {criteria}.",
    },
    qualified: {
      heading: "Qualified conclusion",
      basis: "Basis for qualified conclusion",
      text: "Based on the procedures we have performed and the evidence we have obtained, except for the effects, or possible effects, of the matter described in the Basis for qualified conclusion section, nothing has come to our attention that causes us to believe that {subject} is not, in all material respects, in accordance with {criteria}.",
    },
    adverse: {
      heading: "Adverse conclusion",
      basis: "Basis for adverse conclusion",
      text: "Based on the procedures we have performed and the evidence we have obtained, because of the significance of the matter described in the Basis for adverse conclusion section, {subject} is not in accordance with {criteria}.",
    },
    disclaimer: {
      heading: "Disclaimer of conclusion",
      basis: "Basis for disclaimer of conclusion",
      text: "Because of the significance of the matter described in the Basis for disclaimer of conclusion section, we have not been able to obtain sufficient appropriate evidence to form a conclusion. Accordingly, we do not express a conclusion on {subject}.",
    },
  },
};
const nonAssuranceWording: Record<
  "readiness" | "factual_findings" | CertificationConclusion,
  { heading: string; basis?: string; text: string }
> = {
  certification_recommended: {
    heading: "Audit recommendation: certification recommended",
    text: "Based on the Stage 1 and Stage 2 audit of {subject} against {criteria}, the audit team recommends certification. No major nonconformity remains unresolved, and the corrective action plan for each unresolved minor nonconformity was accepted. The certification decision rests with the certification body; this report is not a certificate.",
  },
  certification_deferred: {
    heading: "Audit recommendation: deferred",
    basis: "Basis for deferral",
    text: "Based on the Stage 1 and Stage 2 audit of {subject} against {criteria}, the audit team defers its recommendation until the correction and corrective action of each major nonconformity described in the Basis for deferral section are verified. The certification decision rests with the certification body; this report is not a certificate.",
  },
  certification_not_recommended: {
    heading: "Audit recommendation: certification not recommended",
    basis: "Basis for the recommendation",
    text: "Based on the Stage 1 and Stage 2 audit of {subject} against {criteria}, the audit team does not recommend certification, because of the matters described in the Basis for the recommendation section. The certification decision rests with the certification body.",
  },
  readiness: {
    heading: "Readiness assessment — not an assurance engagement",
    text: "This report describes the readiness of {subject} against {criteria} as we observed it during the engagement. It is not an assurance engagement: we express no opinion or conclusion that provides assurance.",
  },
  factual_findings: {
    heading: "Factual findings — not an assurance engagement",
    text: "We performed the procedures agreed with the engaging party on {subject} and report the factual findings below. This is not an assurance engagement: we express no opinion or conclusion.",
  },
};

/** The practitioner's responsibilities, stated in every report. */
export const practitionerResponsibility: Record<EngagementType, string> = {
  attestation:
    "Our responsibility is to express a conclusion on the subject matter information based on the evidence we obtained, and to plan and perform the engagement to obtain the assurance stated.",
  direct:
    "Our responsibility is to measure or evaluate the underlying subject matter against the criteria and to express a conclusion based on the evidence we obtained.",
  certification:
    "Our responsibility is to audit the management system against the criteria and to report the audit conclusion that supports the certification decision.",
  agreed_upon_procedures:
    "Our responsibility is to perform the agreed procedures and report the factual findings. The engaging party is responsible for the sufficiency of the procedures for its purpose.",
  readiness:
    "Our responsibility is to assess readiness against the criteria using our methodology and to report what we observed.",
};
/** The firm's independence and quality-management statement. */
export const qualityStatement =
  "We complied with the independence and other ethical requirements of the IESBA International Code of Ethics for Professional Accountants (including International Independence Standards), and our firm applies ISQM 1, which requires a system of quality management.";

/** The conclusion a legacy (pre-v2) opinion string corresponds to. */
const legacyOpinions: Record<string, ConclusionType> = {
  "Readiness assessment": "readiness",
  "Qualified conclusion": "qualified",
  "Adverse conclusion": "adverse",
  "Unable to conclude": "disclaimer",
};
/** The conclusion type of a v2 conclusion id or a legacy opinion string. */
export function legacyConclusion(opinion: string): ConclusionType | undefined {
  return (legacyOpinions[opinion] ??
    conclusionTypeIds.find((c) => c === opinion)) as ConclusionType | undefined;
}
/**
 * Whether a conclusion needs every in-scope conclusion supported and no open
 * High or Critical finding. Accepts v2 conclusion ids and legacy opinions; an
 * unknown value is held to the strict gates.
 */
export function requiresSupport(conclusion: string) {
  const c = legacyConclusion(conclusion);
  return c ? conclusionTypes[c].requiresSupport : true;
}

/** The terms a v2 snapshot recorded, or null for a legacy snapshot. */
export function snapshotTerms(snapshot: Record<string, unknown>) {
  const t = snapshot.terms as Partial<ReportTerms> | undefined;
  return t &&
    typeof t === "object" &&
    engagementTypeIds.includes(t.engagementType as EngagementType) &&
    conclusionTypeIds.includes(t.conclusion as ConclusionType)
    ? (t as ReportTerms)
    : null;
}
/** The particulars a v2 snapshot recorded. */
export function snapshotParticulars(
  snapshot: Record<string, unknown>,
): ReportParticulars {
  const p = (snapshot.particulars ?? {}) as Partial<ReportParticulars>;
  return {
    addressee: String(p.addressee ?? ""),
    location: String(p.location ?? ""),
    signatory: String(p.signatory ?? ""),
    basisForModification: String(p.basisForModification ?? ""),
  };
}
/**
 * The conclusion a snapshot's gates are rechecked with on release: the v2
 * conclusion id, or the legacy opinion string.
 */
export const snapshotConclusion = (snapshot: Record<string, unknown>) =>
  snapshotTerms(snapshot)?.conclusion ?? String(snapshot.opinion ?? "");

/** Why a combination of terms is not a valid report, if it is not. */
export function termsProblem(t: ReportTerms) {
  const type = engagementTypes[t.engagementType];
  if (!type) return "Select an engagement type";
  if (type.assurance && !t.assuranceLevel)
    return type.label + " requires a limited or reasonable assurance level";
  if (!type.assurance && t.assuranceLevel)
    return type.label + " provides no assurance; leave the level unset";
  if (!type.conclusions.includes(t.conclusion))
    return (
      type.label +
      " cannot express a " +
      (conclusionTypes[t.conclusion]?.label ?? t.conclusion).toLowerCase() +
      " conclusion"
    );
  return "";
}
/** The terms a new report starts from. */
export const defaultTerms: ReportTerms = {
  engagementType: "attestation",
  assuranceLevel: "limited",
  conclusion: "unmodified",
};
/**
 * Valid terms closest to a partial choice, for pickers: an unknown type falls
 * back to the default, a level is kept only where the type provides
 * assurance (limited when none was chosen), and a conclusion the type cannot
 * express falls back to the type's first conclusion.
 */
export function normalizeTerms(t: {
  engagementType?: string;
  assuranceLevel?: string | null;
  conclusion?: string;
}): ReportTerms {
  const engagementType =
      engagementTypeIds.find((id) => id === t.engagementType) ??
      defaultTerms.engagementType,
    type = engagementTypes[engagementType];
  return {
    engagementType,
    assuranceLevel: type.assurance
      ? (assuranceLevelIds.find((id) => id === t.assuranceLevel) ?? "limited")
      : null,
    conclusion:
      type.conclusions.find((c) => c === t.conclusion) ?? type.conclusions[0],
  };
}

/** The report title the terms call for. */
export function reportTitle(t: ReportTerms) {
  if (t.engagementType === "agreed_upon_procedures")
    return "Agreed-upon procedures report of factual findings";
  if (t.engagementType === "readiness")
    return "AI readiness assessment report (not an assurance report)";
  if (t.engagementType === "certification")
    return "AI management system certification audit report";
  const level = t.assuranceLevel ? t.assuranceLevel + " assurance " : "";
  return "Independent " + level + "report";
}

/** The conclusion section of a report: heading, wording and basis heading. */
export function conclusionStatement(
  t: ReportTerms,
  subject: string,
  criteria: string,
) {
  const subjectPhrase =
    engagementTypes[t.engagementType].subject === "information"
      ? "the subject matter information on " + subject
      : subject;
  const w = isAssuranceConclusion(t.conclusion)
    ? assuranceWording[t.assuranceLevel ?? "reasonable"][t.conclusion]
    : nonAssuranceWording[t.conclusion];
  return {
    heading: w.heading,
    basisHeading: "basis" in w ? (w.basis ?? "") : "",
    text: w.text
      .replaceAll("{subject}", subjectPhrase)
      .replaceAll("{criteria}", criteria),
    levelStatement: t.assuranceLevel
      ? assuranceLevels[t.assuranceLevel].statement
      : "",
    notAssurance: !engagementTypes[t.engagementType].assurance,
  };
}

/** A short label for the terms, e.g. "Qualified conclusion · limited assurance". */
export function termsLabel(t: ReportTerms) {
  if (!isAssuranceConclusion(t.conclusion))
    return conclusionTypes[t.conclusion].label;
  const heading =
    assuranceWording[t.assuranceLevel ?? "reasonable"][t.conclusion].heading;
  return (
    (t.conclusion === "unmodified"
      ? "Unmodified " + heading.toLowerCase()
      : heading) +
    " · " +
    (t.assuranceLevel ?? "reasonable") +
    " assurance"
  );
}
/**
 * The opinion a captured report shows: the v2 terms label, or the legacy
 * opinion string exactly as it was issued.
 */
export function opinionLabel(snapshot: Record<string, unknown>) {
  const t = snapshotTerms(snapshot);
  return t
    ? termsLabel(t)
    : typeof snapshot.opinion === "string" && snapshot.opinion
      ? snapshot.opinion
      : "Opinion not recorded";
}
