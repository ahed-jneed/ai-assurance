/* eslint-disable @typescript-eslint/no-explicit-any -- the fixtures are partial records, as the workbench receives them. */
// The assurance workbench's review states, queues, record selection and URL
// state. Ported from scripts/workbench-presentation-check.mjs (#52).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  workbenchSections,
  workbenchReviewStates,
  defaultWorkbenchQuery,
  isAssessment,
  workbenchReviewState,
  normalizeWorkbenchQuery,
  readWorkbenchQuery,
  workbenchQueryParams,
  workbenchReviewQueue,
  selectWorkbenchRecords,
} from "./workbench-presentation";

const record = (
  id: any,
  kind = "assertion",
  actor = "other-auditor",
  body = {},
) =>
  Object.freeze({
    id,
    kind,
    actor,
    sha256: "a".repeat(64),
    createdAt: "2026-10-10T10:00:00.000Z",
    body: Object.freeze({ statement: id, ...body }),
  });
const review = (id: any, source: any, decision: any) =>
  record(id, source.kind + "_review", "reviewer", {
    [source.kind + "Id"]: source.id,
    decision,
  });
const ownAwaiting = record("A-own", "assertion", "me", {
  statement: "Müller & approval",
  criterion: "Art. 10",
});
const otherAwaiting = record("A-ü-other", "assertion", "other-auditor", {
  statement: "Validation split",
  criterion: "Art. 15",
});
const ownReturned = record("I-own-returned", "impact", "me", {
  description: "Model change",
});
const otherReturned = record(
  "O-other-returned",
  "obligation",
  "other-auditor",
  { code: "Art. 14" },
);
const confirmed = record("O-confirmed", "obligation");
const oldAssessment = record("A-superseded");
const successor = record("A-successor", "assertion", "other-auditor", {
  supersedesId: oldAssessment.id,
});
const source = record("L-evidence-ü", "location", "evidence-owner", {
  label: "Müller validation source",
  locator: "rows 10–20",
});
const rows: any = Object.freeze([
  ownAwaiting,
  otherAwaiting,
  ownReturned,
  otherReturned,
  confirmed,
  oldAssessment,
  successor,
  source,
  review("R-return-own", ownReturned, "returned"),
  review("R-approve-other-first", otherReturned, "confirmed"),
  review("R-return-other-latest", otherReturned, "returned"),
  review("R-confirmed", confirmed, "confirmed"),
  review("R-approve-old", oldAssessment, "approve"),
  // A review of another record, or from another review kind, must not change an assertion's state.
  record("R-wrong-kind", "impact_review", "reviewer", {
    impactId: ownAwaiting.id,
    decision: "confirmed",
  }),
]);
const ids = (values: any) => values.map((value: any) => value.id);
const before = JSON.stringify(rows);

const latestApproved: any = Object.freeze([
  ...rows,
  review("R-other-new-approval", otherReturned, "confirmed"),
]);

