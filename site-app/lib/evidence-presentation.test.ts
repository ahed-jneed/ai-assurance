/* eslint-disable @typescript-eslint/no-explicit-any -- the fixtures are partial records, as the workspace receives them. */
// The evidence request register: queues, deadlines, partial receipts,
// search, ordering and URL state. Ported from
// scripts/evidence-presentation-check.mjs (#52).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  evidenceFileViews,
  evidenceRequestViews,
  localEvidenceDay,
  evidenceDueDate,
  selectEvidenceRequests,
  evidenceRequestCounts,
  normalizeEvidenceQuery,
  readEvidenceQuery,
  evidenceQueryParams,
} from "./evidence-presentation";
import { requestClosed, requestOverdue } from "./evidence-requests";

const day = "2026-10-10";
const request = (id: any, patch: any = {}): any =>
  Object.freeze({
    id,
    subject: id,
    description: "Validation evidence",
    responsibleParty: "Müller team",
    periodVersion: "2026 production release",
    handling: "Internal only",
    dueDate: day,
    paperIds: Object.freeze(["WP-1"]),
    evidenceIds: Object.freeze([]),
    required: true,
    status: "open",
    response: "",
    assessment: "",
    createdBy: "auditor",
    updatedBy: "auditor",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    revision: 1,
    history: Object.freeze([]),
    ...patch,
  });
const rows: any = Object.freeze([
  request("due-today"),
  request("late-open", { dueDate: "2026-10-09" }),
  request("late-submitted", {
    status: "submitted",
    dueDate: "2026-10-08",
    deliveryComplete: true,
    evidenceIds: Object.freeze(["A-1"]),
  }),
  request("partial", {
    status: "submitted",
    dueDate: "2026-10-11",
    deliveryComplete: false,
    remainingItems: "Independent holdout results",
    evidenceIds: Object.freeze(["A-2"]),
  }),
  request("returned", {
    status: "returned",
    dueDate: "2026-10-12",
    subject: "More validation results",
  }),
  request("accepted", { status: "accepted", dueDate: "2026-10-01" }),
  request("limitation", {
    status: "waived",
    disposition: "unobtainable",
    dueDate: "2026-10-02",
  }),
  request("scope-change", {
    status: "waived",
    disposition: "no_longer_required",
    dueDate: "2026-10-03",
  }),
]);
const ids = (items: any) => items.map((item: any) => item.id);
const select = (view = "all", search = "", input = rows) =>
  selectEvidenceRequests(input, view, search, day);
const before = JSON.stringify(rows);

const defaults: any = {
  tab: "files",
  filter: "all",
  search: "",
  facet: "all",
  sort: "newest",
};

