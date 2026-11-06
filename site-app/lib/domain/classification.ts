// Regulatory classification of the assessed system under the EU AI Act (#19):
// tri-state facts (true, false or unknown), each answer stored with the legal
// version it was given under; the high-risk route derived from the reviewed
// route and the Art 6(3) derogation; an enumerated Art 5 screen; GPAI roles and
// the AI Office competence flag; SME or small mid-cap status; the Art 50 facts
// and the Art 50 items of docs/obligation-subitems.json evaluated with the rule
// pack's three-valued predicates. Unknown never means "Minimal risk": it gives
// "Needs information" and blocks approval. Pure and without data imports, so
// the check harnesses can load it; lib/classification-rules.ts binds the data.
import {
  all,
  any,
  conjunction,
  factTruth,
  not,
  unknownFacts,
  type Facts,
  type Predicate,
  type Truth,
} from "../predicates";

export const operatorRoles = [
  "Provider",
  "Deployer",
  "Provider and deployer",
  "Importer / distributor",
] as const;
export const derogationRoute = "Article 6(3) exception assessment";
export const annexRoutes = [
  "Unassessed",
  "Annex III — sensitive use case",
  "Annex I Section A — regulated product",
  "Annex I Section B — sector-specific review",
  derogationRoute,
  "Article 50 only",
  "Outside high-risk scope",
] as const;
export type HighRiskRoute =
  "annex_iii" | "annex_i_section_a" | "annex_i_section_b" | "not_high_risk";
/**
 * The reviewed routes that decide highRiskRoute on their own (RD-27). The
 * Art 6(3) route decides it with the derogation answer; "Unassessed" and any
 * other stored value leave it unknown.
 */
export const annexRouteFacts: Readonly<Record<string, HighRiskRoute>> = {
  "Annex III — sensitive use case": "annex_iii",
  "Annex I Section A — regulated product": "annex_i_section_a",
  "Annex I Section B — sector-specific review": "annex_i_section_b",
  "Article 50 only": "not_high_risk",
  "Outside high-risk scope": "not_high_risk",
};

export type FactValue = boolean | string;
/** One answered fact, with the legal version and rule pack it was given under. */
export type Answer = {
  value: FactValue;
  /** The evidence an exception or exclusion relied on rests on. */
  evidence?: string;
  /** When a Code signatory status was checked against the Commission list. */
  checkedOn?: string;
  legalVersion: string;
  rulePackVersion: string;
  answeredAt: string;
  answeredBy: string;
};
export type ClassificationLabel =
  | "Unassessed"
  | "Needs information"
  | "Prohibited"
  | "High risk"
  | "Specific transparency"
  | "Minimal risk";
/** A guidance document as a classification cited it. */
export type GuidanceCitation = {
  id: string;
  title: string;
  status: string;
  reference: string;
  date?: string;
};
export type Art50Status =
  | "candidate"
  | "excluded"
  | "not_triggered"
  | "needs_information"
  | "role_not_held";
/** What the classification derived when it was recorded or approved. */
export type ClassificationAssessment = {
  label: ClassificationLabel;
  highRiskRoute: HighRiskRoute | "unknown";
  /** Required facts still unknown, in words. */
  needsInformation: string[];
  art50: { code: string; status: Art50Status }[];
  rulePackVersion: string;
};
export type ClassificationEvent = {
  action: "classified" | "approved" | "approved_v1";
  at?: string;
  by?: string;
  label: string;
  legalVersion: string;
  rulePackVersion?: string;
};
/** A classification recorded before #19 (four booleans), kept read-only. */
export type LegacyClassification = {
  status: "provisional" | "approved";
  approvedBy?: string;
  prohibited: boolean;
  highRisk: boolean;
  transparency: boolean;
  profiling: boolean;
  version: string;
  asOf: string;
};
export type Classification = {
  /** Derived since #19: an Art 5 practice was answered yes. */
  prohibited: boolean;
  /** Derived since #19: the high-risk route is an Annex I or Annex III route. */
  highRisk: boolean;
  /** Derived since #19: an Art 50 item is a candidate. */
  transparency: boolean;
  /** Derived since #19: the Annex III use involves profiling. */
  profiling: boolean;
  annexRoute: string;
  operatorRole: string;
  intendedPurpose: string;
  rationale: string;
  status: "provisional" | "approved";
  approvedBy?: string;
  approvedAt?: string;
  /** The legal version (CELEX) and research date it was recorded against. */
  version: string;
  asOf: string;
  /** 2 once the classification uses tri-state facts (#19). */
  model?: 2;
  rulePackVersion?: string;
  /** Answered facts; an absent fact is unknown. */
  answers?: Record<string, Answer>;
  /** The Art 6(3) derogation rationale and registration evidence (Art 49(2)). */
  derogation?: { rationale: string; registrationEvidence: string };
  guidance?: GuidanceCitation[];
  assessment?: ClassificationAssessment;
  history?: ClassificationEvent[];
  legacy?: LegacyClassification;
};

export const articleNames: Record<string, string> = {
  "9": "Risk management",
  "10": "Data & data governance",
  "11": "Technical documentation",
  "12": "Record-keeping",
  "13": "Deployer transparency",
  "14": "Human oversight",
  "15": "Accuracy, robustness & security",
};

// ---------------------------------------------------------------------------
// The facts the guided classification asks.

export type FactKind = "boolean" | "date" | "enumeration";
export type FactSection =
  | "route"
  | "art5"
  | "gpai"
  | "organisation"
  | "art50Provider"
  | "art50Deployer"
  | "art50Shared"
  | "dates";
