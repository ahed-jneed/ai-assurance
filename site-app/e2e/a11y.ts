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

// Empty since #36 fixed the workspace's WCAG AA failures (F-46). A new entry
// needs the issue that fixes it, a reason, and a scope.
export const TRACKED_EXCEPTIONS: Exception[] = [];

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
 * Runs axe on the whole page, an open dialog included, and fails on serious
 * or critical violations.
 */
export async function expectAccessible(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
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
