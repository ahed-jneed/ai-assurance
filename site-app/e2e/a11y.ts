// Accessibility checks with axe-core. Serious and critical violations fail the
// spec. A known violation may be listed in TRACKED_EXCEPTIONS with the issue
// that tracks its fix; within the exception's scope it is then reported as an
// `a11y-exception` annotation in the report instead of failing. Never skip a
// check silently.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Exception = {
  /** The axe rule id, for example "color-contrast". */
  rule: string;
  /** The tracking issue, for example "#80". */
  issue: string;
  /** Why the violation is accepted for now. */
  reason: string;
  /**
   * A CSS selector every failing element must match. A failing element outside
   * it is not covered by the exception, so the check fails.
   */
  selector?: string;
  /**
   * The most failing elements one check may have. A check with more fails, so
   * a new violation of the rule does not hide behind the exception.
   */
  maxNodes: number;
};

// #36 (F-46) fixes the workspace's WCAG AA failures and removes these entries;
// its acceptance criterion is that this list is empty.
export const TRACKED_EXCEPTIONS: Exception[] = [
  {
    rule: "color-contrast",
    issue: "#36",
    reason:
      "Secondary text, tab triggers, toasts, stat labels and summaries below 4.5:1 (F-46).",
    // The working paper review has the most (12 in a fresh run); its evidence
    // choices grow when a reused server keeps earlier runs' records.
    maxNodes: 20,
  },
  {
    rule: "label-content-name-mismatch",
    issue: "#36",
    reason:
      "The sidebar's workspace, search and engagement-switcher buttons, and an evidence request's More actions button, have an aria-label that omits their visible text.",
    selector:
      '.nav-workspace, .nav-search, .nav-engagement, [aria-label="More request actions"]',
    maxNodes: 4,
  },
];

const BLOCKING = new Set(["serious", "critical"]);

/** Whether every failing element of a violation lies in the exception's scope. */
async function inScope(page: Page, exception: Exception, targets: string[]) {
  if (targets.length > exception.maxNodes) return false;
  const selector = exception.selector;
  if (!selector) return true;
  return page.evaluate(
    ({ targets, selector }) =>
      targets.every((t) => !!document.querySelector(t)?.matches(selector)),
    { targets, selector },
  );
}

/**
 * Runs axe on the page and fails on serious or critical violations. With
 * `include`, a CSS selector, only that part of the page is checked: a modal
 * dialog, whose page behind it the spec has already checked.
 */
export async function expectAccessible(
  page: Page,
  label: string,
  { include }: { include?: string } = {},
) {
  const builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "wcag22aa",
  ]);
  const { violations } = await (
    include ? builder.include(include) : builder
  ).analyze();
  // E2E_A11Y_SURVEY=1 prints every blocking violation, tracked or not, without
  // failing, to review the exception list.
  const survey = !!process.env.E2E_A11Y_SURVEY;
  const untracked = [];
  for (const v of violations.filter((v) => BLOCKING.has(v.impact ?? ""))) {
    const targets = v.nodes.map((n) => n.target.join(" "));
    const candidate = survey
      ? undefined
      : TRACKED_EXCEPTIONS.find((e) => e.rule === v.id);
    const exception =
      candidate && (await inScope(page, candidate, targets))
        ? candidate
        : undefined;
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
        nodes: v.nodes.length,
        outsideTrackedException: candidate?.issue ?? null,
        targets: targets.slice(0, 5),
      });
  }
  if (survey) {
    if (untracked.length)
      console.log(`[a11y] ${label}: ${JSON.stringify(untracked, null, 1)}`);
    return;
  }
  expect(untracked, `${label}: serious or critical axe violations`).toEqual([]);
}
