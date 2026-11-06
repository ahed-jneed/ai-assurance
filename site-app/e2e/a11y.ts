// Accessibility checks with axe-core. Serious and critical violations fail the
// spec. A known violation may be listed in TRACKED_EXCEPTIONS with the issue
// that tracks its fix; it is then reported as an `a11y-exception` annotation in
// the report instead of failing. Never skip a check silently.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Exception = {
  /** The axe rule id, for example "color-contrast". */
  rule: string;
  /** The tracking issue, for example "#80". */
  issue: string;
  /** Why the violation is accepted for now. */
  reason: string;
};

// #36 (F-46) fixes the workspace's WCAG AA failures and removes these entries;
// its acceptance criterion is that this list is empty.
export const TRACKED_EXCEPTIONS: Exception[] = [
  {
    rule: "color-contrast",
    issue: "#36",
    reason:
      "Secondary text, tab triggers, toasts, stat labels and summaries below 4.5:1 (F-46).",
  },
  {
    rule: "label-content-name-mismatch",
    issue: "#36",
    reason:
      "The sidebar's workspace, search and engagement-switcher buttons have an aria-label that omits their visible text.",
  },
];

const BLOCKING = new Set(["serious", "critical"]);

/** Runs axe on the page and fails on serious or critical violations. */
export async function expectAccessible(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  // E2E_A11Y_SURVEY=1 prints every blocking violation, tracked or not, without
  // failing, to review the exception list.
  const survey = !!process.env.E2E_A11Y_SURVEY;
  const untracked = [];
  for (const v of violations.filter((v) => BLOCKING.has(v.impact ?? ""))) {
    const exception = survey
      ? undefined
      : TRACKED_EXCEPTIONS.find((e) => e.rule === v.id);
    if (exception)
      test.info().annotations.push({
        type: "a11y-exception",
        description: `${label}: ${v.id} (${v.nodes.length} nodes), tracked in ${exception.issue}`,
      });
    else
      untracked.push({
        rule: v.id,
        impact: v.impact,
        help: v.help,
        targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
      });
  }
  if (survey) {
    if (untracked.length)
      console.log(`[a11y] ${label}: ${JSON.stringify(untracked, null, 1)}`);
    return;
  }
  expect(untracked, `${label}: serious or critical axe violations`).toEqual([]);
}