describe("assurance workbench (ported from workbench-presentation-check)", () => {
  it("assessment/review matching, latest review disposition and superseded history", async () => {
    assert.equal(workbenchReviewState(ownAwaiting, rows), "Awaiting review");
    assert.equal(
      workbenchReviewState(otherReturned, rows),
      "Returned",
      "The latest matching independent review controls the current disposition",
    );
    assert.equal(workbenchReviewState(confirmed, rows), "Confirmed");
    assert.equal(
      workbenchReviewState(oldAssessment, rows),
      "Superseded",
      "A historical approval cannot hide a successor assessment",
    );
    assert.equal(
      workbenchReviewState(successor, rows),
      "Awaiting review",
      "A successor requires its own review",
    );
    assert.equal(isAssessment(source), false);
    for (const kind of ["assertion", "impact", "obligation"])
      assert.equal(isAssessment(record("assessment", kind)), true);
    assert.equal(
      workbenchReviewState(otherReturned, latestApproved),
      "Confirmed",
      "A later approval clears the returned assessment from the revision queue",
    );
  });

  it("separate review/revision queues, team totals, author exclusion and role eligibility", async () => {
    const queue = workbenchReviewQueue(rows, "Lead Auditor", "me");
    assert.deepEqual(ids(queue.awaiting), [
      "A-own",
      "A-ü-other",
      "A-successor",
    ]);
    assert.deepEqual(ids(queue.returned), [
      "I-own-returned",
      "O-other-returned",
    ]);
    assert.deepEqual(ids(queue.reviewable), ["A-ü-other", "A-successor"]);
    assert.deepEqual(ids(queue.revisable), [
      "I-own-returned",
      "O-other-returned",
    ]);
    assert.equal(queue.canReview, true);
    assert.equal(queue.canRevise, true);
    assert.equal(
      queue.awaiting.length,
      3,
      "Team totals include the current user's own outstanding assessments",
    );
    assert.equal(
      queue.reviewable.includes(ownAwaiting),
      false,
      "Independent reviewers cannot review their own assessment",
    );
    assert.equal(
      queue.awaiting.includes(oldAssessment),
      false,
      "Superseded assessments never inflate actionable queue counts",
    );
    assert.deepEqual(
      ids(workbenchReviewQueue(latestApproved, "Lead Auditor", "me").returned),
      ["I-own-returned"],
    );
    const reviewerQueue = workbenchReviewQueue(rows, "Reviewer", "me");
    assert.deepEqual(ids(reviewerQueue.reviewable), ids(queue.reviewable));
    assert.deepEqual(reviewerQueue.revisable, []);
    assert.equal(reviewerQueue.canRevise, false);
    const auditorQueue = workbenchReviewQueue(rows, "Auditor", "me");
    assert.deepEqual(auditorQueue.reviewable, []);
    assert.deepEqual(ids(auditorQueue.revisable), ids(queue.returned));
    assert.equal(auditorQueue.canReview, false);
    for (const role of ["Client Viewer", "Client Contributor"] as const) {
      const clientQueue = workbenchReviewQueue(rows, role, "me");
      assert.deepEqual(clientQueue.reviewable, []);
      assert.deepEqual(clientQueue.revisable, []);
      assert.equal(clientQueue.canReview, false);
      assert.equal(clientQueue.canRevise, false);
      assert.deepEqual(
        ids(clientQueue.awaiting),
        ids(queue.awaiting),
        "Role eligibility does not silently change shared queue predicates; client access remains a workspace gate",
      );
    }
    assert.deepEqual(workbenchReviewQueue([], "Reviewer", "me").awaiting, []);
    assert.deepEqual(workbenchReviewQueue([], "Reviewer", "me").returned, []);
  });

  it("combined state/search, Unicode references and authors, source visibility, empty results and nonmutation", async () => {
    const title = (value: any) =>
      value.body.statement ?? value.body.label ?? value.id;
    const person = (id: any): string =>
      (
        ({
          me: "Élodie Müller",
          "other-auditor": "Lead team",
          "evidence-owner": "Müller client",
        }) as Record<string, string>
      )[id] ?? id;
    const select = (
      search = "",
      state: any = "all",
      input = rows.slice(0, 8),
    ) => selectWorkbenchRecords(input, rows, search, state, title, person);
    assert.deepEqual(ids(select("  MÜLLER  ")), [
      "A-own",
      "I-own-returned",
      "L-evidence-ü",
    ]);
    assert.deepEqual(
      ids(select("A-Ü-OTHER")),
      ["A-ü-other"],
      "Immutable references remain directly searchable",
    );
    assert.deepEqual(
      ids(select("art. 14", "Returned")),
      ["O-other-returned"],
      "Text and review-state filters compose",
    );
    assert.deepEqual(select("art. 14", "Confirmed"), []);
    assert.deepEqual(
      ids(select("MÜLLER", "Awaiting review")),
      ["A-own", "L-evidence-ü"],
      "Source locations remain available beside a filtered assessment register",
    );
    assert.deepEqual(ids(select("", "Returned")), [
      "I-own-returned",
      "O-other-returned",
      "L-evidence-ü",
    ]);
    assert.deepEqual(ids(select("", "Superseded")), [
      "A-superseded",
      "L-evidence-ü",
    ]);
    assert.deepEqual(
      ids(select("10–20")),
      ["L-evidence-ü"],
      "Evidence locators support contextual search",
    );
    assert.deepEqual(select("no matching source"), []);
    assert.deepEqual(
      selectWorkbenchRecords([], rows, "", "all", title, person),
      [],
    );
    assert.equal(
      JSON.stringify(rows),
      before,
      "Queue derivation and combined filtering never mutate immutable records",
    );
  });

  it("URL roundtrips, section/procedure routing, safe defaults, bounds and query nonmutation", async () => {
    assert.deepEqual(normalizeWorkbenchQuery({}), defaultWorkbenchQuery);
    assert.deepEqual(readWorkbenchQuery(""), defaultWorkbenchQuery);
    assert.equal(
      workbenchQueryParams(defaultWorkbenchQuery).size,
      0,
      "Default register parameters do not clutter links",
    );
    const roundtrip = (input: any) => {
      const normalized = normalizeWorkbenchQuery(input),
        params = workbenchQueryParams(input);
      // The workspace owns section serialization alongside the surrounding engagement/view URL.
      params.set("section", normalized.section);
      return readWorkbenchQuery(params.toString());
    };
    const query = {
      section: "evidence",
      search: "Müller & validation / α",
      review: "Returned",
      recordId: "A-ü-other",
    };
    assert.deepEqual(roundtrip(query), query);
    for (const [section] of workbenchSections) {
      const result = roundtrip({ ...query, section });
      assert.equal(result.section, section);
      assert.equal(
        result.review,
        ["evidence", "impact"].includes(section) ? query.review : "all",
      );
      assert.equal(
        result.search,
        ["execution", "access"].includes(section) ? "" : query.search,
      );
      assert.equal(
        result.recordId,
        query.recordId,
        "Detail links survive navigation state normalization",
      );
    }
    for (const state of workbenchReviewStates) {
      assert.equal(roundtrip({ ...query, review: state }).review, state);
      assert.equal(
        roundtrip({ ...query, section: "impact", review: state }).review,
        state,
      );
    }
    assert.equal(
      readWorkbenchQuery("procedure=PR-1").section,
      "execution",
      "A direct procedure link opens execution rather than the systems register",
    );
    assert.equal(
      readWorkbenchQuery("section=sampling&procedure=PR-1").section,
      "sampling",
      "An explicit section takes precedence over the procedure fallback",
    );
    assert.equal(
      readWorkbenchQuery("section=unknown&procedure=PR-1").section,
      "systems",
    );
    for (const section of ["unknown", "__proto__", "constructor", "toString"]) {
      assert.equal(normalizeWorkbenchQuery({ section }).section, "systems");
    }
    for (const reviewState of [
      "pending",
      "awaiting review",
      "__proto__",
      "constructor",
      "toString",
    ]) {
      assert.equal(
        normalizeWorkbenchQuery({ section: "evidence", review: reviewState })
          .review,
        "all",
      );
    }
    const untrustedQuery = Object.freeze({
      section: "impact",
      search: "q".repeat(500),
      review: "Returned",
      recordId: "A".repeat(500),
    });
    const bounded = roundtrip(untrustedQuery);
    assert.equal(bounded.search.length, 200);
    assert.equal(bounded.recordId.length, 300);
    assert.equal(untrustedQuery.search.length, 500);
    assert.equal(untrustedQuery.recordId.length, 500);
    assert.deepEqual(
      readWorkbenchQuery("section=execution&q=hidden&review=Returned"),
      { ...defaultWorkbenchQuery, section: "execution" },
    );
  });
});
