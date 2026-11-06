import type { Engagement, Paper, Role } from "./domain";
import { canWrite, paperCurrent } from "./domain";
import {
  paperChecklist,
  paperNextAction,
  type PaperTarget,
} from "./paper-workflow";
import { currentExecution } from "./workflow-state";
import type { Procedure } from "./workflow-types";

export const paperViews = [
  ["all", "All papers"],
  ["mine", "My work"],
  ["review", "Ready for my review"],
  ["blocked", "Blocked"],
] as const;
export const paperTargets: PaperTarget[] = [
  "objective",
  "scope",
  "criteria",
  "procedures",
  "sampling",
  "results",
  "limitations",
  "conclusion",
  "conclusionStatus",
  "evidence",
  "review",
];
export type PaperQuery = {
  view: string;
  status: string;
  facet: string;
  search: string;
  sort: string;
  target?: PaperTarget;
};
export const defaultPaperQuery: PaperQuery = {
  view: "all",
  status: "all",
  facet: "all",
  search: "",
  sort: "program",
};
export function normalizePaperQuery(input: Partial<PaperQuery>): PaperQuery {
  return {
    view: paperViews.some(([id]) => id === input.view) ? input.view! : "all",
    status: ["all", "draft", "in_review", "reviewed", "signed"].includes(
      input.status ?? "",
    )
      ? input.status!
      : "all",
    facet: (input.facet ?? "all").slice(0, 200),
    search: (input.search ?? "").slice(0, 200),
    sort: ["program", "name_asc", "name_desc", "updated_desc", "due"].includes(
      input.sort ?? "",
    )
      ? input.sort!
      : "program",
    target: paperTargets.includes(input.target as PaperTarget)
      ? input.target
      : undefined,
  };
}
export function readPaperQuery(search: string): PaperQuery {
  const q = new URLSearchParams(search);
  return normalizePaperQuery({
    view: q.get("queue") ?? "all",
    status: q.get("status") ?? "all",
    facet: q.get("stage") ?? "all",
    search: q.get("q") ?? "",
    sort: q.get("sort") ?? "program",
    target: q.get("section") as PaperTarget,
  });
}
export function paperQueryParams(query: PaperQuery) {
  const q = normalizePaperQuery(query),
    params = new URLSearchParams();
  if (q.view !== "all") params.set("queue", q.view);
  if (q.status !== "all") params.set("status", q.status);
  if (q.facet !== "all") params.set("stage", q.facet);
  if (q.search) params.set("q", q.search);
  if (q.sort !== "program") params.set("sort", q.sort);
  return params;
}
export function paperSavedFilter(query: PaperQuery) {
  const q = normalizePaperQuery(query);
  return "papers:" + q.view + ":" + q.status;
}
export function readPaperSavedFilter(value: string) {
  const [, view, status] = value.split(":");
  return normalizePaperQuery(
    value.startsWith("papers:")
      ? { view, status }
      : ["draft", "in_review", "reviewed", "signed"].includes(value)
        ? { status: value }
        : { view: value },
  );
}
function calendarDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : "";
}
export function localToday(now = new Date()) {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}
export function paperDateLabel(value: string, locale?: string) {
  return calendarDate(value)
    ? new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value + "T12:00:00Z"))
    : "No paper deadline";
}
export function paperProcedureSection(
  engagement: Engagement,
  source: Procedure,
) {
  const w = engagement.workflow;
  if (
    !w ||
    w.brief?.status !== "approved" ||
    w.program.status !== "approved" ||
    w.program.briefRevision !== w.brief.revision
  )
    return "plan";
  if (source.execution && !currentExecution(engagement, source))
    return "execute";
  const paper = engagement.papers.find((p) => p.id === source.paperId);
  if (
    source.paperRevision !== undefined &&
    paper &&
    source.paperRevision !== paper.revision
  )
    return "evaluate";
  return ["submitted", "reviewed"].includes(source.state)
    ? "review"
    : ["executed", "evaluated"].includes(source.state)
      ? "evaluate"
      : "plan";
}
export function paperRegisterRow(
  paper: Paper,
  engagement: Engagement,
  role: Role,
  userId: string,
  today = localToday(),
) {
  const source = engagement.workflow?.procedures.find(
    (p) => p.paperId === paper.id,
  );
  const bound = source?.paperRevision !== undefined;
  // A superseded paper or retired memo is history: nothing is due on it.
  const history = !paperCurrent(paper);
  const action = paperNextAction({
    paper,
    artifacts: engagement.artifacts,
    role,
    userId,
  });
  const comments = paper.comments.filter((c) => !c.resolved),
    ownComment = comments.some((c) => c.authorId === userId);
  const owns =
    paper.authorId === userId ||
    paper.contributors.includes(userId) ||
    source?.ownerId === userId;
  const sourceCurrent =
    !bound ||
    (!!source &&
      source.paperRevision === paper.revision &&
      currentExecution(engagement, source) &&
      engagement.workflow?.brief?.status === "approved" &&
      engagement.workflow.program.status === "approved" &&
      engagement.workflow.program.briefRevision ===
        engagement.workflow.brief.revision);
  const reviewable =
    action.op === "reviewPaper" &&
    action.enabled &&
    (!source ||
      (bound &&
        source.state === "submitted" &&
        source.reviewerId === userId &&
        !source.contributors.includes(userId) &&
        sourceCurrent));
  const blocked =
    !history &&
    paper.status !== "signed" &&
    (!!comments.length ||
      !sourceCurrent ||
      (!!source && !bound && paper.status === "in_review") ||
      (paper.status === "draft" &&
        paperChecklist(paper, engagement.artifacts).some((c) => !c.done)) ||
      (paper.status === "reviewed" &&
        !paper.reviews.some((r) => r.revision === paper.revision)));
  let label = action.label,
    reason = action.reason,
    target = action.target;
  if (history) {
    label = "View paper history";
    reason = paper.supersededBy
      ? "Superseded by " + paper.supersededBy
      : "Retired: its evidence request was reopened";
    target = undefined;
  } else if (paper.status === "signed") {
    label = "View signed paper";
    reason = "Signed revision " + paper.revision;
  } else if (comments.length) {
    label = ownComment
      ? comments.some((c) => c.authorId === userId && c.responses?.length)
        ? "Check responses"
        : "Await a response"
      : canWrite(role)
        ? "Respond to questions"
        : "Open questions";
    reason =
      comments.length +
      " open review " +
      (comments.length === 1 ? "question" : "questions");
    target = "review";
  } else if (bound && !sourceCurrent) {
    label = "Reassess source procedure";
    reason =
      "Scope, plan or execution has changed since this paper was compiled.";
  } else if (bound && paper.status === "draft") {
    label = "Continue in audit program";
    reason = "Update, evaluate and submit the source procedure.";
  } else if (bound && paper.status === "in_review") {
    label = reviewable ? "Review source procedure" : "Await assigned review";
    reason = reviewable
      ? "Review the current execution and its evidence."
      : "The assigned independent reviewer approves the source procedure.";
  } else if (source && paper.status === "in_review") {
    label = "Continue in audit program";
    reason =
      "The linked procedure needs execution and submission before its working paper can be reviewed.";
  } else if (paper.status === "draft" && !action.enabled && canWrite(role)) {
    label =
      (
        {
          results: "Record results",
          conclusion: "Write conclusion",
          conclusionStatus: "Evaluate conclusion",
          evidence: "Link accepted evidence",
        } as Partial<Record<PaperTarget, string>>
      )[target ?? "results"] ?? "Complete paper";
    reason =
      paperChecklist(paper, engagement.artifacts).filter((c) => !c.done)
        .length + " submission requirements remaining";
  } else if (action.op === "reviewPaper" && action.enabled)
    label = "Review paper";
  const dueDate = calendarDate(source?.dueDate);
  return {
    paper,
    source,
    bound,
    reviewable,
    blocked,
    mine:
      !history &&
      paper.status !== "signed" &&
      (owns ||
        ownComment ||
        reviewable ||
        (action.op === "signPaper" && action.enabled)),
    label,
    reason,
    target,
    sourceAction:
      !history &&
      !!source &&
      !comments.length &&
      ((bound && (paper.status === "draft" || !sourceCurrent || reviewable)) ||
        (!bound && paper.status === "in_review")),
    dueDate,
    overdue:
      !history && !!dueDate && dueDate < today && paper.status !== "signed",
  };
}
export type PaperRegisterRow = ReturnType<typeof paperRegisterRow>;
export function selectPaperRegister(
  engagement: Engagement,
  role: Role,
  userId: string,
  query: PaperQuery,
  person: (id: string) => string,
  today = localToday(),
) {
  const q = normalizePaperQuery(query),
    term = q.search.trim().toLocaleLowerCase();
  const all = engagement.papers.map((p) =>
    paperRegisterRow(p, engagement, role, userId, today),
  );
  const counts = {
    all: all.length,
    mine: all.filter((r) => r.mine).length,
    review: all.filter((r) => r.reviewable).length,
    blocked: all.filter((r) => r.blocked).length,
  };
  const rows = all
    .filter(
      (r) =>
        (q.view === "all" ||
          (q.view === "mine" && r.mine) ||
          (q.view === "review" && r.reviewable) ||
          (q.view === "blocked" && r.blocked)) &&
        (q.status === "all" || r.paper.status === q.status) &&
        (q.facet === "all" || r.paper.stage === q.facet) &&
        (!term ||
          [
            r.paper.id,
            r.paper.title,
            r.paper.templateId,
            r.paper.articleRefs.join(" "),
            person(r.paper.authorId),
            r.source ? person(r.source.ownerId) : "",
            r.source ? person(r.source.reviewerId) : "",
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(term)),
    )
    .sort((a, b) =>
      q.sort === "due"
        ? !a.dueDate && !b.dueDate
          ? 0
          : !a.dueDate
            ? 1
            : !b.dueDate
              ? -1
              : a.dueDate.localeCompare(b.dueDate)
        : q.sort === "updated_desc"
          ? b.paper.updatedAt.localeCompare(a.paper.updatedAt)
          : ["name_asc", "name_desc"].includes(q.sort)
            ? (q.sort === "name_desc" ? -1 : 1) *
              a.paper.title.localeCompare(b.paper.title, undefined, {
                numeric: true,
              })
            : 0,
    );
  return { rows, counts };
}