export type FactDefinition = {
  id: string;
  section: FactSection;
  kind: FactKind;
  /** Our own wording of the question (D-03: no reproduced text). */
  label: string;
  /** Asked only of operators holding this role; absent: every operator. */
  role?: "provider" | "deployer";
  /** Asked only when this is true. */
  parent?: (facts: Facts) => Truth;
  parentLabel?: string;
  /** Asked only on these routes. */
  routes?: readonly string[];
  /** Once asked, approval needs an answer. */
  required?: boolean;
  /** A "yes" relies on an exception or exclusion and needs evidence. */
  exception?: boolean;
  /** A "yes" needs the date it was checked on. */
  checkedOn?: boolean;
  values?: readonly { value: string; label: string }[];
  /** Pending legal-review items (never shown as approved, D-02). */
  legalReview?: readonly string[];
  /** Applies from (Art 5 practices). */
  appliesFrom?: string;
  hint?: string;
};

const is = (fact: string) => (facts: Facts) => factTruth(facts, fact);
const synthetic = is("generatesSyntheticContent");
const section2 = (facts: Facts) =>
  any([
    factTruth(facts, "deployerGeneratesDeepFakes"),
    factTruth(facts, "deployerPublishesAiTextOnPublicInterest"),
  ]);
const yesNo = (
  id: string,
  section: FactSection,
  label: string,
  extra: Partial<FactDefinition> = {},
): FactDefinition => ({ id, section, kind: "boolean", label, ...extra });
const date = (
  id: string,
  label: string,
  extra: Partial<FactDefinition> = {},
): FactDefinition => ({ id, section: "dates", kind: "date", label, ...extra });

export const smeStatuses = [
  { value: "sme", label: "SME (Recommendation 2003/361/EC)" },
  { value: "small_mid_cap", label: "Small mid-cap enterprise" },
  { value: "neither", label: "Neither SME nor small mid-cap" },
] as const;

