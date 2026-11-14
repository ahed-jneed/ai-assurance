// The approval precondition the acceptance panel and the approveAcceptance
// command share (#221, D-28): the panel disables Approve with exactly the
// reason the server refuses with, naming the conflicted team member.
import { describe, expect, it } from "vitest";
import type { Engagement } from "../domain/types";
import { seedWorkflow } from "../workflow-seed";
import { resolveNew } from "../criteria/pin";
import { approvalRefusal, conflictedTeam } from "./acceptance";
import {
  approvedWorkflow,
  at,
  command,
  declaration,
  displayNames,
  engagement,
  expectFailure,
  procedureId,
  workflowOf,
} from "./test-fixtures";

const nameOf = (id: string) => displayNames[id] ?? id;

/** A Planning engagement whose acceptance record is a draft to approve. */
function draft(): Engagement {
  const e = engagement({
    workflow: approvedWorkflow([
      {
        ...seedWorkflow(resolveNew(), "lead", at).procedures.find(
          (p) => p.id === procedureId,
        )!,
        selected: true,
        applicability: "applicable",
        ownerId: "auditor",
        reviewerId: "reviewer",
      },
    ]),
  });
  const a = workflowOf(e).acceptance!;
  a.status = "draft";
  delete a.approval;
  return e;
}
const approve = (e: Engagement) =>
  command(
    e,
    "approveAcceptance",
    { revision: workflowOf(e).acceptance!.revision, reason: "Accepted" },
    "lead",
  );

describe("the acceptance approval precondition (#221)", () => {
  it("names a team member with a standing relationship, as the server refuses", async () => {
    const e = draft(),
      w = workflowOf(e);
    expect(approvalRefusal(w, "lead", nameOf)).toBeUndefined();
    w.declarations!.push(
      declaration("reviewer", {
        id: "DEC-reviewer-2",
        exclusions: ["employment"],
      }),
    );
    const refusal = approvalRefusal(w, "lead", nameOf);
    expect(refusal).toEqual({
      status: 409,
      message:
        "Riley Reviewer declared a disqualifying relationship with the engagement; remove them from the team before accepting it",
    });
    expect(conflictedTeam(w)).toEqual(["reviewer"]);
    await expectFailure(approve(e), refusal!.status, refusal!.message);
  });

  it("names a team member with an unresolved threat, as the server refuses", async () => {
    const e = draft(),
      w = workflowOf(e);
    w.declarations!.push(
      declaration("auditor", {
        id: "DEC-auditor-2",
        threats: [
          {
            kind: "familiarity",
            description: "Former colleague of the model owner",
            safeguards: "",
          },
        ],
      }),
    );
    const refusal = approvalRefusal(w, "lead", nameOf)!;
    expect(refusal.message).toBe(
      "Avery Auditor declared an independence threat that nobody has resolved; resolve it before accepting the engagement",
    );
    await expectFailure(approve(e), refusal.status, refusal.message);
  });

  it("gives the server's reason for an approver off the team or an unmet precondition", async () => {
    const e = draft(),
      w = workflowOf(e),
      a = w.acceptance!;
    a.team = a.team.filter((id) => id !== "lead");
    const off = approvalRefusal(w, "lead", nameOf)!;
    expect(off).toEqual({
      status: 400,
      message: "Name yourself on the engagement team before accepting it",
    });
    await expectFailure(approve(e), off.status, off.message);
    a.team.push("lead");
    const [first] = Object.keys(
      a.preconditions,
    ) as (keyof typeof a.preconditions)[];
    a.preconditions[first].met = false;
    const unmet = approvalRefusal(w, "lead", nameOf)!;
    expect(unmet).toEqual({
      status: 400,
      message:
        "Every ISAE 3000 precondition must be met before the engagement is accepted",
    });
    await expectFailure(approve(e), unmet.status, unmet.message);
  });
});
