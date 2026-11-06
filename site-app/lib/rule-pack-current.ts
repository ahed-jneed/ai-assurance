// The rule pack this build serves (#18): templates/catalog.json as the Site
// imports it. New engagements are stamped with it, and captured report
// snapshots and runs record it with the methodology version.
import catalog from "./catalog.json";
import type { RulePackStamp } from "./domain";
import { rulePackStamp } from "./rule-pack";

export const methodologyVersion: string = catalog.methodologyVersion;
export const currentRulePack: RulePackStamp = rulePackStamp(catalog);

/** What a captured record states about the rules it was made under. */
export function recordVersions(): {
  rulePack: RulePackStamp;
  methodologyVersion: string;
} {
  return { rulePack: { ...currentRulePack }, methodologyVersion };
}
