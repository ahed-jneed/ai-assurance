/* eslint-disable @typescript-eslint/no-explicit-any -- the fixtures are partial records, as the workspace receives them. */
// Procedure and paper handoffs of the work queue: independent review,
// current scope and execution, comment handoffs, sign-off eligibility and
// evaluation prerequisites. Ported from scripts/work-items-check.mjs (#52);
// its local-calendar checks are in work-items.local-calendar.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { engagementWork, procedureWork, orderWork } from "./work-items";
import { at, fixture, today } from "./work-items.test-fixture";

function reviewed() {
  const e = fixture(),
    p = e.workflow.procedures[0],
    paper = e.papers[0];
  p.state = "reviewed";
  p.review = { revision: 4, userId: "reviewer", at };
  paper.status = "reviewed";
  paper.reviews = [{ revision: 2, userId: "reviewer", at }];
  return e;
}
function work(e = fixture(), role: any = "Reviewer", userId = "reviewer") {
  return engagementWork(e, role, userId, "Client", today);
}
const procedure = (e: any, role: string, userId: string): any =>
  work(e, role, userId).find((i) => i.kind === "procedure");
const questions = (e: any, role: string, userId: string): any =>
  work(e, role, userId).find((i) => i.kind === "paper");
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("work items (ported from work-items-check)", () => {
  it("assigned independent source review, paper contributor conflicts and scoped handoffs", async () => {
    const eligible = procedure(fixture(), "Reviewer", "reviewer");
    assert.equal(eligible.personal, true);
    assert.equal(eligible.state, "review");
    assert.equal(eligible.section, "review");
    assert.equal(eligible.ownerId, "reviewer");
    assert.equal(eligible.dueDate, "2026-10-09");
    assert.equal(eligible.engagementId, "engagement");
    assert.equal(
      procedure(fixture(), "Reviewer", "other-reviewer").personal,
      false,
    );
    assert.equal(
      procedure(fixture(), "Lead Auditor", "preparer").personal,
      false,
      "A contributing Lead cannot review their prepared work",
    );
    for (const contaminate of [
      (e: any) => {
        e.workflow.procedures[0].contributors.push("reviewer");
      },
      (e: any) => {
        e.papers[0].contributors.push("reviewer");
      },
      (e: any) => {
        e.papers[0].authorId = "reviewer";
      },
      (e: any) => {
        e.workflow.procedures[0].reviewerId = "preparer";
      },
      (e: any) => {
        e.workflow.procedures[0].reviewerId = "";
      },
    ]) {
      const e = fixture();
      contaminate(e);
      assert.equal(procedure(e, "Lead Auditor", "lead").state, "planning");
      assert.equal(
        procedure(e, "Reviewer", "reviewer").personal,
        false,
        "A reviewer independence/assignment conflict is a planning dependency",
      );
    }
  });

  it("current approved scope/program, execution bindings, compiled revision and accepted-evidence dependencies", async () => {
    for (const invalidate of [
      (e: any) => {
        e.workflow.brief.status = "submitted";
      },
      (e: any) => {
        e.workflow.program.status = "draft";
      },
      (e: any) => {
        e.workflow.program.briefRevision = 1;
      },
      (e: any) => {
        e.workflow.procedures[0].execution.briefRevision = 1;
      },
      (e: any) => {
        e.workflow.procedures[0].execution.procedureRevision = 3;
      },
      (e: any) => {
        e.workflow.procedures[0].execution = undefined;
      },
      (e: any) => {
        e.papers[0].revision = 3;
      },
      (e: any) => {
        e.papers[0].status = "draft";
      },
      (e: any) => {
        e.papers = [];
      },
      (e: any) => {
        e.artifacts[0].status = "quarantined";
      },
    ]) {
      const e = fixture();
      invalidate(e);
      const item = procedure(e, "Reviewer", "reviewer");
      assert.equal(
        item.state,
        "waiting",
        "Stale or incomplete submitted records cannot be promoted as ready review",
      );
    }
    const staleProgram = fixture();
    staleProgram.workflow.program.briefRevision = 1;
    assert.equal(
      work(staleProgram, "Lead Auditor", "lead").find(
        (i) => i.kind === "program",
      )!.action,
      "Reassess audit program",
    );
    const reassessed = fixture();
    reassessed.workflow.procedures[0].execution.briefRevision = 1;
    reassessed.workflow.procedures[0].execution.impactReview = {
      briefRevision: 2,
      programRevision: 3,
    };
    assert.equal(
      procedure(reassessed, "Reviewer", "reviewer").state,
      "review",
      "A valid independent scope impact assessment can reaffirm current execution",
    );
    const otherChange = fixture();
    otherChange.workflow.program.revision = 4;
    assert.equal(
      procedure(otherChange, "Reviewer", "reviewer").state,
      "review",
      "A program revision for another procedure's change keeps this execution current",
    );
  });

  it("direct comment handoffs, attributed responses and truthful waiting states", async () => {
    const comment = {
      id: "question",
      authorId: "reviewer",
      text: "Explain this exception",
      resolved: false,
      responses: [],
    };
    const open = fixture();
    open.papers[0].comments = [comment];
    assert.equal(
      procedure(open, "Reviewer", "reviewer"),
      undefined,
      "Questions have one paper handoff, not a duplicated procedure action",
    );
    assert.equal(questions(open, "Reviewer", "reviewer").state, "waiting");
    assert.equal(
      questions(open, "Reviewer", "reviewer").action,
      "Await a response",
    );
    assert.equal(
      questions(open, "Reviewer", "reviewer").module,
      "Working papers",
    );
    assert.equal(questions(open, "Reviewer", "reviewer").section, "review");
    assert.equal(questions(open, "Reviewer", "reviewer").dueDate, "2026-10-09");
    assert.equal(questions(open, "Auditor", "preparer").state, "ready");
    assert.equal(
      questions(open, "Auditor", "preparer").action,
      "Respond to questions",
    );
    assert.equal(questions(open, "Reviewer", "other-reviewer").personal, false);
    const responded = structuredClone(open);
    responded.papers[0].comments[0].responses.push({
      actor: "preparer",
      at,
      text: "Explanation provided",
    });
    assert.equal(questions(responded, "Reviewer", "reviewer").state, "review");
    assert.equal(
      questions(responded, "Reviewer", "reviewer").action,
      "Check responses",
    );
    const standalone = structuredClone(open);
    standalone.workflow.procedures = [];
    assert.equal(
      questions(standalone, "Reviewer", "reviewer").state,
      "waiting",
      "Unbound questions also await a response before resolution",
    );
    assert.equal(
      questions(standalone, "Reviewer", "reviewer").section,
      "review",
    );
  });

  it("revision-bound sign-off eligibility, review metadata and current completion", async () => {
    const oldReview = reviewed();
    oldReview.papers[0].reviews.unshift({ revision: 1, userId: "lead", at });
    assert.equal(
      procedure(oldReview, "Lead Auditor", "lead").personal,
      true,
      "An old review by this Lead does not bar signing a newer independently reviewed revision",
    );
    assert.equal(
      procedure(oldReview, "Lead Auditor", "lead").action,
      "Sign reviewed paper",
    );
    assert.equal(
      procedure(reviewed(), "Lead Auditor", "reviewer").personal,
      false,
      "The current independent reviewer cannot sign the same revision",
    );
    assert.equal(
      procedure(reviewed(), "Lead Auditor", "reviewer").state,
      "waiting",
    );
    assert.equal(
      procedure(reviewed(), "Lead Auditor", "preparer").personal,
      true,
      "A Lead preparer may sign after another independent reviewer",
    );
    for (const invalidate of [
      (e: any) => {
        e.workflow.procedures[0].review = undefined;
      },
      (e: any) => {
        e.workflow.procedures[0].review.revision = 3;
      },
      (e: any) => {
        e.workflow.procedures[0].review.userId = "unassigned";
      },
      (e: any) => {
        e.papers[0].reviews[0].revision = 1;
      },
      (e: any) => {
        e.papers[0].revision = 3;
      },
    ]) {
      const e = reviewed();
      invalidate(e);
      assert.equal(
        procedure(e, "Lead Auditor", "lead").state,
        "waiting",
        "Missing/obsolete independent review cannot enable sign-off",
      );
    }
    const signed = reviewed();
    signed.papers[0].status = "signed";
    assert.equal(procedureWork(signed, "procedure", today)!.complete, true);
    assert.equal(procedure(signed, "Lead Auditor", "lead"), undefined);
    const staleSigned = structuredClone(signed);
    staleSigned.papers[0].revision = 3;
    assert.equal(
      procedureWork(staleSigned, "procedure", today)!.complete,
      false,
    );
    assert.equal(
      procedure(staleSigned, "Lead Auditor", "lead").state,
      "waiting",
    );
  });

  it("evaluation prerequisites, outstanding requests, client-role restrictions and nonmutation", async () => {
    const execution = fixture();
    execution.workflow.procedures[0].state = "executed";
    execution.papers[0].status = "draft";
    assert.equal(
      procedureWork(execution, "procedure", today)!.readyToEvaluate,
      true,
    );
    execution.workflow.program.briefRevision = 1;
    assert.equal(
      procedureWork(execution, "procedure", today)!.readyToEvaluate,
      false,
    );
    const partial = fixture();
    partial.workflow.procedures[0].state = "evaluated";
    partial.workflow.procedures[0].execution.assessment = undefined;
    assert.equal(
      procedure(partial, "Auditor", "preparer").action,
      "Evaluate evidence",
      "A stored evaluated state alone does not prove an assessment exists",
    );
    const request = fixture();
    request.evidenceRequests = [
      {
        id: "request",
        paperIds: ["paper"],
        status: "open",
        createdBy: "preparer",
      },
    ];
    assert.equal(procedure(request, "Reviewer", "reviewer").state, "waiting");
    assert.equal(
      procedure(request, "Reviewer", "reviewer").action,
      "Follow up evidence",
    );
    assert.deepEqual(work(fixture(), "Client Viewer", "client"), []);
    assert.deepEqual(work(fixture(), "Client Contributor", "client"), []);
    const immutable = freeze(reviewed()),
      before = JSON.stringify(immutable);
    work(immutable, "Lead Auditor", "lead");
    procedureWork(immutable, "procedure", today);
    assert.equal(JSON.stringify(immutable), before);
    const unordered = freeze(work(fixture(), "Reviewer", "reviewer")),
      original = JSON.stringify(unordered);
    orderWork(unordered, today);
    assert.equal(JSON.stringify(unordered), original);
  });
});
