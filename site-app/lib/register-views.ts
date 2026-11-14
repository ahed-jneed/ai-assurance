import type { Artifact, Finding, Paper, Report } from "./domain/types";
import { opinionLabel } from "./domain/report-model";
export type RegisterQuery = {
  view: string;
  facet: string;
  search: string;
  sort: string;
};
const includes = (value: string, query: string) =>
  value.toLowerCase().includes(query.trim().toLowerCase());
function nameOrder(a: string, b: string, sort: string) {
  return (
    (sort === "name_desc" ? -1 : 1) *
    a.localeCompare(b, undefined, { numeric: true })
  );
}
export function paperRows(papers: Paper[], q: RegisterQuery) {
  return papers
    .filter(
      (p) =>
        (q.view === "all" || p.status === q.view) &&
        (q.facet === "all" || p.stage === q.facet) &&
        includes(
          p.title + " " + p.templateId + " " + p.articleRefs.join(" "),
          q.search,
        ),
    )
    .sort((a, b) =>
      q.sort === "updated_desc"
        ? b.updatedAt.localeCompare(a.updatedAt)
        : ["name_asc", "name_desc"].includes(q.sort)
          ? nameOrder(a.title, b.title, q.sort)
          : 0,
    );
}
export function evidenceRows(artifacts: Artifact[], q: RegisterQuery) {
  return artifacts
    .filter(
      (a) =>
        (q.view === "all" || a.status === q.view) &&
        (q.facet === "all" || a.category === q.facet) &&
        includes(a.name + " " + a.category, q.search),
    )
    .sort((a, b) =>
      q.sort === "newest"
        ? b.createdAt.localeCompare(a.createdAt)
        : q.sort === "category"
          ? a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
          : ["name_asc", "name_desc"].includes(q.sort)
            ? nameOrder(a.name, b.name, q.sort)
            : 0,
    );
}
export function findingRows(findings: Finding[], q: RegisterQuery) {
  return findings
    .filter(
      (f) =>
        (q.view === "all" ||
          (q.view === "open" && f.status !== "closed") ||
          (q.view === "high" &&
            f.status !== "closed" &&
            ["High", "Critical"].includes(f.severity)) ||
          (q.view === "closed" && f.status === "closed")) &&
        (q.facet === "all" || f.severity === q.facet) &&
        includes(f.title + " " + f.owner + " " + f.id, q.search),
    )
    .sort((a, b) =>
      q.sort === "risk"
        ? b.riskScore - a.riskScore
        : q.sort === "due"
          ? (!a.dueDate && !b.dueDate
              ? 0
              : !a.dueDate
                ? 1
                : !b.dueDate
                  ? -1
                  : a.dueDate.localeCompare(b.dueDate)) ||
            a.title.localeCompare(b.title)
          : nameOrder(a.title, b.title, q.sort),
    );
}
export function reportRows(reports: Report[], q: RegisterQuery) {
  return reports
    .filter(
      (r) =>
        (q.view === "all" || r.kind === q.view) &&
        (q.facet === "all" ||
          (r.kind === "draft" ? "draft" : (r.release?.state ?? "internal")) ===
            q.facet.toLowerCase()) &&
        includes(
          r.kind +
            " " +
            opinionLabel(r.snapshot) +
            " " +
            String(r.snapshot.summary ?? "") +
            " " +
            r.id,
          q.search,
        ),
    )
    .sort((a, b) =>
      q.sort === "oldest"
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );
}