/** Every fact except the Art 5 practices, which come from the rule pack. */
export const classificationFacts: readonly FactDefinition[] = [
  yesNo(
    "annexIIIProfiling",
    "route",
    "The Annex III use involves profiling of natural persons",
    {
      routes: ["Annex III — sensitive use case", derogationRoute],
      required: true,
      hint: "Profiling keeps an Annex III system high risk: the Art 6(3) derogation cannot apply.",
    },
  ),
  yesNo(
    "art6_3Derogation",
    "route",
    "The Art 6(3) derogation applies: no significant risk of harm",
    {
      routes: [derogationRoute],
      required: true,
      hint: "Record the rationale and the registration evidence (Art 49(2)). The Commission's Art 6 guidelines are still a draft.",
    },
  ),
  yesNo(
    "gpaiModelProvider",
    "gpai",
    "Provides a general-purpose AI model (GPAI model provider)",
    { role: "provider", required: true },
  ),
  yesNo(
    "gpaiSystemicRiskModel",
    "gpai",
    "The model is a GPAI model with systemic risk (Art 51)",
    {
      role: "provider",
      required: true,
      parent: is("gpaiModelProvider"),
      parentLabel: "GPAI model provider",
    },
  ),
  date(
    "gpaiModelPlacedOnMarketDate",
    "Date the GPAI model was first placed on the market",
    {
      section: "gpai",
      role: "provider",
      parent: is("gpaiModelProvider"),
      parentLabel: "GPAI model provider",
      hint: "Art 111(3) dates obligations for models placed on the market before 2 August 2025.",
    },
  ),
  yesNo(
    "gpaiDownstreamProvider",
    "gpai",
    "Integrates a general-purpose AI model of another provider (downstream provider)",
    { role: "provider", required: true },
  ),
  yesNo(
    "builtOnOwnGpaiModel",
    "gpai",
    "The system is based on a GPAI model from the same provider or undertaking (Art 75(1)(a))",
    { legalReview: ["LR-08"] },
  ),
  yesNo(
    "art75ExceptedSystem",
    "gpai",
    "The system falls under an Art 75(1)(a) exception (Annex I products, Annex III point 2 or 8, law enforcement, border management, Art 74(6) financial institutions)",
    { legalReview: ["LR-08"] },
  ),
  yesNo(
    "integratedIntoVlopOrVlose",
    "gpai",
    "The system is or is integrated into a designated very large online platform or search engine (Art 75(1)(b))",
  ),
  yesNo(
    "deployerIsProviderOrSameUndertaking",
    "gpai",
    "The deployer is the provider or part of the provider's undertaking",
    { role: "deployer", legalReview: ["LR-08"] },
  ),
  {
    id: "smeStatus",
    section: "organisation",
    kind: "enumeration",
    label: "SME or small mid-cap status of the operator",
    values: smeStatuses,
    required: true,
  },
  // Art 50, providers.
  yesNo(
    "interactsDirectlyWithNaturalPersons",
    "art50Provider",
    "Intended to interact directly with natural persons (agents included)",
    { role: "provider", required: true },
  ),
  yesNo(
    "obviousToReasonablyWellInformedPerson",
    "art50Provider",
    "Exception relied on: the AI interaction is obvious to a reasonably well-informed person",
    {
      role: "provider",
      parent: is("interactsDirectlyWithNaturalPersons"),
      parentLabel: "direct interaction",
      exception: true,
      legalReview: ["LR-A50-06"],
    },
  ),
  yesNo(
    "availableToPublicToReportCriminalOffence",
    "art50Provider",
    "Available to the public to report a criminal offence",
    {
      role: "provider",
      parent: is("interactsDirectlyWithNaturalPersons"),
      parentLabel: "direct interaction",
    },
  ),
  yesNo(
    "isAiAgent",
    "art50Provider",
    "Acts as an AI agent towards the persons instructing it or others",
    {
      role: "provider",
      parent: is("interactsDirectlyWithNaturalPersons"),
      parentLabel: "direct interaction",
      legalReview: ["LR-A50-07"],
    },
  ),
  yesNo(
    "interactsWithChildrenOrVulnerableGroups",
    "art50Provider",
    "Likely to reach children or other vulnerable groups",
    {
      role: "provider",
      parent: is("interactsDirectlyWithNaturalPersons"),
      parentLabel: "direct interaction",
    },
  ),
  yesNo(
    "generatesSyntheticText",
    "art50Provider",
    "Generates or manipulates text",
    { role: "provider", required: true },
  ),
  yesNo(
    "generatesSyntheticImage",
    "art50Provider",
    "Generates or manipulates images",
    { role: "provider", required: true },
  ),
  yesNo(
    "generatesSyntheticAudio",
    "art50Provider",
    "Generates or manipulates audio",
    { role: "provider", required: true },
  ),
  yesNo(
    "generatesSyntheticVideo",
    "art50Provider",
    "Generates or manipulates video",
    { role: "provider", required: true },
  ),
  ...(
    [
      [
        "onlyAssistiveStandardEditing",
        "Exception relied on: only assistive functions for standard editing",
        [],
      ],
      [
        "noSubstantialAlterationOfInput",
        "Exception relied on: no substantial alteration of the deployer's input",
        [],
      ],
      [
        "outputsOnlyOutOfScopeContent",
        "Exclusion relied on (guidance only): every output is outside Art 50(2)",
        ["LR-A50-03"],
      ],
      [
        "b2bIndustrialConditionsMet",
        "Exclusion relied on (guidance only): industrial B2B use meeting point 87",
        ["LR-A50-03"],
      ],
      [
        "ephemeralRealTimeOnly",
        "Exclusion relied on (guidance only): real-time ephemeral output, persons told",
        ["LR-A50-03"],
      ],
    ] as const
  ).map(([id, label, review]) =>
    yesNo(id, "art50Provider", label, {
      role: "provider",
      parent: synthetic,
      parentLabel: "synthetic content",
      exception: true,
      legalReview: review,
    }),
  ),
  yesNo(
    "closedPhysicalProductEnvironment",
    "art50Provider",
    "Embedded in a closed physical product environment (changes the marking layers only)",
    {
      role: "provider",
      parent: synthetic,
      parentLabel: "synthetic content",
      legalReview: ["LR-A50-03"],
    },
  ),
  yesNo(
    "codeSignatorySection1",
    "art50Provider",
    "Signatory of Section 1 of the Code of Practice, without opt-outs",
    {
      role: "provider",
      parent: synthetic,
      parentLabel: "synthetic content",
      checkedOn: true,
      legalReview: ["LR-A50-04"],
    },
  ),
  yesNo(
    "scientificResearchOnly",
    "art50Provider",
    "Exclusion relied on: sole purpose of scientific research and development (Art 2(6))",
    { role: "provider", exception: true },
  ),
  // Art 50, both roles.
  yesNo(
    "authorisedByLawForCriminalOffences",
    "art50Shared",
    "Exception relied on: use authorised by law to detect, prevent, investigate or prosecute criminal offences",
    { exception: true },
  ),
  // Art 50, deployers.
  yesNo(
    "deployerUsesEmotionRecognition",
    "art50Deployer",
    "Uses an emotion recognition system",
    { role: "deployer", required: true, legalReview: ["LR-A50-11"] },
  ),
  yesNo(
    "deployerUsesBiometricCategorisation",
    "art50Deployer",
    "Uses a biometric categorisation system",
    { role: "deployer", required: true, legalReview: ["LR-A50-11"] },
  ),
  yesNo(
    "lawEnforcementPermittedErBc",
    "art50Deployer",
    "Exception relied on: the use is permitted by law for criminal offences, with safeguards",
    {
      role: "deployer",
      parent: is("deployerOperatesErOrBcSystem"),
      parentLabel: "emotion recognition or biometric categorisation",
      exception: true,
      legalReview: ["LR-A50-11"],
    },
  ),
  yesNo(
    "deployerGeneratesDeepFakes",
    "art50Deployer",
    "Generates or manipulates deep-fake image, audio or video content",
    { role: "deployer", required: true, legalReview: ["LR-A50-08"] },
  ),
  yesNo(
    "evidentlyArtisticCreativeSatiricalFictional",
    "art50Deployer",
    "The deep fakes are part of an evidently artistic, creative, satirical or fictional work",
    {
      role: "deployer",
      parent: is("deployerGeneratesDeepFakes"),
      parentLabel: "deep fakes",
      legalReview: ["LR-A50-08"],
    },
  ),
  yesNo(
    "deployerPublishesAiTextOnPublicInterest",
    "art50Deployer",
    "Publishes AI-generated or manipulated text to inform the public on matters of public interest",
    { role: "deployer", required: true },
  ),
  yesNo(
    "editorialExceptionReliedOn",
    "art50Deployer",
    "Exception relied on: human review or editorial control with editorial responsibility",
    {
      role: "deployer",
      parent: is("deployerPublishesAiTextOnPublicInterest"),
      parentLabel: "public-interest text",
      exception: true,
      legalReview: ["LR-A50-09"],
    },
  ),
  yesNo(
    "codeSignatorySection2",
    "art50Deployer",
    "Signatory of Section 2 of the Code of Practice, without opt-outs",
    {
      role: "deployer",
      parent: section2,
      parentLabel: "deep fakes or public-interest text",
      checkedOn: true,
      legalReview: ["LR-A50-04"],
    },
  ),
  yesNo(
    "personalNonProfessionalUseOnly",
    "art50Deployer",
    "Exclusion relied on: purely personal, non-professional use (Art 2(10))",
    { role: "deployer", exception: true },
  ),
  // Dates and legacy-system facts the rule pack's date predicates read.
  date("placedOnMarketDate", "Date first placed on the Union market", {
    legalReview: ["LR-04", "LR-A50-01"],
  }),
  date(
    "putIntoServiceDate",
    "Date first put into service, for a system never placed on the market",
    {
      legalReview: ["LR-A50-01"],
      hint: "Recorded for the Art 111(4) question in LR-A50-01; the transition reads the placing date only.",
    },
  ),
  date(
    "firstPlacedOnMarketOrPutIntoServiceDate",
    "Date the first unit of the type and model was placed on the market or put into service",
    { legalReview: ["LR-03"] },
  ),
  yesNo(
    "significantDesignChangeOnOrAfterChapterIIIDate",
    "dates",
    "The design changes significantly on or after the Chapter III date of its route",
    { legalReview: ["LR-03"] },
  ),
  yesNo(
    "intendedForUseByPublicAuthorities",
    "dates",
    "Intended to be used by public authorities",
  ),
  yesNo(
    "annexXLargeScaleItComponent",
    "dates",
    "Component of an Annex X large-scale IT system",
    { legalReview: ["LR-03"] },
  ),
];

