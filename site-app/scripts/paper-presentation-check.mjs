import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
// Use the actual domain and workflow predicates so register eligibility stays aligned
// with the independent-review and current-execution rules used elsewhere.
const workflowURL = asURL(await compiled("lib/workflow-state.ts"));
const domainURL = await sourceURL("lib/domain.ts");
const paperWorkflowURL = asURL(
  (await compiled("lib/paper-workflow.ts")).replace(
    /from (['"])\.\/domain\1/,
    "from " + JSON.stringify(domainURL),
  ),
);
const { paperNextAction } = await import(paperWorkflowURL);
const {
  defaultPaperQuery,
  normalizePaperQuery,
  readPaperQuery,
  paperQueryParams,
  paperSavedFilter,
  readPaperSavedFilter,
  paperTargets,
  paperViews,
  localToday,
  paperDateLabel,
  paperProcedureSection,
  paperRegisterRow,
  selectPaperRegister,
} = await import(
  asURL(
    (await compiled("lib/paper-presentation.ts"))
      .replace(/from (['"])\.\/domain\1/, "from " + JSON.stringify(domainURL))
      .replace(
        /from (['"])\.\/paper-workflow\1/,
        "from " + JSON.stringify(paperWorkflowURL),
      )
      .replace(
        /from (['"])\.\/workflow-state\1/,
        "from " + JSON.stringify(workflowURL),
      ),
  )
);

const at = "2026-10-10T12:00:00.000Z";
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const paper = (id, extra = {}) => ({
  id,
  templateId: "WP-" + id,
  title: id,
  kind: "working_paper",
  stage: "Fieldwork",
  articleRefs: ["Art. 10"],
  required: true,
  revision: 2,
  authorId: "author",
  contributors: ["contributor"],
  updatedAt: at,
  status: "draft",
  plannedGuidance: "Check evidence and document the assessment.",
  body: {
    objective: "Assess data governance",
    scope: "Validation population",
    criteria: "Documented quality criteria",
    procedures: "Reviewed training and validation data",
    sampling: "Complete validation sample",
    results: "Quality checks recorded",
    limitations: "",
    conclusion: "Evidence supports the conclusion",
    conclusionStatus: "supported",
  },
  evidenceIds: ["E-accepted"],
  runIds: [],
  comments: [],
  reviews: [],
  signatures: [],
  history: [],
  ...extra,
});
const procedure = (p, extra = {}) => ({
  id: "PR-" + p.id,
  templateId: p.templateId,
  title: p.title,
  stage: "Fieldwork",
  selected: true,
  applicability: "applicable",
  rationale: "In the agreed scope",
  criterion: "Art. 10",
  sourceVersion: "2024/1689",
  periodAnalysis: "Applicable to assessment period",
  population: "Validation sample",
  sampling: "Complete sample",
  ownerId: "author",
  reviewerId: "reviewer",
  dueDate: "2026-10-09",
  method: "manual",
  modelId: "",
  datasetId: "",
  profileId: "",
  objective: "Review data governance",
  instructions: [{ id: "STEP-1", text: "Inspect validation evidence" }],
  expectedEvidence: ["Validation results"],
  candidateRefs: [],
  revision: 3,
  contributors: ["author", "contributor"],
  updatedBy: "author",
  updatedAt: at,
  paperId: p.id,
  paperRevision: p.revision,
  state: "submitted",
  execution: {
    id: "EX-" + p.id,
    revision: 1,
    briefRevision: 4,
    programRevision: 5,
    procedureRevision: 3,
    performed: "Completed validation review",
    steps: [{ id: "STEP-1", state: "performed", notes: "Evidence checked" }],
    sampling: "Complete sample",
    results: "Documented results",
    limitations: "",
    evidenceIds: ["E-accepted"],
    runIds: [],
    actor: "author",
    at,
    assessment: {
      relevance: "Relevant",
      reliability: "Reliable",
      coverage: "Complete",
      contradictions: "None identified",
      conclusion: "Supported",
      outcome: "supported",
      actor: "author",
      at,
    },
  },
  history: [],
  ...extra,
});
const engagement = (papers, procedures = []) => ({
  id: "ENG-test",
  clientId: "CLIENT-test",
  title: "Isolated audit fixture",
  stage: "Fieldwork",
  dueDate: "2026-11-01",
  version: 1,
  classification: {
    prohibited: false,
    highRisk: true,
    transparency: false,
    profiling: false,
    annexRoute: "Annex III",
    operatorRole: "Provider",
    intendedPurpose: "Decision support",
    rationale: "Documented route",
    status: "approved",
    version: "1",
    asOf: "2026-10-10",
  },
  papers,
  artifacts: [
    {
      id: "E-accepted",
      name: "Validation evidence",
      category: "Validation",
      size: 128,
      sha256: "a".repeat(64),
      key: "isolated/evidence",
      createdAt: at,
      uploadedBy: "client",
      visibility: "internal",
      status: "accepted",
      mediaType: "text/plain",
    },
  ],
  models: [],
  findings: [],
  runs: [],
  reports: [],
  eventHead: "",
  createdAt: at,
  workflow: {
    schemaVersion: "1.0",
    adoptedBy: "lead",
    adoptedAt: at,
    brief: {
      systemName: "Validation system",
      intendedUse: "Decision support",
      boundary: "Defined system boundary",
      periodStart: "2026-01-01",
      periodEnd: "2026-10-01",
      actorResponsibilities: "Provider responsibilities",
      audience: "Audit committee",
      deliverables: "Audit report",
      basis: "EU AI Act",
      constraints: "Documented limitations",
      independence: "Independent team",
      changeImpact: "",
      revision: 4,
      status: "approved",
      contributors: ["lead"],
      updatedBy: "lead",
      updatedAt: at,
      history: [],
    },
    program: {
      revision: 5,
      briefRevision: 4,
      status: "approved",
      contributors: ["lead"],
      updatedBy: "lead",
      updatedAt: at,
      history: [],
    },
    procedures,
    clientGrants: [],
    submissions: [],
    monitoring: [],
  },
});
const person = (id) =>
  ({
    author: "Élodie Müller",
    contributor: "Dana Preparer",
    reviewer: "Sam Reviewer",
    me: "My Auditor",
  })[id] ?? id;
const rowIds = (rows) => rows.map((row) => row.paper.id);
const query = (extra) => ({ ...defaultPaperQuery, ...extra });
const row = (p, e, role = "Reviewer", userId = "reviewer") =>
  paperRegisterRow(p, e, role, userId, "2026-10-10");

assert.deepEqual(normalizePaperQuery({}), {
  ...defaultPaperQuery,
  target: undefined,
});
assert.deepEqual(readPaperQuery(""), {
  ...defaultPaperQuery,
  target: undefined,
});
assert.equal(
  paperQueryParams(defaultPaperQuery).size,
  0,
  "Default register filters do not clutter a paper URL",
);
const roundtrip = (input) => {
  const normalized = normalizePaperQuery(input),
    params = paperQueryParams(input);
  // The workspace serializes a document section beside its surrounding page URL.
  if (normalized.target) params.set("section", normalized.target);
  return readPaperQuery(params.toString());
};
const urlQuery = {
  view: "mine",
  status: "in_review",
  facet: "Evidence evaluation",
  search: "Müller & validation / α",
  sort: "due",
  target: "conclusion",
};
assert.deepEqual(roundtrip(urlQuery), urlQuery);
for (const [view] of paperViews)
  assert.equal(roundtrip({ ...urlQuery, view }).view, view);
for (const status of ["all", "draft", "in_review", "reviewed", "signed"])
  assert.equal(roundtrip({ ...urlQuery, status }).status, status);
for (const sort of ["program", "name_asc", "name_desc", "updated_desc", "due"])
  assert.equal(roundtrip({ ...urlQuery, sort }).sort, sort);
for (const target of paperTargets)
  assert.equal(roundtrip({ ...urlQuery, target }).target, target);
for (const invalid of ["unknown", "__proto__", "constructor", "toString"]) {
  const result = normalizePaperQuery({
    view: invalid,
    status: invalid,
    sort: invalid,
    target: invalid,
  });
  assert.equal(result.view, "all");
  assert.equal(result.status, "all");
  assert.equal(result.sort, "program");
  assert.equal(result.target, undefined);
}
assert.equal(
  normalizePaperQuery({ search: "x".repeat(999), facet: "y".repeat(999) })
    .search.length,
  200,
);
assert.equal(
  normalizePaperQuery({ search: "x".repeat(999), facet: "y".repeat(999) }).facet
    .length,
  200,
);
assert.equal(
  readPaperQuery("q=%E0%A4%A").search.length > 0,
  true,
  "A malformed encoded search is safely readable",
);
assert.deepEqual(
  roundtrip({
    view: "all",
    status: "all",
    facet: "all",
    search: "",
    sort: "program",
    target: undefined,
  }),
  { ...defaultPaperQuery, target: undefined },
);
console.log(
  "PASS normalized filters, bounded input, section/Unicode URL roundtrip and safe invalid routes",
);

for (const [view] of paperViews) {
  for (const status of ["all", "draft", "in_review", "reviewed", "signed"]) {
    const input = query({
      view,
      status,
      search: "Separate saved search",
      facet: "Planning",
      sort: "due",
      target: "review",
    });
    assert.deepEqual(
      readPaperSavedFilter(paperSavedFilter(input)),
      { ...defaultPaperQuery, view, status, target: undefined },
      "A saved paper filter preserves both the personal queue and paper status",
    );
  }
}
assert.equal(
  paperSavedFilter(query({ view: "mine", status: "draft" })),
  "papers:mine:draft",
);
assert.equal(
  paperSavedFilter(query({ view: "__proto__", status: "unknown" })),
  "papers:all:all",
);
for (const status of ["draft", "in_review", "reviewed", "signed"]) {
  assert.deepEqual(
    readPaperSavedFilter(status),
    { ...defaultPaperQuery, status, target: undefined },
    "Legacy status-only saved views retain their original paper status",
  );
}
for (const [view] of paperViews) {
  assert.deepEqual(
    readPaperSavedFilter(view),
    { ...defaultPaperQuery, view, target: undefined },
    "Unencoded personal queues remain readable",
  );
}
for (const malformed of [
  "",
  "unknown",
  "__proto__",
  "constructor",
  "toString",
  "papers:",
  "papers::",
  "papers:unknown:invalid",
  "papers:__proto__:constructor",
  "other:mine:draft",
]) {
  assert.deepEqual(
    readPaperSavedFilter(malformed),
    { ...defaultPaperQuery, target: undefined },
    "Unknown or malformed saved filters fall back to the default queue: " +
      malformed,
  );
}
assert.deepEqual(
  readPaperSavedFilter("papers:mine:invalid"),
  { ...defaultPaperQuery, view: "mine", target: undefined },
  "An invalid status cannot discard a valid saved personal queue",
);
assert.deepEqual(
  readPaperSavedFilter("papers:invalid:in_review"),
  { ...defaultPaperQuery, status: "in_review", target: undefined },
  "An invalid queue retains a valid saved status",
);
console.log(
  "PASS saved queue/status roundtrip, legacy status migration and normalized malformed saved filters",
);

const submitted = paper("review-standalone", { status: "in_review" });
const standalone = freeze(engagement([submitted]));
assert.equal(row(submitted, standalone).reviewable, true);
assert.equal(
  row(submitted, standalone, "Lead Auditor", "author").reviewable,
  false,
  "An author cannot independently review their own paper",
);
assert.equal(
  row(submitted, standalone, "Reviewer", "contributor").reviewable,
  false,
  "A paper contributor cannot independently review",
);
for (const role of ["Auditor", "Client Viewer", "Client Contributor"])
  assert.equal(row(submitted, standalone, role).reviewable, false);
const sourcePaper = paper("compiled", { status: "in_review" });
const source = procedure(sourcePaper);
const compiledEngagement = freeze(engagement([sourcePaper], [source]));
assert.equal(row(sourcePaper, compiledEngagement).reviewable, true);
assert.equal(
  row(sourcePaper, compiledEngagement).sourceAction,
  true,
  "Compiled paper review opens its source procedure",
);
assert.equal(
  row(sourcePaper, compiledEngagement, "Reviewer", "another-reviewer")
    .reviewable,
  false,
  "Only the assigned reviewer sees a compiled paper as ready for review",
);
const changed = (change) => {
  const e = structuredClone(compiledEngagement);
  change(e, e.workflow.procedures[0]);
  return freeze(e);
};
for (const [label, modify] of [
  [
    "procedure contributor",
    (_e, p) => {
      p.contributors.push("reviewer");
    },
  ],
  [
    "source not submitted",
    (_e, p) => {
      p.state = "evaluated";
    },
  ],
  [
    "obsolete paper revision",
    (_e, p) => {
      p.paperRevision = 1;
    },
  ],
  [
    "missing execution",
    (_e, p) => {
      delete p.execution;
    },
  ],
  [
    "changed procedure plan",
    (_e, p) => {
      p.execution.procedureRevision--;
    },
  ],
  [
    "changed plan hash",
    (_e, p) => {
      p.planHash = "a".repeat(64);
      p.execution.planHash = "b".repeat(64);
    },
  ],
  [
    "changed scope revision",
    (e) => {
      e.workflow.brief.revision++;
    },
  ],
  [
    "unapproved scope",
    (e) => {
      e.workflow.brief.status = "draft";
    },
  ],
  [
    "unapproved program",
    (e) => {
      e.workflow.program.status = "submitted";
    },
  ],
  [
    "program bound to old scope",
    (e) => {
      e.workflow.program.briefRevision--;
    },
  ],
])
  assert.equal(
    row(sourcePaper, changed(modify)).reviewable,
    false,
    label + " cannot enter ready-for-review work",
  );
const reassessed = changed((_e, p) => {
  p.execution.briefRevision = 1;
  p.execution.programRevision = 1;
  p.execution.impactReview = {
    briefRevision: 4,
    programRevision: 5,
    actor: "author",
    at,
    reason: "Reaffirmed after scope review",
  };
});
assert.equal(
  row(sourcePaper, reassessed).reviewable,
  true,
  "A current documented execution impact review can reaffirm an older execution",
);
assert.equal(
  row(
    sourcePaper,
    changed((e) => {
      e.workflow.program.revision++;
    }),
  ).reviewable,
  true,
  "A program revision for another procedure's change keeps this execution reviewable",
);
const stale = changed((e) => {
  e.workflow.program.status = "draft";
});
assert.equal(row(sourcePaper, stale).blocked, true);
assert.equal(row(sourcePaper, stale).label, "Reassess source procedure");
console.log(
  "PASS independent assigned review, current compiled revision and approved scope/program/execution gates",
);

const destination = (e) => paperProcedureSection(e, e.workflow.procedures[0]);
assert.equal(
  destination(compiledEngagement),
  "review",
  "A current submitted source opens its procedure review directly",
);
assert.equal(
  destination(reassessed),
  "review",
  "A reaffirmed current execution remains directly reviewable",
);
for (const state of ["reviewed", "executed", "evaluated", "planned"]) {
  const e = changed((_e, p) => {
    p.state = state;
  });
  assert.equal(
    destination(e),
    state === "reviewed"
      ? "review"
      : ["executed", "evaluated"].includes(state)
        ? "evaluate"
        : "plan",
  );
}
for (const modify of [
  (_e, p) => {
    p.execution.briefRevision--;
  },
  (_e, p) => {
    p.planHash = "a".repeat(64);
    p.execution.planHash = "b".repeat(64);
  },
  (_e, p) => {
    p.execution.procedureRevision--;
  },
])
  assert.equal(
    destination(changed(modify)),
    "execute",
    "A stale execution opens the work needed for reassessment, even if the paper was submitted",
  );
for (const modify of [
  (e) => {
    e.workflow.brief.status = "draft";
  },
  (e) => {
    e.workflow.program.status = "submitted";
  },
  (e) => {
    e.workflow.program.briefRevision--;
  },
])
  assert.equal(
    destination(changed(modify)),
    "plan",
    "Unapproved or mismatched scope/program must be corrected before source execution",
  );
const oldPaper = changed((_e, p) => {
  p.paperRevision--;
});
assert.equal(
  destination(oldPaper),
  "evaluate",
  "A paper from an older revision needs recompilation from the current evaluated source",
);
const mixedStale = changed((_e, p) => {
  p.paperRevision--;
  p.execution.procedureRevision--;
});
assert.equal(
  destination(mixedStale),
  "execute",
  "Obsolete execution must be addressed before recompiling an obsolete paper",
);
const noWorkflow = structuredClone(compiledEngagement);
delete noWorkflow.workflow;
assert.equal(paperProcedureSection(freeze(noWorkflow), source), "plan");
const legacy = changed((_e, p) => {
  delete p.paperRevision;
  p.state = "planned";
  delete p.execution;
});
const legacyRow = row(sourcePaper, legacy);
assert.equal(
  legacyRow.bound,
  false,
  "An adopted legacy paper may be linked before its first source compilation",
);
assert.equal(
  legacyRow.reviewable,
  false,
  "A linked legacy paper cannot bypass review through its source procedure",
);
assert.equal(legacyRow.blocked, true);
assert.equal(legacyRow.sourceAction, true);
assert.equal(legacyRow.label, "Continue in audit program");
assert.equal(destination(legacy), "plan");
assert.deepEqual(
  rowIds(
    selectPaperRegister(
      legacy,
      "Reviewer",
      "reviewer",
      query({ view: "review" }),
      person,
    ).rows,
  ),
  [],
  "Legacy submissions cannot inflate the ready-for-review queue",
);
assert.equal(
  selectPaperRegister(legacy, "Reviewer", "reviewer", query(), person).counts
    .blocked,
  1,
);
console.log(
  "PASS direct procedure review/evaluation/reassessment destinations and linked legacy-paper source handoff",
);

const own = paper("draft-own", {
  authorId: "me",
  title: "Validation 10",
  updatedAt: "2026-10-08T10:00:00.000Z",
});
const incomplete = paper("draft-incomplete", {
  authorId: "me",
  title: "Validation 2",
  stage: "Planning",
  body: { ...own.body, results: "" },
});
const team = paper("draft-team", {
  authorId: "author",
  title: "Team assessment",
});
const commentPaper = paper("comment-own", {
  authorId: "author",
  comments: [
    {
      id: "COMMENT-1",
      authorId: "me",
      text: "Explain the limitation",
      resolved: false,
      createdAt: at,
    },
  ],
});
const signed = paper("signed-own", {
  authorId: "me",
  status: "signed",
  comments: [],
});
const register = freeze(
  engagement(
    [own, incomplete, team, submitted, commentPaper, signed, sourcePaper],
    [source],
  ),
);
const select = (
  input = {},
  role = "Lead Auditor",
  userId = "me",
  e = register,
) => selectPaperRegister(e, role, userId, query(input), person, "2026-10-10");
const before = JSON.stringify(register);
assert.deepEqual(
  rowIds(
    select({
      view: "mine",
      status: "draft",
      facet: "Fieldwork",
      search: "validation",
    }).rows,
  ),
  ["draft-own"],
);
assert.deepEqual(
  rowIds(
    select({
      view: "mine",
      status: "draft",
      facet: "Planning",
      search: "validation",
    }).rows,
  ),
  ["draft-incomplete"],
);
assert.deepEqual(
  rowIds(select({ search: "  MÜLLER  ", status: "draft" }).rows),
  ["draft-team", "comment-own"],
);
assert.deepEqual(
  rowIds(select({ search: "SAM REVIEWER", status: "in_review" }).rows),
  ["compiled"],
  "Assigned reviewer names are searchable",
);
const referencedPaper = paper("PAPER-opaque-7c12", {
  templateId: "WP-DG-01",
  title: "Data governance review",
});
const referencedRegister = freeze(engagement([referencedPaper, team]));
assert.deepEqual(
  rowIds(
    select(
      { search: "paper-OPAQUE-7c12" },
      "Auditor",
      "author",
      referencedRegister,
    ).rows,
  ),
  [referencedPaper.id],
  "A copied immutable paper reference remains searchable even when its title and template differ",
);
assert.deepEqual(rowIds(select({ search: "art. 10", view: "blocked" }).rows), [
  "draft-incomplete",
  "comment-own",
]);
assert.deepEqual(
  rowIds(select({ view: "review" }, "Reviewer", "reviewer").rows),
  ["review-standalone", "compiled"],
);
assert.deepEqual(
  rowIds(select({ view: "review" }, "Reviewer", "another-reviewer").rows),
  ["review-standalone"],
);
assert.equal(
  select({ search: "nothing matches", status: "signed" }).rows.length,
  0,
);
assert.deepEqual(
  select({ search: "nothing matches" }).counts,
  select().counts,
  "Queue totals reflect the full engagement even when a search has no results",
);
assert.equal(select().counts.all, 7);
assert.equal(select().counts.blocked, 2);
assert.equal(
  select({ view: "mine" }).rows.some((r) => r.paper.id === "signed-own"),
  false,
  "Signed work does not inflate personal outstanding work",
);
assert.deepEqual(
  rowIds(select({ search: "validation", sort: "name_asc" }).rows),
  ["draft-incomplete", "draft-own"],
  "Human-facing numeric names sort naturally",
);
assert.deepEqual(
  rowIds(select({ search: "validation", sort: "name_desc" }).rows),
  ["draft-own", "draft-incomplete"],
);
assert.deepEqual(
  selectPaperRegister(
    freeze(engagement([])),
    "Reviewer",
    "reviewer",
    query(),
    person,
  ).counts,
  { all: 0, mine: 0, review: 0, blocked: 0 },
);
assert.equal(
  JSON.stringify(register),
  before,
  "Filtering, counting, eligibility and sorting never mutate audit records",
);
console.log(
  "PASS personal/team filters composed with status, stage and Unicode names, stable counts, natural ordering and nonmutation",
);

for (const status of ["draft", "in_review", "reviewed", "signed"]) {
  const p = paper("pending-" + status, {
    status,
    reviews: [{ userId: "independent", revision: 2, at }],
  });
  for (const unsent of ["unsent review comment", "unsent response"]) {
    const next = paperNextAction({
      paper: p,
      artifacts: register.artifacts,
      role: "Lead Auditor",
      userId: "me",
      pendingComment: true,
    });
    assert.equal(
      next.enabled,
      false,
      unsent + " blocks advancement of " + status,
    );
    assert.equal(next.op, null);
    assert.equal(next.target, "review");
    assert.match(next.reason, /comment or response/);
  }
}
const question = row(commentPaper, register, "Auditor", "me");
assert.equal(question.blocked, true);
assert.equal(question.label, "Await a response");
assert.equal(question.target, "review");
const answered = paper("answered", {
  comments: [
    {
      ...commentPaper.comments[0],
      responses: [{ actor: "author", at, text: "Added assessment rationale" }],
    },
  ],
});
assert.equal(
  row(answered, engagement([answered]), "Auditor", "me").label,
  "Check responses",
);
assert.equal(
  row(commentPaper, register, "Auditor", "author").label,
  "Respond to questions",
);
assert.equal(
  row(commentPaper, register, "Reviewer", "reviewer").label,
  "Open questions",
);
console.log(
  "PASS pending comment/response advancement guard and truthful question/response guidance",
);

assert.equal(
  localToday(new Date(2026, 9, 10, 0, 5)),
  "2026-10-10",
  "Calendar-day comparisons use local day fields",
);
assert.equal(localToday(new Date(2026, 0, 2, 23, 55)), "2026-01-02");
assert.equal(row(sourcePaper, compiledEngagement).overdue, true);
const dueToday = changed((_e, p) => {
  p.dueDate = "2026-10-10";
});
assert.equal(
  row(sourcePaper, dueToday).overdue,
  false,
  "A deadline today is not overdue",
);
const signedSource = paper("signed-due", { status: "signed" });
const signedEngagement = freeze(
  engagement([signedSource], [procedure(signedSource)]),
);
assert.equal(
  row(signedSource, signedEngagement).overdue,
  false,
  "Completed signed papers are never labelled overdue",
);
assert.equal(row(signedSource, signedEngagement).label, "View signed paper");
for (const invalid of [
  "",
  "2026-02-30",
  "2025-02-29",
  "2026-13-01",
  "2026-00-01",
  "2026-10-00",
  "10/09/2026",
  "2026-10-09T00:00:00Z",
  "invalid",
]) {
  const e = changed((_e, p) => {
    p.dueDate = invalid;
  });
  assert.equal(
    row(sourcePaper, e).dueDate,
    "",
    invalid + " is not a real date deadline",
  );
  assert.equal(row(sourcePaper, e).overdue, false);
  assert.equal(paperDateLabel(invalid, "en-GB"), "No paper deadline");
}
const leap = changed((_e, p) => {
  p.dueDate = "2028-02-29";
});
assert.equal(row(sourcePaper, leap).dueDate, "2028-02-29");
assert.equal(paperDateLabel("2026-10-09", "en-GB"), "9 Oct 2026");
const missingDue = paper("no-due");
const earlyDue = paper("early-due");
const lateDue = paper("late-due");
const invalidDue = paper("invalid-due");
const dates = freeze(
  engagement(
    [missingDue, lateDue, invalidDue, earlyDue],
    [
      procedure(lateDue, { dueDate: "2026-10-12" }),
      procedure(earlyDue, { dueDate: "2026-10-08" }),
      procedure(invalidDue, { dueDate: "2026-02-30" }),
    ],
  ),
);
assert.deepEqual(
  rowIds(select({ sort: "due" }, "Auditor", "author", dates).rows),
  ["early-due", "late-due", "no-due", "invalid-due"],
  "Valid deadlines sort first; missing and invalid deadlines remain last in stable order",
);
assert.equal(JSON.stringify(register), before);
console.log(
  "PASS real calendar dates, local day boundaries, signed completion and stable nulls-last deadline ordering",
);
