import type { EvidenceRequest, Role } from "./domain";
import { requestClosed, requestOverdue } from "./evidence-requests";

export const evidenceFileViews = [
  "all",
  "unverified",
  "accepted",
  "quarantined",
] as const;
export const evidenceRequestViews = [
  "all",
  "open",
  "overdue",
  "submitted",
  "closed",
] as const;
export type EvidenceQuery = {
  tab: "files" | "requests";
  filter: string;
  search: string;
  facet: string;
  sort: string;
};
const clientRole = (role: Role) =>
  role === "Client Viewer" || role === "Client Contributor";

export function localEvidenceDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function evidenceDueDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "No deadline";
  const date = new Date(value + "T12:00:00");
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}

export function selectEvidenceRequests(
  requests: EvidenceRequest[],
  view: string,
  search: string,
  day: string,
) {
  const needle = search.trim().toLocaleLowerCase();
  return requests
    .filter(
      (r) =>
        (view === "all" ||
          (view === "open" && !requestClosed(r)) ||
          (view === "overdue" && requestOverdue(r, day)) ||
          (view === "submitted" && r.status === "submitted") ||
          (view === "closed" && requestClosed(r))) &&
        `${r.subject} ${r.responsibleParty} ${r.periodVersion}`
          .toLocaleLowerCase()
          .includes(needle),
    )
    .sort(
      (a, b) =>
        Number(requestClosed(a)) - Number(requestClosed(b)) ||
        a.dueDate.localeCompare(b.dueDate) ||
        a.id.localeCompare(b.id),
    );
}

export function evidenceRequestCounts(
  requests: EvidenceRequest[],
  day: string,
): Record<string, number> {
  return Object.fromEntries(
    evidenceRequestViews.map((view) => [
      view,
      selectEvidenceRequests(requests, view, "", day).length,
    ]),
  );
}

export function normalizeEvidenceQuery(
  input: Partial<EvidenceQuery>,
  role: Role,
): EvidenceQuery {
  const tab =
    input.tab === "requests" && !clientRole(role) ? "requests" : "files";
  const allowed = tab === "requests" ? evidenceRequestViews : evidenceFileViews;
  return {
    tab,
    filter: allowed.includes(input.filter as never) ? input.filter! : "all",
    search: (input.search ?? "").slice(0, 200),
    facet: tab === "requests" ? "all" : (input.facet ?? "all").slice(0, 80),
    sort:
      tab === "files" &&
      ["newest", "name_asc", "category"].includes(input.sort ?? "")
        ? input.sort!
        : "newest",
  };
}

export function readEvidenceQuery(search: string, role: Role): EvidenceQuery {
  const q = new URLSearchParams(search);
  return normalizeEvidenceQuery(
    {
      tab: q.get("section") === "requests" ? "requests" : "files",
      filter: q.get("status") ?? "all",
      search: q.get("q") ?? "",
      facet: q.get("category") ?? "all",
      sort: q.get("sort") ?? "newest",
    },
    role,
  );
}

export function evidenceQueryParams(input: EvidenceQuery, role: Role) {
  const q = normalizeEvidenceQuery(input, role),
    params = new URLSearchParams();
  if (q.filter !== "all") params.set("status", q.filter);
  if (q.search) params.set("q", q.search);
  if (q.facet !== "all") params.set("category", q.facet);
  if (q.sort !== "newest") params.set("sort", q.sort);
  return params;
}