/** The rule-pack data a classification is evaluated with. */
export type ProhibitedPracticeRule = {
  point: string;
  label: string;
  appliesFrom: string;
  /** Legal-review items still open for the practice's entry. */
  pendingReview: string[];
};
export type FactCondition = { fact: string; equals: unknown };
export type ExclusionRule = {
  id: string;
  label: string;
  basis: string;
  ifAll: FactCondition[];
  legalReview?: { required: boolean; itemIds: string[] };
};
export type ObligationRule = {
  code: string;
  article: string;
  title: string;
  actor: string[];
  trigger: { profile: string; conditions: FactCondition[] };
  exclusions?: ExclusionRule[];
  exceptionsTestedPerItem?: ExclusionRule[];
};
export type TriggerProfile = {
  extends?: string;
  all?: FactCondition[];
  roleRequired?: string;
  anyRole?: string[];
};
export type ClassificationRules = {
  rulePackVersion: string;
  legalVersion: string;
  practices: ProhibitedPracticeRule[];
  art50Items: ObligationRule[];
  profiles: Record<string, TriggerProfile>;
  /** The guidance documents and their current status. */
  guidance: GuidanceCitation[];
};

/** "Art 5(1)(ba)" → "art5_1_ba": the answer key of a practice. */
export function practiceKey(point: string) {
  return (
    "art5_" +
    point
      .replace(/^Art\s*5/, "")
      .replace(/[()]+/g, "_")
      .replace(/^_+|_+$/g, "")
  );
}
export function practiceFacts(rules: Pick<ClassificationRules, "practices">) {
  return rules.practices.map((p): FactDefinition => ({
    id: practiceKey(p.point),
    section: "art5",
    kind: "boolean",
    label: p.point + ": " + p.label,
    required: true,
    appliesFrom: p.appliesFrom,
    legalReview: p.pendingReview,
  }));
}
export function factDefinitions(rules: Pick<ClassificationRules, "practices">) {
  return [...practiceFacts(rules), ...classificationFacts];
}

// ---------------------------------------------------------------------------
// Facts and derivations.

export function roleFlags(role: string) {
  return {
    provider: role === "Provider" || role === "Provider and deployer",
    deployer: role === "Deployer" || role === "Provider and deployer",
  };
}
/**
 * The derived facts (docs/obligation-subitems.json factDerivations): true if
 * any listed fact is true, false if all are false, otherwise unknown.
 */
export const factDerivations: Readonly<Record<string, readonly string[]>> = {
  generatesSyntheticContent: [
    "generatesSyntheticText",
    "generatesSyntheticImage",
    "generatesSyntheticAudio",
    "generatesSyntheticVideo",
  ],
  deployerOperatesErOrBcSystem: [
    "deployerUsesEmotionRecognition",
    "deployerUsesBiometricCategorisation",
  ],
  art50DisclosureApplies: [
    "interactsDirectlyWithNaturalPersons",
    "generatesSyntheticContent",
    "deployerOperatesErOrBcSystem",
    "deployerGeneratesDeepFakes",
    "deployerPublishesAiTextOnPublicInterest",
  ],
};
/** The role whose facts feed a derivation input. */
const roleOf: Readonly<Record<string, "provider" | "deployer">> = {
  interactsDirectlyWithNaturalPersons: "provider",
  generatesSyntheticContent: "provider",
  deployerOperatesErOrBcSystem: "deployer",
  deployerGeneratesDeepFakes: "deployer",
  deployerPublishesAiTextOnPublicInterest: "deployer",
};
function answeredFacts(c: Pick<Classification, "answers">) {
  return Object.fromEntries(
    Object.entries(c.answers ?? {}).map(([k, a]) => [k, a.value]),
  ) as Record<string, unknown>;
}
/** The route the reviewed answers support, or unknown. */
export function highRiskRouteOf(
  c: Pick<Classification, "annexRoute" | "answers">,
): HighRiskRoute | "unknown" {
  if (Object.hasOwn(annexRouteFacts, c.annexRoute))
    return annexRouteFacts[c.annexRoute];
  if (c.annexRoute !== derogationRoute) return "unknown";
  const facts = answeredFacts(c);
  // Profiling keeps an Annex III system high risk (Art 6(3), last subparagraph).
  if (facts.annexIIIProfiling === true) return "annex_iii";
  if (facts.art6_3Derogation === true) return "not_high_risk";
  if (facts.art6_3Derogation === false) return "annex_iii";
  return "unknown";
}
/**
 * Every known fact of a classification: the answers, the derived facts and
 * highRiskRoute. An unknown fact is absent, so a predicate reading it yields
 * needs_information.
 */
