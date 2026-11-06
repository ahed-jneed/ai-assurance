import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { sourceURL } from "./ts-modules.mjs";

const compiled = async (file) =>
  ts.transpileModule(await fs.readFile(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const asURL = (js) =>
  "data:text/javascript;base64," + Buffer.from(js, "utf8").toString("base64");
const inboxURL = asURL(await compiled("lib/work-inbox.ts"));
const {
  defaultInboxQuery,
  readInboxQuery,
  normalizeInboxQuery,
  inboxQueryParams,
  selectWork,
  groupWork,
  localWorkDay,
  calendarWorkDay,
  reminderResumeAt,
  activeReminders,
} = await import(inboxURL);

const today = "2026-10-09";
const item = (id, patch = {}) =>
  Object.freeze({
    id,
    engagementId: "ENG-credit",
    engagement: "Credit model review",
    client: "Müller Analytics",
    kind: "procedure",
    recordId: "PROC-" + id,
    module: "Audit program",
    title: id,
    action: "Evaluate evidence",
    reason: "Check the approved source manifest",
    ownerId: "auditor",
    dueDate: today,
    state: "ready",
    priority: 3,
    personal: true,
    ...patch,
  });
const fixtures = Object.freeze([
  item("ready", {
    dueDate: "2026-10-10",
    reason: "Validate the source manifest against sampling coverage",
  }),
  item("review", { state: "review", kind: "report", priority: 1 }),
  item("planning", {
    state: "planning",
    kind: "program",
    engagementId: "ENG-claims",
    dueDate: "",
  }),
  item("waiting", {
    state: "waiting",
    kind: "request",
    dueDate: "2026-10-08",
    priority: 0,
  }),
  item("snoozed", {
    kind: "paper",
    engagementId: "ENG-claims",
    dueDate: "2026-10-12",
  }),
  item("team", {
    personal: false,
    ownerId: "another-auditor",
    dueDate: "2026-10-10",
    priority: 0,
  }),
  item("later", { dueDate: "2026-10-13" }),
]);
const reminders = new Map([["snoozed", "2026-10-10T06:00:00.000Z"]]);
const query = (patch) => ({ ...defaultInboxQuery, sort: "name", ...patch });
const ids = (list) => list.map((i) => i.id);
const select = (patch = {}, rows = fixtures, paused = reminders, days = 3) =>
  selectWork(rows, query(patch), paused, today, days);

assert.deepEqual(ids(select()), [
  "later",
  "planning",
  "ready",
  "review",
  "waiting",
]);
assert.deepEqual(ids(select({ scope: "team" })), [
  "later",
  "planning",
  "ready",
  "review",
  "team",
  "waiting",
]);
for (const [view, expected] of [
  ["ready", ["later", "ready"]],
  ["reviews", ["review"]],
  ["planning", ["planning"]],
  ["waiting", ["waiting"]],
]) {
  assert.deepEqual(
    ids(select({ view })),
    expected,
    `${view} contains only the matching personal state`,
  );
}
assert.deepEqual(
  ids(
    select({
      kind: "procedure",
      engagementId: "ENG-credit",
      search: "SOURCE MANIFEST AGAINST",
    }),
  ),
  ["ready"],
);
assert.deepEqual(
  ids(select({ search: "PROC-review" })),
  ["review"],
  "Search finds exact record references",
);
assert.deepEqual(
  ids(select({ search: "Evidence request" })),
  ["waiting"],
  "Search finds human-readable work kinds",
);
assert.deepEqual(
  ids(
    select({
      engagementId: "ENG-credit",
      kind: "procedure",
      search: "evaluate evidence",
    }),
  ),
  ["later", "ready"],
);
assert.equal(
  select({ search: "  müller  " }).length,
  5,
  "Client search trims surrounding whitespace",
);
assert.deepEqual(ids(select({ engagementId: "ENG-claims" })), ["planning"]);
assert.deepEqual(ids(select({ engagementId: "ENG-missing" })), []);
assert.deepEqual(ids(select({ kind: "finding" })), []);
console.log(
  "PASS personal/team scope, task states and combined engagement/kind/text filters",
);

assert.deepEqual(ids(select({ due: "overdue" })), ["waiting"]);
assert.deepEqual(ids(select({ due: "today" })), ["review"]);
assert.deepEqual(
  ids(select({ due: "soon" })),
  ["ready", "review"],
  "Due soon includes today and excludes overdue, undated and out-of-window work",
);
assert.deepEqual(
  ids(select({ due: "soon" }, fixtures, new Map(), 3)),
  ["ready", "review", "snoozed"],
  "Due soon includes the last calendar day of the reminder window",
);
assert.deepEqual(ids(select({ due: "soon" }, fixtures, new Map(), 1)), [
  "ready",
  "review",
]);
assert.deepEqual(ids(select({ due: "undated" })), ["planning"]);
assert.equal(calendarWorkDay("2026-12-31", 1), "2027-01-01");
assert.equal(calendarWorkDay("2028-02-28", 1), "2028-02-29");
assert.equal(calendarWorkDay("2028-02-28", 2), "2028-03-01");
console.log(
  "PASS distinct overdue/today/upcoming/undated filters and inclusive calendar boundaries",
);

const instant = Date.parse("2026-10-09T12:00:00.000Z");
const paused = activeReminders(
  [
    { id: "expired", until: "2026-10-09T11:59:59.999Z" },
    { id: "boundary", until: "2026-10-09T12:00:00.000Z" },
    { id: "invalid", until: "not-a-date" },
    { id: "snoozed", until: "2026-10-10T06:00:00.000Z" },
  ],
  instant,
);
assert.deepEqual([...paused.keys()], ["snoozed"]);
assert.deepEqual(ids(select({ view: "snoozed" }, fixtures, paused)), [
  "snoozed",
]);
assert(!ids(select({}, fixtures, paused)).includes("snoozed"));
const resumed = new Map(paused);
resumed.delete("snoozed");
assert(ids(select({}, fixtures, resumed)).includes("snoozed"));
assert.deepEqual(ids(select({ view: "snoozed" }, fixtures, resumed)), []);
assert.equal(
  paused.size,
  1,
  "Resuming a reminder does not mutate the previous reminder snapshot",
);
assert.deepEqual(
  ids(
    select({ view: "snoozed", engagementId: "ENG-credit" }, fixtures, paused),
  ),
  [],
);
console.log(
  "PASS snoozed queue, expiration boundary, invalid reminders and per-item resume",
);

const ordered = Object.freeze([
  item("dependency", { state: "waiting", priority: 0, dueDate: "2026-10-01" }),
  item("undated", { dueDate: "" }),
  item("dated", { dueDate: "2026-10-10" }),
  item("overdue", { priority: 5, dueDate: "2026-10-08" }),
  item("urgent", { priority: 0, dueDate: "2026-10-11" }),
]);
const before = JSON.stringify(ordered);
assert.deepEqual(
  ids(select({ sort: "priority" }, ordered, new Map())),
  ["overdue", "urgent", "dated", "undated", "dependency"],
  "Waiting dependencies stay behind actionable work even when overdue",
);
assert.deepEqual(ids(select({ sort: "due" }, ordered, new Map())), [
  "dependency",
  "overdue",
  "dated",
  "urgent",
  "undated",
]);
const tied = Object.freeze([
  item("tie-b", { title: "Same action" }),
  item("tie-a", { title: "Same action" }),
]);
for (const sort of ["priority", "due", "name"]) {
  assert.deepEqual(ids(select({ sort }, tied, new Map())), ["tie-a", "tie-b"]);
  assert.deepEqual(
    ids(select({ sort }, [...tied].reverse(), new Map())),
    ["tie-a", "tie-b"],
    "Ordering is deterministic when labels and dates tie",
  );
}
assert.equal(
  JSON.stringify(ordered),
  before,
  "Selecting and sorting do not mutate input fixtures",
);
const groups = groupWork(select({ sort: "priority" }));
assert.deepEqual(
  groups.map((g) => g.state),
  ["review", "ready", "planning", "waiting"],
);
assert.equal(groups.flatMap((g) => g.items).length, select().length);
assert.deepEqual(groupWork([]), []);
assert.deepEqual(
  groupWork([fixtures[1]]).map((g) => g.state),
  ["review"],
  "Grouping omits empty sections",
);
console.log(
  "PASS actionable priority, due-date ordering, deterministic ties, nonmutation and state grouping",
);

assert.deepEqual(inboxQueryParams(defaultInboxQuery), []);
const complete = {
  scope: "team",
  view: "reviews",
  due: "soon",
  engagementId: "ENG-credit",
  kind: "report",
  sort: "due",
  search: "Müller & approval / PROC-9",
};
const encoded = new URLSearchParams(inboxQueryParams(complete)).toString();
assert.deepEqual(
  readInboxQuery(encoded, true),
  complete,
  "Filters and search survive a shareable URL roundtrip",
);
assert.deepEqual(
  readInboxQuery(encoded, false),
  { ...complete, scope: "mine" },
  "An unauthorized team URL cannot restore team scope",
);
assert.deepEqual(readInboxQuery(""), defaultInboxQuery);
assert.deepEqual(
  readInboxQuery(
    "workScope=outsider&workView=invalid&workDue=invalid&workKind=invalid&workSort=invalid",
    true,
  ),
  defaultInboxQuery,
);
for (const inherited of ["toString", "__proto__", "constructor"]) {
  assert.equal(
    readInboxQuery("workKind=" + inherited).kind,
    "all",
    "Inherited properties are not accepted as work kinds",
  );
}
assert.equal(
  readInboxQuery(
    new URLSearchParams({
      q: "x".repeat(400),
      workEngagement: "e".repeat(400),
    }).toString(),
  ).search.length,
  300,
);
assert.equal(
  readInboxQuery(
    new URLSearchParams({ workEngagement: "e".repeat(400) }).toString(),
  ).engagementId.length,
  300,
);
assert.deepEqual(
  defaultInboxQuery,
  {
    scope: "mine",
    view: "all",
    due: "any",
    engagementId: "",
    kind: "all",
    sort: "priority",
    search: "",
  },
  "Parsing leaves shared defaults unchanged",
);
console.log(
  "PASS bounded URL state, filter roundtrip and unauthorized team-scope rejection",
);

const previousPracticeQuery = Object.freeze({
  ...complete,
  engagementId: "ENG-previous-practice",
});
assert.strictEqual(
  normalizeInboxQuery(complete, true, ["ENG-credit"]),
  complete,
  "Valid unchanged context preserves query identity",
);
assert.deepEqual(
  normalizeInboxQuery(complete, false, ["ENG-credit"]),
  { ...complete, scope: "mine" },
  "Role downgrade removes team scope while preserving accessible filters",
);
assert.deepEqual(
  normalizeInboxQuery(previousPracticeQuery, true, ["ENG-credit"]),
  { ...previousPracticeQuery, engagementId: "" },
  "Practice changes remove inaccessible engagement filters",
);
const normalized = normalizeInboxQuery(previousPracticeQuery, false, [
  "ENG-credit",
]);
assert.deepEqual(normalized, {
  ...previousPracticeQuery,
  scope: "mine",
  engagementId: "",
});
assert.equal(previousPracticeQuery.scope, "team");
assert.equal(
  previousPracticeQuery.engagementId,
  "ENG-previous-practice",
  "Normalization does not mutate the saved query",
);
assert.strictEqual(
  normalizeInboxQuery(defaultInboxQuery, false, []),
  defaultInboxQuery,
);
const normalizedURL = new URLSearchParams(inboxQueryParams(normalized));
assert.equal(
  normalizedURL.has("workScope"),
  false,
  "Copied links reflect the effective personal scope",
);
assert.equal(
  normalizedURL.has("workEngagement"),
  false,
  "Copied links omit inaccessible engagement filters",
);
assert.deepEqual(readInboxQuery(normalizedURL.toString(), false), normalized);
const staleFilter = query({
  scope: "team",
  view: "ready",
  engagementId: "ENG-previous-practice",
  search: "source manifest",
});
assert.deepEqual(ids(selectWork(fixtures, staleFilter, reminders, today)), []);
assert.deepEqual(
  ids(
    selectWork(
      fixtures,
      normalizeInboxQuery(staleFilter, false, ["ENG-credit", "ENG-claims"]),
      reminders,
      today,
    ),
  ),
  ["later", "ready"],
  "Clearing stale context filters restores matching personal work",
);
console.log(
  "PASS context normalization, accessible-filter preservation, nonmutation and truthful copied URLs",
);

// Use a separate process so daylight-saving coverage never changes the parent test timezone.
const calendarCode = `
  import assert from 'node:assert/strict';
  const {localWorkDay, calendarWorkDay, reminderResumeAt}=await import(${JSON.stringify(inboxURL)});
  assert.equal(localWorkDay(new Date('2026-03-28T23:30:00.000Z')), '2026-03-29');
  assert.equal(calendarWorkDay('2026-03-28', 1), '2026-03-29');
  assert.equal(calendarWorkDay('2026-10-24', 1), '2026-10-25');
  assert.equal(reminderResumeAt(new Date('2026-03-28T07:00:00.000Z')), '2026-03-29T06:00:00.000Z');
  assert.equal(reminderResumeAt(new Date('2026-10-24T06:00:00.000Z')), '2026-10-25T07:00:00.000Z');
  assert.equal(reminderResumeAt(new Date('2026-03-28T23:30:00.000Z')), '2026-03-30T06:00:00.000Z');
`;
const calendar = spawnSync(
  process.execPath,
  ["--input-type=module", "--eval", calendarCode],
  {
    env: { ...process.env, TZ: "Europe/Vienna" },
    encoding: "utf8",
  },
);
assert.equal(
  calendar.status,
  0,
  calendar.stderr ||
    calendar.error?.message ||
    "Local calendar assertions failed",
);
assert.equal(localWorkDay(new Date(2026, 9, 9, 0, 1)), today);
assert.equal(
  new Date(reminderResumeAt(new Date(2026, 9, 9, 23, 59))).getHours(),
  8,
);
console.log(
  "PASS local day boundaries and tomorrow-at-08:00 reminders across spring/fall daylight saving",
);

const workflowStateURL = await sourceURL("lib/workflow-state.ts");
const domainURL = await sourceURL("lib/domain.ts");
const paperWorkflowURL = asURL(
  (await compiled("lib/paper-workflow.ts")).replace(
    /from (['"])\.\/domain\1/,
    "from " + JSON.stringify(domainURL),
  ),
);
const auditorWorkflowURL = asURL(
  (await compiled("lib/auditor-workflow.ts"))
    .replace(/from (['"])\.\/domain\1/, "from " + JSON.stringify(domainURL))
    .replace(
      /from (['"])\.\/paper-workflow\1/,
      "from " + JSON.stringify(paperWorkflowURL),
    ),
);
const paperPresentationURL = asURL(
  (await compiled("lib/paper-presentation.ts"))
    .replace(/from (['"])\.\/domain\1/, "from " + JSON.stringify(domainURL))
    .replace(
      /from (['"])\.\/paper-workflow\1/,
      "from " + JSON.stringify(paperWorkflowURL),
    )
    .replace(
      /from (['"])\.\/workflow-state\1/,
      "from " + JSON.stringify(workflowStateURL),
    ),
);
const releaseTimeURL = await sourceURL("lib/domain/release-time.ts");
const qualityReviewURL = await sourceURL("lib/domain/quality-review.ts");
const workItemsURL = asURL(
  (await compiled("lib/work-items.ts"))
    .replace(
      /from (['"])\.\/domain\/release-time\1/,
      "from " + JSON.stringify(releaseTimeURL),
    )
    .replace(
      /from (['"])\.\/domain\/quality-review\1/,
      "from " + JSON.stringify(qualityReviewURL),
    )
    .replace(
      /from (['"])\.\/workflow-state\1/,
      "from " + JSON.stringify(workflowStateURL),
    )
    .replace(
      /from (['"])\.\/auditor-workflow\1/,
      "from " + JSON.stringify(auditorWorkflowURL),
    )
    .replace(
      /from (['"])\.\/paper-workflow\1/,
      "from " + JSON.stringify(paperWorkflowURL),
    )
    .replace(
      /from (['"])\.\/paper-presentation\1/,
      "from " + JSON.stringify(paperPresentationURL),
    )
    .replace(/from (['"])\.\/work-inbox\1/, "from " + JSON.stringify(inboxURL)),
);
const { engagementWork } = await import(workItemsURL);
const engagement = {
  id: "ENG-release",
  title: "Release review",
  stage: "Reporting",
  dueDate: "2026-10-20",
  papers: [],
  artifacts: [],
  evidenceRequests: [],
  findings: [],
  reports: [
    {
      id: "approved",
      kind: "final",
      actor: "creator",
      snapshot: { workflow: {} },
      release: { state: "approved", approval: { userId: "approver" } },
    },
    {
      id: "internal",
      kind: "final",
      actor: "creator",
      snapshot: { workflow: {} },
      release: { state: "internal" },
    },
    {
      id: "legacy",
      kind: "final",
      actor: "creator",
      snapshot: {},
      release: { state: "internal" },
    },
  ],
};
const reportWork = (role, person, id) =>
  engagementWork(engagement, role, person).find((i) => i.recordId === id);
assert.equal(
  reportWork("Lead Auditor", "approver", "approved").personal,
  false,
  "The package approver cannot be assigned its independent release",
);
assert.equal(
  reportWork("Lead Auditor", "other-lead", "approved").personal,
  true,
);
assert.equal(
  reportWork("Reviewer", "other-reviewer", "approved").personal,
  false,
);
assert.equal(reportWork("Reviewer", "creator", "internal").personal, false);
assert.equal(
  reportWork("Reviewer", "other-reviewer", "internal").personal,
  true,
);
assert.equal(
  reportWork("Lead Auditor", "other-lead", "legacy").personal,
  false,
  "Legacy snapshots without captured workflow do not create an actionable approval",
);
assert.deepEqual(engagementWork(engagement, "Client Viewer", "client"), []);
assert.deepEqual(
  engagementWork(engagement, "Client Contributor", "client"),
  [],
);
console.log(
  "PASS report approval/release independence, legacy snapshot exclusion and client-role queue restriction",
);
