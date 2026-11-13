// Requirement-level applicability rows derived from the dated entries of the
// pinned rule pack (#18, docs/design/criteria-model.md sections 5.1 and 11.1).
// The rule pack dates provisions ("Art 50(2)", "Chapter III Section 2 (Arts 8
// to 15)"); this module maps each provision to the framework's requirement
// nodes by its article, paragraph and annex numbers. The dates are the rule
// pack's, but the mapping is automatic and nobody has reviewed it, so every
// row says it is derived and not reviewed. Rows inform review only: they never
// approve applicability and never change a coverage state. Pure: no registry.
import type { ApplicabilityRow, FrameworkDocument } from "./types";

/** A dated entry of the rule pack, as `regulatorySnapshot.applicationDates` holds it. */
export type DatedEntry = {
  id: string;
  title: string;
  date: string;
  dateType: string;
  provisions: string[];
  legalBasis?: { reference?: string };
  verification?: { status?: string; verifiedOn?: string };
  legalReview?: { required?: boolean; itemIds?: string[] };
};
/** The parts of a rule pack the derivation reads. */
export type DatedSnapshot = {
  rulePackVersion: string;
  celex: string;
  research?: { data?: string };
  applicationDates: DatedEntry[];
};

export type DerivedApplicabilityRow = ApplicabilityRow & {
  derived: {
    /** The rule pack entry the date comes from. */
    entryId: string;
    rulePackVersion: string;
    dateType: string;
    /** The provision of the entry that was mapped to this requirement. */
    provision: string;
    /** Always false: nobody has reviewed the automatic mapping. */
    reviewed: false;
  };
  /** Set on a requirement that inherits the row from a group above it. */
  inheritedFrom?: string;
};

/** A provision reduced to the article (or annex) and paragraphs it names. */
export type ProvisionTarget =
  | { kind: "article"; article: string; paragraphs: string[] }
  | { kind: "annex"; annex: string };

const OWN_ACT = "2024/1689";
const range = (from: string, to: string) => {
  const a = Number(from),
    b = Number(to);
  return Number.isInteger(a) && Number.isInteger(b) && a <= b && b - a <= 200
    ? Array.from({ length: b - a + 1 }, (_, i) => String(a + i))
    : [from, to];
};

/**
 * The articles, paragraphs and annexes a rule-pack provision names. A
 * provision of another act ("Regulation (EU) 2026/1744, Art 4") names none,
 * and the part after "except" or "not covered by" is a carve-out or a cross
 * reference, not a target.
 */
export function provisionTargets(provision: string): ProvisionTarget[] {
  const acts = [...provision.matchAll(/Regulation \(EU\) (\d{4}\/\d+)/g)];
  if (acts.some((m) => m[1] !== OWN_ACT)) return [];
  // A deleted provision is not dated as applying.
  if (/\bdeleted\b/.test(provision)) return [];
  const text = provision.split(/,?\s*\b(?:except|not covered by)\b/)[0];
  const targets: ProvisionTarget[] = [];
  const add = (article: string, paragraphs: string[] = []) => {
    const known = targets.find(
      (t) => t.kind === "article" && t.article === article,
    ) as Extract<ProvisionTarget, { kind: "article" }> | undefined;
    if (!known) targets.push({ kind: "article", article, paragraphs });
    else if (known.paragraphs.length && paragraphs.length)
      known.paragraphs.push(
        ...paragraphs.filter((p) => !known.paragraphs.includes(p)),
      );
    // An article named without a paragraph covers all of it.
    else known.paragraphs = [];
  };
  for (const m of text.matchAll(/\bArts (\d+[a-z]?) (to|and) (\d+[a-z]?)\b/g)) {
    const [, from, op, to] = m;
    for (const a of op === "to" ? range(from, to) : [from, to]) add(a);
  }
  for (const m of text.matchAll(
    /\bArt (\d+[a-z]?)(?:\((\d+[a-z]?)\)(?:\s+(to|and)\s+\((\d+[a-z]?)\))?)?/g,
  )) {
    const [, article, p, op, q] = m;
    const paragraphs = !p ? [] : !q ? [p] : op === "to" ? range(p, q) : [p, q];
    add(article, paragraphs);
  }
  for (const m of text.matchAll(/\bAnnex ([IVXL]+)\b/g))
    if (!targets.some((t) => t.kind === "annex" && t.annex === m[1]))
      targets.push({ kind: "annex", annex: m[1] });
  return targets;
}

/** Whether a node ref starts with the given prefix as a whole token ("Art. 9(1)" but not "Art. 9(10)"). */
const refStarts = (ref: string, prefix: string) =>
  ref === prefix ||
  (ref.startsWith(prefix) && !/[0-9A-Za-z]/.test(ref[prefix.length]));