export function classificationFactValues(
  c: Pick<Classification, "annexRoute" | "answers" | "status"> & {
    operatorRole?: string;
  },
): Facts {
  const facts: Record<string, unknown> = answeredFacts(c),
    roles = c.operatorRole ? roleFlags(c.operatorRole) : null;
  for (const [fact, from] of Object.entries(factDerivations)) {
    // The facts of a role the operator does not hold are never asked; they
    // count as false, so a provider's Art 50(5) does not wait on deployer facts.
    const t = any(
      from.map((f) =>
        roles && roleOf[f] && !roles[roleOf[f]] ? false : factTruth(facts, f),
      ),
    );
    if (t !== "unknown") facts[fact] = t;
  }
  const route = highRiskRouteOf(c);
  if (route !== "unknown") {
    facts.highRiskRoute = route;
    if (route === "annex_i_section_a") facts.annexISectionAProduct = true;
    if (c.status === "approved")
      facts.highRiskConfirmed = route !== "not_high_risk";
  }
  return facts;
}
/** Whether the guided form asks a fact, given the role, route and answers. */
export function factAsked(
  def: FactDefinition,
  c: Pick<Classification, "operatorRole" | "annexRoute">,
  facts: Facts,
) {
  const roles = roleFlags(c.operatorRole);
  if (def.role && !roles[def.role]) return false;
  if (def.routes && !def.routes.includes(c.annexRoute)) return false;
  if (def.section === "art50Shared" && !roles.provider && !roles.deployer)
    return false;
  return !def.parent || def.parent(facts) === true;
}

// ---------------------------------------------------------------------------
// Art 50 items, AI Office competence and the label.

const predicates = (conditions: FactCondition[] = []): Predicate[] =>
  conditions.map((c) => ({ fact: c.fact, op: "eq", value: c.equals }));
function profileOf(rules: ClassificationRules, name: string) {
  const chain: TriggerProfile[] = [];
  for (let p = rules.profiles[name]; p; p = rules.profiles[p.extends ?? ""]) {
    chain.push(p);
    if (!p.extends || chain.length > 8) break;
  }
  return {
    conditions: chain.flatMap((p) => p.all ?? []),
    roles: chain.flatMap((p) =>
      p.roleRequired ? [p.roleRequired] : (p.anyRole ?? []),
    ),
  };
}
export type Art50Result = {
  code: string;
  article: string;
  title: string;
  status: Art50Status;
  missingFacts: string[];
  /** The exclusion that excludes the item. */
  exclusion?: ExclusionRule;
  /** Claimed exceptions, tested per item in fieldwork (option a). */
  claimedExceptions: ExclusionRule[];
};
/**
 * The Art 50 items: the operator's role, then the trigger (three-valued),
 * then the exclusionRule (excluded when any exclusion's ifAll is true; needs
 * information when none is true and one is unknown). Exceptions claimed under
 * Art 50(1), (3) and (4) never exclude: they are tested per item.
 */
export function art50Assessment(
  c: Pick<Classification, "operatorRole" | "annexRoute" | "answers" | "status">,
  rules: ClassificationRules,
): Art50Result[] {
  const facts = classificationFactValues(c),
    roles = roleFlags(c.operatorRole);
  return rules.art50Items.map((item): Art50Result => {
    const profile = profileOf(rules, item.trigger.profile),
      held = profile.roles.some((r) =>
        r === "Provider"
          ? roles.provider
          : r === "Deployer"
            ? roles.deployer
            : false,
      ),
      claimedExceptions = (item.exceptionsTestedPerItem ?? []).filter(
        (x) => conjunction(predicates(x.ifAll), facts, false) === true,
      ),
      base = {
        code: item.code,
        article: item.article,
        title: item.title,
        claimedExceptions,
      };
    if (!held)
      return {
        ...base,
        status: "role_not_held",
        missingFacts: [],
        claimedExceptions: [],
      };
    const trigger = predicates([
      ...profile.conditions,
      ...item.trigger.conditions,
    ]);
    const triggered = conjunction(trigger, facts, true);
    if (triggered === false)
      return { ...base, status: "not_triggered", missingFacts: [] };
    if (triggered === "unknown")
      return {
        ...base,
        status: "needs_information",
        missingFacts: unknownFacts(trigger, facts),
      };
    const exclusions = item.exclusions ?? [];
    const exclusion = exclusions.find(
      (x) => conjunction(predicates(x.ifAll), facts, false) === true,
    );
    if (exclusion)
      return { ...base, status: "excluded", missingFacts: [], exclusion };
    const open = exclusions.filter(
      (x) => conjunction(predicates(x.ifAll), facts, false) === "unknown",
    );
    return open.length
      ? {
          ...base,
          status: "needs_information",
          missingFacts: unknownFacts(
            open.flatMap((x) => predicates(x.ifAll)),
            facts,
          ),
        }
      : { ...base, status: "candidate", missingFacts: [] };
  });
}
/**
 * AI Office competence (Art 75(1) as replaced; rule-pack entry
 * aia-2026-08-02-ai-office-competence; A50-ED-06): competent when the system
 * is based on the provider's own GPAI model and not excepted, or is (part of)
 * a designated VLOP or VLOSE. It reaches a deployer's Art 50(3) and (4)
 * duties only where the deployer is the provider or in its undertaking.
 * Pending legal review (LR-08).
 */
