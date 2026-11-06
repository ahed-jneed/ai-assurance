// The test criteria a catalog item starts a procedure or paper with. Items
// built from a research file's procedures (the Art 50 papers WP-XC-07 and
// WP-XC-10 to WP-XC-12, A50-ED-20 to A50-ED-22) carry each procedure's pass,
// fail and inconclusive criteria; others cite their regulatory references.

/** A research procedure a catalog item's steps come from. */
export type ResearchProcedure = {
  procedureId: string;
  title: string;
  /** The obligation items (docs/obligation-subitems.json) it tests. */
  items: string[];
  /** How many of the item's steps it contributes, in order. */
  steps: number;
  criterionIds: string[];
  pass: string[];
  fail: string[];
  inconclusive: string[];
  legalReviewItemIds: string[];
};
export type CriteriaTemplate = {
  regulatoryRefs: string[];
  researchProcedures?: { data: string; procedures: ResearchProcedure[] };
};

/** The criterion text: the references, then each procedure's criteria. */
export function templateCriterion(t: CriteriaTemplate): string {
  const refs = t.regulatoryRefs.join("; ");
  const procedures = t.researchProcedures?.procedures ?? [];
  if (!procedures.length) return refs;
  return [
    refs + " (criteria from " + t.researchProcedures!.data + ")",
    ...procedures.map((p) =>
      [
        p.procedureId +
          " " +
          p.title +
          (p.items.length ? ", for " + p.items.join(", ") : "") +
          ".",
        "Pass: " + p.pass.join(" "),
        "Fail: " + p.fail.join(" "),
        "Inconclusive: " + p.inconclusive.join(" "),
        ...(p.legalReviewItemIds.length
          ? ["Pending legal review: " + p.legalReviewItemIds.join(", ") + "."]
          : []),
      ].join("\n"),
    ),
  ].join("\n\n");
}