describe("evidence request register (ported from evidence-presentation-check)", () => {
  it("outstanding/assessment/closed queues, deadline boundaries and partial receipts", async () => {
    assert.deepEqual(ids(select()), [
      "late-submitted",
      "late-open",
      "due-today",
      "partial",
      "returned",
      "accepted",
      "limitation",
      "scope-change",
    ]);
    assert.deepEqual(ids(select("open")), [
      "late-submitted",
      "late-open",
      "due-today",
      "partial",
      "returned",
    ]);
    assert.deepEqual(ids(select("submitted")), ["late-submitted", "partial"]);
    assert.deepEqual(ids(select("closed")), [
      "accepted",
      "limitation",
      "scope-change",
    ]);
    assert.deepEqual(
      ids(select("overdue")),
      ["late-submitted", "late-open"],
      "A recorded response remains overdue until its request has a disposition",
    );
    assert.equal(
      requestOverdue(rows[0], day),
      false,
      "A deadline today has not passed",
    );
    assert.equal(
      requestOverdue(rows[2], day),
      true,
      "Received evidence does not erase an outstanding assessment deadline",
    );
    for (const row of rows.slice(5))
      assert.equal(
        requestOverdue(row, day),
        false,
        "Closed requests are excluded even if their original deadlines passed",
      );
    assert.equal(
      requestClosed(rows[3]),
      false,
      "A partial receipt remains an outstanding request",
    );
    assert.deepEqual(evidenceRequestCounts(rows, day), {
      all: 8,
      open: 5,
      overdue: 2,
      submitted: 2,
      closed: 3,
    });
    for (const view of evidenceRequestViews)
      assert.equal(
        evidenceRequestCounts(rows, day)[view],
        select(view).length,
        "Queue counts use the same predicates as their linked registers",
      );
  });

  it("case-insensitive combined search, stable ties, empty results and nonmutation", async () => {
    assert.deepEqual(ids(select("all", "  MÜLLER  ")), ids(select()));
    assert.deepEqual(
      ids(select("all", "PRODUCTION RELEASE")),
      ids(select()),
      "Search includes requested period/version",
    );
    assert.deepEqual(ids(select("open", "more VALIDATION")), ["returned"]);
    assert.deepEqual(
      select("closed", "more validation"),
      [],
      "Search composes with the selected request filter",
    );
    assert.deepEqual(select("all", "no matching evidence"), []);
    assert.deepEqual(selectEvidenceRequests([], "all", "", day), []);
    const tied = Object.freeze([
      request("tie-b", { subject: "Same request" }),
      request("tie-a", { subject: "Same request" }),
    ]);
    assert.deepEqual(ids(select("all", "", tied)), ["tie-a", "tie-b"]);
    assert.deepEqual(
      ids(select("all", "", [...tied].reverse())),
      ["tie-a", "tie-b"],
      "Equal deadlines have deterministic reference ordering",
    );
    assert.equal(
      JSON.stringify(rows),
      before,
      "Filtering, counting and sorting do not mutate request records",
    );
  });

  it("file/request link roundtrips, all allowed filters and client-role restrictions", async () => {
    assert.deepEqual(normalizeEvidenceQuery({}, "Auditor"), defaults);
    assert.deepEqual(readEvidenceQuery("", "Auditor"), defaults);
    assert.equal(
      evidenceQueryParams(defaults, "Auditor").size,
      0,
      "Defaults do not clutter copied page links",
    );
    const roundtrip = (query: any, role: any = "Auditor") => {
      const params = evidenceQueryParams(query, role);
      // Workspace links serialize their existing section independently from register filters.
      params.set("section", query.tab);
      return readEvidenceQuery(params.toString(), role);
    };
    const fileQuery: any = {
      tab: "files",
      filter: "accepted",
      search: "Müller & validation / 2026",
      facet: "Data sheets",
      sort: "category",
    };
    const requestQuery: any = {
      tab: "requests",
      filter: "submitted",
      search: "Müller & holdout",
      facet: "all",
      sort: "newest",
    };
    assert.deepEqual(roundtrip(fileQuery), fileQuery);
    assert.deepEqual(roundtrip(requestQuery), requestQuery);
    for (const filter of evidenceFileViews)
      assert.equal(roundtrip({ ...defaults, filter }).filter, filter);
    for (const filter of evidenceRequestViews)
      assert.equal(roundtrip({ ...requestQuery, filter }).filter, filter);
    for (const role of ["Auditor", "Lead Auditor", "Reviewer"] as any[])
      assert.deepEqual(roundtrip(requestQuery, role), requestQuery);
    for (const role of ["Client Viewer", "Client Contributor"] as any[]) {
      assert.deepEqual(
        roundtrip(requestQuery, role),
        { ...defaults, search: requestQuery.search },
        "Client roles cannot restore the internal request register from a URL",
      );
      assert.equal(
        evidenceQueryParams(requestQuery, role).has("status"),
        false,
        "Copied client links omit request-only filters",
      );
    }
  });

  it("bounded query state, safe defaults, cross-tab normalization and local date labels", async () => {
    const invalid: any = Object.freeze({
      tab: "unknown",
      filter: "unknown",
      search: "x".repeat(400),
      facet: "c".repeat(200),
      sort: "unknown",
    });
    const normalized = normalizeEvidenceQuery(invalid, "Auditor");
    assert.deepEqual(normalized, {
      ...defaults,
      search: "x".repeat(200),
      facet: "c".repeat(80),
    });
    assert.equal(
      invalid.search.length,
      400,
      "Normalization leaves its input untouched",
    );
    for (const filter of [
      "open",
      "overdue",
      "submitted",
      "closed",
      "__proto__",
      "constructor",
      "toString",
    ]) {
      assert.equal(
        normalizeEvidenceQuery({ tab: "files", filter }, "Auditor").filter,
        "all",
        "Request-only and inherited-property filters are invalid for files",
      );
    }
    for (const filter of ["unverified", "accepted", "quarantined"]) {
      assert.equal(
        normalizeEvidenceQuery({ tab: "requests", filter }, "Auditor").filter,
        "all",
        "File-only filters are invalid for requests",
      );
    }
    for (const sort of ["newest", "name_asc", "category"]) {
      assert.equal(
        normalizeEvidenceQuery({ tab: "files", sort }, "Auditor").sort,
        sort,
      );
      assert.equal(
        normalizeEvidenceQuery({ tab: "requests", sort }, "Auditor").sort,
        "newest",
        "Request sorting follows its deadline queue rather than file controls",
      );
    }
    assert.equal(
      normalizeEvidenceQuery(
        { tab: "requests", facet: "private category" },
        "Reviewer",
      ).facet,
      "all",
    );
    assert.deepEqual(
      readEvidenceQuery("section=files&status=closed&sort=unknown", "Auditor"),
      defaults,
    );
    const bounded = readEvidenceQuery(
      new URLSearchParams({
        q: "q".repeat(500),
        category: "a".repeat(100),
      }).toString(),
      "Auditor",
    );
    assert.equal(bounded.search.length, 200);
    assert.equal(bounded.facet.length, 80);
    assert.equal(localEvidenceDay(new Date(2026, 9, 10, 0, 1)), day);
    assert.equal(evidenceDueDate(""), "No deadline");
    assert.equal(evidenceDueDate("not-a-date"), "not-a-date");
    assert.equal(
      evidenceDueDate("2026-10-10"),
      new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(2026, 9, 10, 12)),
    );
  });
});
