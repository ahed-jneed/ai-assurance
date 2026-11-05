import { articleNames, type Engagement } from "@/lib/domain";

/** Signed coverage of the required papers that cite each tracked article. */
export function articleCoverage(e: Engagement | null | undefined) {
  return Object.entries(articleNames).map(([article, title]) => {
    const papers =
      e?.papers.filter(
        (p) =>
          p.required &&
          p.articleRefs.some((r) =>
            new RegExp(
              "(?:Art\\.?|Article)\\s*" + article + "(?:\\D|$)",
              "i",
            ).test(r),
          ),
      ) ?? [];
    const signed = papers.filter((p) => p.status === "signed").length;
    return {
      article,
      title,
      papers,
      signed,
      coverage: papers.length ? Math.round((signed / papers.length) * 100) : 0,
    };
  });
}
export type ArticleCoverage = ReturnType<typeof articleCoverage>[number];
