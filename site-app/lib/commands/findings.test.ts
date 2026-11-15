// closeFinding names the rule that applies to the person who is refused
// (#241): after an effective retest it is the closer's independence.
import { describe, expect, it } from "vitest";
import type { Finding } from "../domain/types";
import { ApiError } from "../http";
import { findings } from "./findings";
import { caller, stored } from "./test-fixtures";

const finding = (overrides: Partial<Finding> = {}): Finding =>
  ({
    id: "F-1",
    status: "ready_for_retest",
    remediation: "Sampling frame now covers online applicants",
    retestEvidenceIds: ["A-1"],
    createdBy: "user-auditor",
    remediationBy: "user-lead",
    ...overrides,
  }) as unknown as Finding;

async function refusal(f: Finding) {
  const e = stored();
  e.findings = [f];
  try {
    await findings.run(e, "closeFinding", { findingId: f.id }, caller());
  } catch (error) {
    if (error instanceof ApiError) return [error.status, error.message];
    throw error;
  }
  return [200, ""];
}

describe("closeFinding refusals", () => {
  const effective = {
    conclusion: "effective",
    evidenceIds: ["A-1"],
  } as Finding["retest"];

  it("names the closer's independence once the retest is effective", async () => {
    for (const f of [
      finding({ retest: effective }),
      finding({
        retest: effective,
        createdBy: "user-lead",
        remediationBy: "user-mgmt",
      }),
    ])
      expect(await refusal(f)).toEqual([
        403,
        "The finding's creator or remediator cannot close it",
      ]);
  });

  it("still asks for the independent retest before one is on record", async () => {
    expect(await refusal(finding())).toEqual([
      403,
      "Independent retest confirmation is required",
    ]);
  });
});
