// The loading placeholders of the workspace (#135): an element with an
// aria-label needs a role that allows one (axe "aria-prohibited-attr"), so
// both placeholders are live status regions.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { panelFallback, workspaceFallback } from "./panels";

describe("loading placeholders", () => {
  it.each([
    ["the workspace shell", workspaceFallback, "Loading workspace"],
    ["a code-split panel", panelFallback, "Loading"],
  ])("%s has a status role with its label", (_, element, label) => {
    const html = renderToStaticMarkup(element);
    expect(html).toMatch(/^<div class="loading-grid" role="status"/);
    expect(html).toContain(`aria-label="${label}"`);
  });
});
