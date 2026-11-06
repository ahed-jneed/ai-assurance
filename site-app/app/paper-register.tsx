"use client";
import { FileText, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { Engagement, Paper, Role } from "@/lib/domain";
import type { PaperTarget } from "@/lib/paper-workflow";
import {
  paperViews,
  paperDateLabel,
  type PaperQuery,
  type PaperRegisterRow,
} from "@/lib/paper-presentation";
import { humanLabel } from "@/lib/presentation";
import { DatabaseToolbar } from "./database-toolbar";
import { RegisterControls } from "./register-controls";

export function WorkingPaperRegister({
  engagement,
  rows,
  role,
  query,
  onQuery,
  onReset,
  onOpen,
  onProcedure,
  resolve,
  busy,
  onNew,
}: {
  engagement: Engagement;
  rows: PaperRegisterRow[];
  role: Role;
  query: PaperQuery;
  onQuery: (patch: Partial<PaperQuery>) => void;
  onReset: () => void;
  onOpen: (paper: Paper, target?: PaperTarget) => void;
  onProcedure: (id: string) => void;
  resolve: (id: string) => string;
  busy: boolean;
  onNew?: () => void;
}) {
  const active =
    !!query.search ||
    query.view !== "all" ||
    query.status !== "all" ||
    query.facet !== "all" ||
    query.sort !== "program";
  const views = paperViews.map(([value, label]) => ({ value, label }));
  const canReview = ["Lead Auditor", "Reviewer"].includes(role);
  const context =
    query.view === "mine"
      ? "Your preparation, independent reviews, sign-offs and open questions."
      : query.view === "review"
        ? canReview
          ? "Current revisions you can independently review. Source procedures follow their assigned reviewer."
          : "Independent review requires a Reviewer or Lead Auditor role."
        : query.view === "blocked"
          ? "Unresolved questions, incomplete submission requirements or changed source work."
          : "";
  const emptyTitle = !engagement.papers.length
    ? "No working papers yet"
    : query.view === "mine" && !activeExceptView(query)
      ? "Your paper queue is clear"
      : query.view === "review" && !activeExceptView(query)
        ? "No papers ready for your review"
        : query.view === "blocked" && !activeExceptView(query)
          ? "No blocked papers"
          : "No matching papers";
  return (
    <section className="panel paper-register">
      <DatabaseToolbar
        label="Working papers"
        views={views}
        value={query.view}
        onView={(view) => onQuery({ view })}
        search={query.search}
        onSearch={(search) => onQuery({ search })}
        count={rows.length}
      >
        <Select value={query.view} onValueChange={(view) => onQuery({ view })}>
          <SelectTrigger
            className="paper-queue-picker"
            aria-label="Paper queue"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {views.map((v) => (
              <SelectItem key={v.value} value={v.value}>
                {v.label}
                {v.value === query.view ? " (" + rows.length + ")" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={query.status}
          onValueChange={(status) => onQuery({ status })}
        >
          <SelectTrigger
            className="paper-status-filter"
            aria-label="Filter papers by status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["draft", "in_review", "reviewed", "signed"].map((s) => (
              <SelectItem key={s} value={s}>
                {humanLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RegisterControls
          facetLabel="Stage"
          facets={[...new Set(engagement.papers.map((p) => p.stage))]}
          facet={query.facet}
          onFacet={(facet) => onQuery({ facet })}
          sort={query.sort}
          sorts={[
            { value: "program", label: "Audit program order" },
            { value: "due", label: "Earliest paper deadline" },
            { value: "updated_desc", label: "Recently updated" },
            { value: "name_asc", label: "Name A–Z" },
            { value: "name_desc", label: "Name Z–A" },
          ]}
          onSort={(sort) => onQuery({ sort })}
          onClear={onReset}
          active={active}
        />
        {onNew && (
          <Button disabled={busy} onClick={onNew}>
            <FileText size={14} aria-hidden="true" />
            New paper
          </Button>
        )}
      </DatabaseToolbar>
      {context && (
        <div className="paper-register-context">
          <p>{context}</p>
        </div>
      )}
      {rows.length ? (
        <Table className="paper-register-table">
          <TableHeader>
            <TableRow>
              <TableHead>Working paper / memo</TableHead>
              <TableHead>Prepared by</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Next step</TableHead>
              <TableHead>Paper deadline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.paper.id}>
                <TableCell data-label="Paper">
                  <button
                    type="button"
                    className="paper-register-title"
                    onClick={() => onOpen(row.paper)}
                    disabled={busy}
                  >
                    {row.paper.title}
                  </button>
                  <small className="paper-register-reference">
                    {row.paper.templateId} · {row.paper.stage}
                    {row.paper.supersededBy
                      ? " · Superseded"
                      : row.paper.retired
                        ? " · Retired"
                        : !row.paper.required
                          ? row.paper.body.conclusionStatus === "not_applicable"
                            ? " · Applicability exclusion"
                            : " · Supplementary"
                          : ""}
                  </small>
                </TableCell>
                <TableCell data-label="Prepared by">
                  <span className="paper-person">
                    {resolve(row.paper.authorId)}
                  </span>
                  {row.source?.ownerId &&
                    row.source.ownerId !== row.paper.authorId && (
                      <small>Assigned: {resolve(row.source.ownerId)}</small>
                    )}
                </TableCell>
                <TableCell data-label="Status">
                  <span
                    className={
                      "badge " +
                      (row.paper.status === "signed"
                        ? "green"
                        : row.paper.status === "draft"
                          ? "neutral"
                          : "blue")
                    }
                  >
                    {humanLabel(row.paper.status)}
                  </span>
                  <small>Revision {row.paper.revision}</small>
                </TableCell>
                <TableCell data-label="Next step">
                  <button
                    type="button"
                    className="paper-register-next"
                    disabled={busy}
                    onClick={() =>
                      row.sourceAction && row.source
                        ? onProcedure(row.source.id)
                        : onOpen(row.paper, row.target)
                    }
                  >
                    <b>
                      {row.label}
                      <ChevronRight size={13} aria-hidden="true" />
                    </b>
                    <small>{row.reason}</small>
                  </button>
                </TableCell>
                <TableCell data-label="Paper deadline">
                  <span
                    className={
                      "paper-register-due " + (row.overdue ? "overdue" : "")
                    }
                  >
                    {row.dueDate ? (
                      <time dateTime={row.dueDate}>
                        {paperDateLabel(row.dueDate)}
                      </time>
                    ) : (
                      "Not set"
                    )}
                    {row.overdue && <small>Overdue</small>}
                  </span>
                  {row.dueDate && <small>Source procedure</small>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="paper-register-empty">
          <FileText size={25} aria-hidden="true" />
          <h3>{emptyTitle}</h3>
          <p>
            {!engagement.papers.length
              ? "Create a paper from an approved methodology template."
              : activeExceptView(query)
                ? "Try a different search, status or stage."
                : query.view === "review"
                  ? "Submitted papers appear here when your role, assignment and independence checks allow review."
                  : query.view === "mine"
                    ? "Papers appear here when you prepare them, receive a review assignment or own an open question."
                    : "Choose another view to continue."}
          </p>
          {!!engagement.papers.length && (
            <Button variant="outline" onClick={onReset}>
              {activeExceptView(query) ? "Clear filters" : "Show all papers"}
            </Button>
          )}
          {!engagement.papers.length && onNew && (
            <Button disabled={busy} onClick={onNew}>
              Create a working paper
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
function activeExceptView(q: PaperQuery) {
  return !!q.search || q.status !== "all" || q.facet !== "all";
}