export function aiOfficeCompetence(
  c: Pick<Classification, "operatorRole" | "annexRoute" | "answers" | "status">,
): { provider: Truth | "not_applicable"; deployer: Truth | "not_applicable" } {
  const facts = classificationFactValues(c),
    roles = roleFlags(c.operatorRole),
    competent = any([
      all([
        factTruth(facts, "builtOnOwnGpaiModel"),
        not(factTruth(facts, "art75ExceptedSystem")),
      ]),
      factTruth(facts, "integratedIntoVlopOrVlose"),
    ]);
  return {
    provider: roles.provider ? competent : "not_applicable",
    deployer: roles.deployer
      ? all([
          competent,
          factTruth(facts, "deployerIsProviderOrSameUndertaking"),
        ])
      : "not_applicable",
  };
}

/** Derived facts in words: the facts they are derived from. */
const derivedLabels: Readonly<Record<string, string>> = {
  generatesSyntheticContent: "the text, image, audio and video output facts",
  deployerOperatesErOrBcSystem:
    "the emotion recognition and biometric categorisation facts",
  art50DisclosureApplies: "the Art 50(1) to (4) trigger facts",
};
export const factLabel = (rules: ClassificationRules, id: string) =>
  factDefinitions(rules).find((d) => d.id === id)?.label ??
  derivedLabels[id] ??
  id;
/**
 * The required facts that are still unknown, in words: the route, every
 * asked required fact and every Art 50 item that needs information.
 */
export function needsInformation(
  c: Pick<Classification, "operatorRole" | "annexRoute" | "answers" | "status">,
  rules: ClassificationRules,
) {
  const facts = classificationFactValues(c),
    out: string[] = [];
  if (!(annexRoutes as readonly string[]).includes(c.annexRoute))
    out.push("Choose a classification route from the list");
  else if (c.annexRoute === "Unassessed")
    out.push("Assess the classification route");
  for (const def of factDefinitions(rules))
    if (def.required && factAsked(def, c, facts) && !c.answers?.[def.id])
      out.push(def.label);
  for (const r of art50Assessment(c, rules))
    if (r.status === "needs_information")
      out.push(
        "Art " +
          r.article +
          ": " +
          r.missingFacts.map((f) => factLabel(rules, f)).join("; "),
      );
  return [...new Set(out)];
}
/** Everything that blocks an independent approval, in words. */
export function approvalBlockers(
  c: Classification,
  rules: ClassificationRules,
) {
  const out = needsInformation(c, rules),
    facts = classificationFactValues(c);
  if (!c.intendedPurpose) out.push("Record the intended purpose");
  if (!c.rationale) out.push("Record the classification rationale");
  for (const def of factDefinitions(rules)) {
    const a = c.answers?.[def.id];
    if (!a || a.value !== true || !factAsked(def, c, facts)) continue;
    if (def.exception && !a.evidence)
      out.push("Link the evidence for: " + def.label);
    if (def.checkedOn && !a.checkedOn)
      out.push("Record when the signatory list was checked: " + def.label);
  }
  if (
    facts.art6_3Derogation === true &&
    (!c.derogation?.rationale || !c.derogation.registrationEvidence)
  )
    out.push(
      "Record the Art 6(3) derogation rationale and registration evidence",
    );
  for (const message of contradictions(c, rules)) out.push(message);
  return out;
}
/**
 * The label: a practice answered yes is prohibited whatever else is known;
 * otherwise an unknown route, an unanswered Art 5 practice or an Art 50 item
 * that needs information gives "Needs information", never "Minimal risk".
 */
export function assess(
  c: Pick<Classification, "operatorRole" | "annexRoute" | "answers" | "status">,
  rules: ClassificationRules,
): ClassificationAssessment {
  const facts = classificationFactValues(c),
    route = highRiskRouteOf(c),
    practices = practiceFacts(rules).map((d) => factTruth(facts, d.id)),
    art50 = art50Assessment(c, rules),
    missing = needsInformation(c, rules);
  const label: ClassificationLabel = practices.includes(true)
    ? "Prohibited"
    : c.annexRoute === "Unassessed"
      ? "Unassessed"
      : route === "unknown" || practices.includes("unknown")
        ? "Needs information"
        : route !== "not_high_risk"
          ? "High risk"
          : art50.some((r) => r.status === "candidate")
            ? "Specific transparency"
            : art50.some((r) => r.status === "needs_information")
              ? "Needs information"
              : "Minimal risk";
  return {
    label,
    highRiskRoute: route,
    needsInformation: missing,
    art50: art50.map((r) => ({ code: r.code, status: r.status })),
    rulePackVersion: rules.rulePackVersion,
  };
}
/**
 * The label as recorded. A classification without a recorded assessment
 * (new, or migrated from the four booleans) has no answers: it is
 * "Unassessed" until a route is chosen, then "Needs information".
 */
export function classify(c: Classification): ClassificationLabel {
  if (c.model === 2 && c.assessment) return c.assessment.label;
  return c.annexRoute === "Unassessed" ? "Unassessed" : "Needs information";
}

/**
 * Contradictions between the route, the role and the answers. The command
 * rejects a classification with any of them.
 */