/**
 * The node ids a provision maps to: the paragraph nodes it names where the
 * framework has them, otherwise the article (or annex) node.
 */
function nodesFor(fw: FrameworkDocument, target: ProvisionTarget): string[] {
  if (target.kind === "annex") {
    const node = fw.requirements.find((n) => n.ref === "Annex " + target.annex);
    return node ? [node.id] : [];
  }
  const article = fw.requirements.find(
    (n) => n.ref === "Art. " + target.article,
  );
  const ids = new Set<string>();
  for (const p of target.paragraphs) {
    const prefix = `Art. ${target.article}(${p})`;
    for (const n of fw.requirements)
      if (refStarts(n.ref, prefix)) ids.add(n.id);
  }
  // No paragraph node: the article is the closest level the framework has.
  // When some paragraphs have nodes, the others are not spread to the whole
  // article (and so to every subitem).
  if (!ids.size && article) ids.add(article.id);
  return [...ids];
}

/** Whether a rule pack dates the provisions of this framework edition. */
export function datesFramework(
  fw: Pick<FrameworkDocument, "edition" | "kind">,
  snapshot: DatedSnapshot | null,
): snapshot is DatedSnapshot {
  return (
    !!snapshot &&
    fw.kind === "legislation" &&
    snapshot.celex === fw.edition &&
    Array.isArray(snapshot.applicationDates)
  );
}

/**
 * The derived rows of each node the rule pack's provisions map to, in date
 * order, and the provisions that map to no node of the framework (for review).
 */
export function deriveApplicability(
  fw: FrameworkDocument,
  snapshot: DatedSnapshot,
): {
  rows: Map<string, DerivedApplicabilityRow[]>;
  unmapped: { entryId: string; provision: string }[];
} {
  const rows = new Map<string, DerivedApplicabilityRow[]>();
  const unmapped: { entryId: string; provision: string }[] = [];
  const entries = [...snapshot.applicationDates].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  for (const entry of entries) {
    for (const provision of entry.provisions) {
      const ids = [
        ...new Set(provisionTargets(provision).flatMap((t) => nodesFor(fw, t))),
      ];
      if (!ids.length) {
        unmapped.push({ entryId: entry.id, provision });
        continue;
      }
      for (const id of ids) {
        const own = rows.get(id) ?? [];
        // One row per entry and node: the first provision that maps it.
        if (own.some((r) => r.derived.entryId === entry.id)) continue;
        own.push(derivedRow(entry, provision, snapshot));
        rows.set(id, own);
      }
    }
  }
  return { rows, unmapped };
}

function derivedRow(
  entry: DatedEntry,
  provision: string,
  snapshot: DatedSnapshot,
): DerivedApplicabilityRow {
  const verified =
    entry.verification?.status === "verified"
      ? `The date was verified on ${entry.verification.verifiedOn}`
      : "The date is not verified";
  return {
    from: entry.date,
    until: null,
    condition: entry.title,
    ...(entry.legalBasis?.reference
      ? { legalRef: entry.legalBasis.reference }
      : {}),
    provenance: {
      source:
        (snapshot.research?.data ?? "rule pack " + snapshot.rulePackVersion) +
        "#" +
        entry.id,
      sourceKind: "rule_pack_entry",
      verification: "unverified",
      legalReview: "required",
      note: `Derived from rule pack ${snapshot.rulePackVersion} entry ${entry.id} (${provision}). ${verified}; the mapping of its provisions to this requirement is automatic and has not been reviewed.`,
    },
    derived: {
      entryId: entry.id,
      rulePackVersion: snapshot.rulePackVersion,
      dateType: entry.dateType,
      provision,
      reviewed: false,
    },
  };
}

/**
 * The derived rows that reach a node: its own, then those of each group above
 * it (marked with the group's ref), one row per entry, in date order.
 */
export function effectiveRows(
  fw: Pick<FrameworkDocument, "requirements">,
  rows: Map<string, DerivedApplicabilityRow[]>,
  id: string,
): DerivedApplicabilityRow[] {
  const byId = new Map(fw.requirements.map((n) => [n.id, n]));
  const out: DerivedApplicabilityRow[] = [];
  const seen = new Set<string>();
  for (
    let node = byId.get(id), first = true;
    node;
    node = node.parent ? byId.get(node.parent) : undefined, first = false
  )
    for (const r of rows.get(node.id) ?? []) {
      if (seen.has(r.derived.entryId)) continue;
      seen.add(r.derived.entryId);
      out.push(first ? r : { ...r, inheritedFrom: node.ref });
    }
  return out.sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.derived.entryId.localeCompare(b.derived.entryId),
  );
}
