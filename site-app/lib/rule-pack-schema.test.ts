import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkRulePack,
  loadInputs,
  loadValidator,
  mutations,
} from "../../schemas/validate-rule-pack.mjs";

// The rule-pack check of schemas/validate-rule-pack.mjs (CI runs it too):
// schema, id and reference resolution, legal-review flags and approvals,
// predicates and agreement with the verified research.
const validate = loadValidator();
const local = (file: string) => fileURLToPath(new URL(file, import.meta.url));

describe("rule-pack schema check", () => {
  it("accepts the canonical rule pack", () => {
    expect(checkRulePack({ ...loadInputs(), validate })).toEqual([]);
  });

  it("accepts the copies the Site imports", () => {
    const inputs = loadInputs({
      catalog: local("./catalog.json"),
      obligations: local("./obligation-subitems.json"),
      annexMap: local("./annex-iv-map.json"),
    });
    expect(checkRulePack({ ...inputs, validate })).toEqual([]);
  });

  it.each(mutations as [string, (pack: Record<string, unknown>) => void][])(
    "rejects a rule pack with %s",
    (_, mutate) => {
      const inputs = loadInputs();
      const catalog = structuredClone(inputs.catalog);
      mutate(catalog.regulatorySnapshot);
      expect(checkRulePack({ ...inputs, catalog, validate })).not.toEqual([]);
    },
  );
});