export function contradictions(
  c: Pick<Classification, "operatorRole" | "annexRoute" | "answers">,
  rules: ClassificationRules,
) {
  const facts = classificationFactValues({ ...c, status: "provisional" }),
    roles = roleFlags(c.operatorRole),
    out: string[] = [];
  for (const [id, a] of Object.entries(c.answers ?? {})) {
    const def = factDefinitions(rules).find((d) => d.id === id);
    if (!def) out.push("Unknown fact " + id);
    else if (!factAsked(def, c, facts))
      out.push(
        def.label +
          (def.role && !roleFlags(c.operatorRole)[def.role]
            ? ": applies only to a " + def.role
            : def.routes && !def.routes.includes(c.annexRoute)
              ? ": applies only on the " + def.routes.join(" or ") + " route"
              : def.parentLabel
                ? ": applies only where " + def.parentLabel + " is answered yes"
                : ": not asked here"),
      );
    else if (def.kind === "boolean" && typeof a.value !== "boolean")
      out.push(def.label + ": answer yes, no or needs information");
  }
  if (facts.art6_3Derogation === true && facts.annexIIIProfiling === true)
    out.push(
      "The Art 6(3) derogation cannot apply to an Annex III system that profiles natural persons",
    );
  if (c.annexRoute === "Article 50 only") {
    if (!roles.provider && !roles.deployer)
      out.push(
        "Art 50 addresses providers and deployers; an importer or distributor cannot take the Article 50 only route",
      );
    else if (
      art50Assessment({ ...c, status: "provisional" }, rules).every((r) =>
        ["not_triggered", "role_not_held"].includes(r.status),
      )
    )
      out.push(
        "The Article 50 only route needs an Art 50 trigger that is not answered no",
      );
  }
  if (roles.provider && roles.deployer) {
    const media = [
      "generatesSyntheticImage",
      "generatesSyntheticAudio",
      "generatesSyntheticVideo",
    ].map((f) => factTruth(facts, f));
    if (
      facts.deployerGeneratesDeepFakes === true &&
      media.every((t) => t === false)
    )
      out.push(
        "Deep fakes need image, audio or video output, but the system generates none",
      );
    if (
      facts.deployerPublishesAiTextOnPublicInterest === true &&
      facts.generatesSyntheticText === false
    )
      out.push(
        "Published AI-generated text needs text output, but the system generates none",
      );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recording, approval, migration and re-review.

export class ClassificationError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("; "));
  }
}
export type ClassificationInput = {
  operatorRole: string;
  annexRoute: string;
  intendedPurpose: string;
  rationale: string;
  /** "yes", "no" or "unknown"; a date or ""; an enumeration value or "unknown". */
  facts: Record<string, string>;
  evidence?: Record<string, string>;
  checkedOn?: Record<string, string>;
  derogation?: { rationale?: string; registrationEvidence?: string };
};
const isoDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const historyLimit = 50;
const pushHistory = (c: Classification, event: ClassificationEvent) =>
  [...(c.history ?? []), event].slice(-historyLimit);

/**
 * A new provisional classification from the guided form. Each answer keeps
 * the stamp it was first given under while its value is unchanged; changed
 * answers are stamped with the current legal version. Throws a
 * ClassificationError listing invalid values and contradictions.
 */
export function recordClassification(
  previous: Classification,
  input: ClassificationInput,
  { rules, user, at }: { rules: ClassificationRules; user: string; at: string },
): Classification {
  const defs = new Map(factDefinitions(rules).map((d) => [d.id, d])),
    problems: string[] = [],
    answers: Record<string, Answer> = {};
  if (!(operatorRoles as readonly string[]).includes(input.operatorRole))
    problems.push("Choose an operator role from the list");
  if (!(annexRoutes as readonly string[]).includes(input.annexRoute))
    problems.push("Choose a classification route from the list");
  for (const [id, raw] of Object.entries(input.facts)) {
    const def = defs.get(id);
    if (!def) {
      problems.push("Unknown fact " + id);
      continue;
    }
    const v = raw.trim();
    let value: FactValue | undefined;
    if (def.kind === "boolean") {
      if (v === "yes") value = true;
      else if (v === "no") value = false;
      else if (v !== "unknown")
        problems.push(def.label + ": answer yes, no or needs information");
    } else if (def.kind === "date") {
      if (v && v !== "unknown") {
        if (isoDate(v)) value = v;
        else problems.push(def.label + ": enter a date as YYYY-MM-DD");
      }
    } else if (v !== "unknown") {
      if (def.values?.some((x) => x.value === v)) value = v;
      else problems.push(def.label + ": choose a listed value");
    }
    if (value === undefined) continue;
    const evidence =
        value === true && def.exception
          ? input.evidence?.[id]?.trim().slice(0, 500) || undefined
          : undefined,
      checkedOn =
        value === true && def.checkedOn
          ? input.checkedOn?.[id]?.trim() || undefined
          : undefined;
    if (checkedOn && !isoDate(checkedOn))
      problems.push(def.label + ": enter the date checked as YYYY-MM-DD");
    const before = previous.answers?.[id];
    answers[id] =
      before &&
      before.value === value &&
      before.evidence === evidence &&
      before.checkedOn === checkedOn
        ? before
        : {
            value,
            ...(evidence ? { evidence } : {}),
            ...(checkedOn ? { checkedOn } : {}),
            legalVersion: rules.legalVersion,
            rulePackVersion: rules.rulePackVersion,
            answeredAt: at,
            answeredBy: user,
          };
  }
  const draft = {
    operatorRole: input.operatorRole,
    annexRoute: input.annexRoute,
    answers,
  };
  problems.push(...contradictions(draft, rules));
  if (problems.length) throw new ClassificationError([...new Set(problems)]);
  const derogation =
    answers.art6_3Derogation?.value === true
      ? {
          rationale: input.derogation?.rationale?.trim().slice(0, 5000) ?? "",
          registrationEvidence:
            input.derogation?.registrationEvidence?.trim().slice(0, 500) ?? "",
        }
      : undefined;
  const next: Classification = {
    ...previous,
    model: 2,
    operatorRole: input.operatorRole,
    annexRoute: input.annexRoute,
    intendedPurpose: input.intendedPurpose,
    rationale: input.rationale,
    answers,
    derogation,
    status: "provisional",
    approvedBy: undefined,
    approvedAt: undefined,
    // version and asOf stay the engagement's pinned legal version (#18);
    // each answer carries the legal version it was given under.
    rulePackVersion: rules.rulePackVersion,
    guidance: rules.guidance.map((g) => ({ ...g })),
  };
  return derive(next, rules, {
    action: "classified",
    at,
    by: user,
  });
}
function derive(
  c: Classification,
  rules: ClassificationRules,
  event: Omit<
    ClassificationEvent,
    "label" | "legalVersion" | "rulePackVersion"
  >,
): Classification {
  const assessment = assess(c, rules),
    facts = classificationFactValues(c);
  const next: Classification = {
    ...c,
    assessment,
    prohibited: assessment.label === "Prohibited",
    highRisk: ["annex_iii", "annex_i_section_a", "annex_i_section_b"].includes(
      assessment.highRiskRoute,
    ),
    transparency: assessment.art50.some((r) => r.status === "candidate"),
    profiling: facts.annexIIIProfiling === true,
  };
  next.history = pushHistory(c, {
    ...event,
    label: assessment.label,
    legalVersion: c.version,
    rulePackVersion: rules.rulePackVersion,
  });
  return next;
}
/**
 * The independent approval: refused while the route is unassessed, a
 * required fact is unknown, an exception lacks evidence or a contradiction
 * remains. The assessment is recomputed with the current rules.
 */
export function approveClassification(
  c: Classification,
  { rules, user, at }: { rules: ClassificationRules; user: string; at: string },
): Classification {
  const blockers = approvalBlockers(c, rules);
  if (blockers.length) throw new ClassificationError(blockers);
  return derive(
    { ...c, status: "approved", approvedBy: user, approvedAt: at },
    rules,
    { action: "approved", at, by: user },
  );
}
/**
 * A classification recorded before #19 becomes a tri-state classification
 * with every fact unknown. Its approval rested on four booleans, so it no
 * longer stands: the record keeps it under `legacy` and in the history, the
 * audit trail keeps the approval event, and the classification needs new
 * answers and a new independent approval.
 */
export function migrateClassification(c: Classification): Classification {
  if (c.model === 2) return c;
  const legacy: LegacyClassification = {
    status: c.status,
    ...(c.approvedBy ? { approvedBy: c.approvedBy } : {}),
    prohibited: !!c.prohibited,
    highRisk: !!c.highRisk,
    transparency: !!c.transparency,
    profiling: !!c.profiling,
    version: c.version,
    asOf: c.asOf,
  };
  return {
    ...c,
    model: 2,
    answers: {},
    prohibited: false,
    highRisk: false,
    transparency: false,
    profiling: false,
    status: "provisional",
    approvedBy: undefined,
    legacy,
    history:
      c.status === "approved"
        ? [
            {
              action: "approved_v1",
              by: c.approvedBy,
              label: "Approved under the four-flag classification",
              legalVersion: c.version,
            },
          ]
        : [],
  };
}

export type ReReviewTrigger = {
  id: string;
  title: string;
  basis: string;
  /** due: re-review now; scheduled: from `date`; watch: no date announced. */
  state: "due" | "scheduled" | "watch";
  date?: string;
};
export const art6GuidelinesId = "GUID-ART6-HIGH-RISK-CLASSIFICATION";
/** The Code of Practice is reviewed at least every two years (A50-ED-07). */
export const codeReviewDue = "2028-06-10";
/** Code Measure 3.4(c): interoperable watermark detection (TL-13). */
export const interoperabilityMilestone = "2027-02-02";
/**
 * When the classification must be reviewed again: final Art 6 guidelines
 * (the classification cited the draft), a review of the Art 50 guidelines,
 * a Code update, the 2 February 2027 interoperability milestone, and a new
 * rule pack.
 */
export function reReviewTriggers(
  c: Classification,
  rules: ClassificationRules,
  today: string,
): ReReviewTrigger[] {
  const roles = roleFlags(c.operatorRole),
    facts = classificationFactValues(c),
    cited = c.guidance?.find((g) => g.id === art6GuidelinesId),
    current = rules.guidance.find((g) => g.id === art6GuidelinesId),
    dated = (date: string): ReReviewTrigger["state"] =>
      today >= date ? "due" : "scheduled",
    out: ReReviewTrigger[] = [];
  if (current)
    out.push({
      id: "art6-guidelines-final",
      title: "Final Commission guidelines on high-risk classification",
      basis:
        (cited ?? current).title +
        ": cited as " +
        (cited ?? current).status +
        (cited && cited.status !== current.status
          ? "; now " + current.status
          : ""),
      state: cited && cited.status !== current.status ? "due" : "watch",
    });
  if (roles.provider || roles.deployer) {
    out.push({
      id: "art50-guidelines-review",
      title: "Commission review of the Art 50 guidelines",
      basis:
        "C(2026) 7702 final, point 155; the Art 50 guidelines rely on the Art 6 guidelines for emotion recognition and biometric categorisation",
      state: "watch",
    });
    out.push({
      id: "code-update",
      title: "Update of the Code of Practice on transparency",
      basis: "Reviewed at least every two years after the final Code",
      state: dated(codeReviewDue),
      date: codeReviewDue,
    });
  }
  if (roles.provider && facts.generatesSyntheticContent !== false)
    out.push({
      id: "interoperability-2027",
      title: "Interoperable watermark detection (Code Measure 3.4(c))",
      basis: "Code milestone for signatories; not a statutory date",
      state: dated(interoperabilityMilestone),
      date: interoperabilityMilestone,
    });
  if (c.rulePackVersion && c.rulePackVersion !== rules.rulePackVersion)
    out.push({
      id: "rule-pack",
      title: "New rule pack " + rules.rulePackVersion,
      basis: "Classified under rule pack " + c.rulePackVersion,
      state: "due",
    });
  return out;
}
