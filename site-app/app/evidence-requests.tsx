"use client";

import { useState } from "react";
import { can } from "@/lib/permissions";
import {
  ClipboardList,
  Plus,
  ArrowUpRight,
  Download,
  MoreHorizontal,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  type Engagement,
  type EvidenceRequest,
  type Paper,
  type Role,
} from "@/lib/domain";
import {
  requestLabel,
  requestClosed,
  requestOverdue,
} from "@/lib/evidence-requests";
import {
  localEvidenceDay,
  evidenceDueDate,
  selectEvidenceRequests,
} from "@/lib/evidence-presentation";
import { DatabaseToolbar } from "./database-toolbar";

function filesNeedAcceptance(request: EvidenceRequest, engagement: Engagement) {
  return (
    !request.evidenceIds.length ||
    request.evidenceIds.some(
      (id) =>
        !engagement.artifacts.some(
          (a) => a.id === id && a.status === "accepted",
        ),
    )
  );
}
function fileStatus(status?: string) {
  return status === "accepted"
    ? "Accepted for handling"
    : status === "unverified"
      ? "Awaiting acceptance"
      : status === "quarantined"
        ? "Quarantined"
        : "Unavailable";
}
export function RequestState({ request: r }: { request: EvidenceRequest }) {
  const tone =
    r.status === "accepted"
      ? "green"
      : r.status === "returned" ||
          (r.status === "waived" && r.disposition === "unobtainable")
        ? "amber"
        : r.status === "submitted"
          ? "blue"
          : "neutral";
  return <span className={"badge " + tone}>{requestLabel(r)}</span>;
}

export function EvidenceRequests({
  engagement: e,
  role,
  busy,
  view,
  onView,
  search,
  onSearch,
  onOpen,
  onNew,
}: {
  engagement: Engagement;
  role: Role;
  busy: boolean;
  view: string;
  onView: (v: string) => void;
  search: string;
  onSearch: (v: string) => void;
  onOpen: (r: EvidenceRequest) => void;
  onNew: () => void;
}) {
  const requests = e.evidenceRequests ?? [],
    day = localEvidenceDay(),
    rows = selectEvidenceRequests(requests, view, search, day),
    writer = can(role, "createEvidenceRequest"),
    filtered = view !== "all" || !!search.trim();
  function exportList() {
    const content =
      `# Evidence requests — ${e.title}\n\n` +
      rows
        .map(
          (r) =>
            `## ${r.subject}\n\nStatus: ${requestLabel(r)}\nResponsible party: ${r.responsibleParty}\nDue: ${r.dueDate}\nPeriod/version: ${r.periodVersion}\n\n${r.description}\n\nHandling: ${r.handling}\n\nRelated papers: ${r.paperIds.map((id) => e.papers.find((p) => p.id === id)?.templateId ?? id).join(", ")}\n`,
        )
        .join("\n");
    const url = URL.createObjectURL(
        new Blob([content], { type: "text/markdown" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = "evidence-request-checklist.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function clearFilters() {
    onView("all");
    onSearch("");
  }
  return (
    <section className="panel evidence-request-panel">
      <DatabaseToolbar
        label="Evidence requests"
        views={[
          { value: "all", label: "All requests" },
          { value: "open", label: "Outstanding" },
          { value: "overdue", label: "Overdue" },
          { value: "submitted", label: "Needs assessment" },
          { value: "closed", label: "Closed" },
        ]}
        value={view}
        onView={onView}
        search={search}
        onSearch={onSearch}
        count={rows.length}
      >
        <label className="evidence-request-view-picker">
          View
          <select
            name="evidence-request-view"
            aria-label="Evidence request view"
            value={view}
            onChange={(event) => onView(event.target.value)}
          >
            <option value="all">All requests</option>
            <option value="open">Outstanding</option>
            <option value="overdue">Deadline passed</option>
            <option value="submitted">Needs assessment</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!rows.length}
          onClick={exportList}
        >
          <Download size={14} aria-hidden="true" />
          Checklist
        </Button>
        {writer && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onNew}
          >
            <Plus size={14} aria-hidden="true" />
            Request evidence
          </Button>
        )}
      </DatabaseToolbar>
      {rows.length ? (
        <Table className="evidence-request-table evidence-request-register">
          <TableHeader>
            <TableRow>
              <TableHead>Requested evidence</TableHead>
              <TableHead>Responsible party & deadline</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Next action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const missing = filesNeedAcceptance(r, e),
                overdue = requestOverdue(r, day),
                action = !writer
                  ? "Open request"
                  : r.status === "submitted"
                    ? missing
                      ? "Open received files"
                      : "Assess evidence"
                    : requestClosed(r)
                      ? "Open request"
                      : "Record received evidence";
              return (
                <TableRow key={r.id}>
                  <TableCell
                    data-label="Requested evidence"
                    className="request-title-cell"
                  >
                    <button
                      type="button"
                      className="paper-link"
                      onClick={() => onOpen(r)}
                    >
                      {r.subject}
                    </button>
                    <small className="block subtle">{r.periodVersion}</small>
                    <small className="block subtle">
                      {r.paperIds
                        .map(
                          (id) =>
                            e.papers.find((p) => p.id === id)?.templateId ??
                            "Unavailable paper",
                        )
                        .join(", ")}
                    </small>
                  </TableCell>
                  <TableCell
                    data-label="Responsible party & deadline"
                    className="request-owner-cell"
                  >
                    <span>{r.responsibleParty}</span>
                    <small
                      className={
                        "block " + (overdue ? "request-overdue" : "subtle")
                      }
                    >
                      {evidenceDueDate(r.dueDate)}
                    </small>
                    {overdue && (
                      <small className="block request-overdue">
                        Request deadline passed
                      </small>
                    )}
                  </TableCell>
                  <TableCell
                    data-label="Received"
                    className="request-received-cell"
                  >
                    <span>
                      {r.evidenceIds.length}{" "}
                      {r.evidenceIds.length === 1 ? "file" : "files"}
                    </span>
                    {r.deliveryComplete === false && (
                      <small className="block subtle">Partial delivery</small>
                    )}
                    {r.status === "submitted" && missing && (
                      <small className="block request-warning">
                        File acceptance required
                      </small>
                    )}
                  </TableCell>
                  <TableCell
                    data-label="Status"
                    className="request-status-cell"
                  >
                    <RequestState request={r} />
                  </TableCell>
                  <TableCell
                    data-label="Next action"
                    className="request-next-cell"
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      className="request-next-action"
                      aria-label={action + ": " + r.subject}
                      onClick={() => onOpen(r)}
                    >
                      {action}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <div className="empty-state">
          <ClipboardList size={26} aria-hidden="true" />
          <h3>
            {requests.length || filtered
              ? "No matching requests"
              : "What evidence do you need?"}
          </h3>
          <p>
            {requests.length || filtered
              ? "No requests match this view and search."
              : writer
                ? "Record the deliverable, responsible party, period and deadline, then link files when they arrive."
                : "The audit team has not recorded any evidence requests yet."}
          </p>
          {requests.length || filtered ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          ) : (
            writer && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onNew}
              >
                <Plus size={14} aria-hidden="true" />
                Request evidence
              </Button>
            )
          )}
        </div>
      )}
    </section>
  );
}

export function EvidenceRequestDetails({
  request: r,
  engagement: e,
  role,
  busy,
  resolve,
  onForm,
  onPaper,
  onArtifact,
}: {
  request: EvidenceRequest;
  engagement: Engagement;
  role: Role;
  busy: boolean;
  resolve: (id: string) => string;
  onForm: (form: string, r: EvidenceRequest) => void;
  onPaper: (p: Paper) => void;
  onArtifact: (id: string) => void;
}) {
  const writer = can(role, "assessEvidenceRequest"),
    closed = requestClosed(r),
    lead = can(role, "closeEvidenceRequest"),
    missing = filesNeedAcceptance(r, e),
    submissions =
      e.workflow?.submissions.filter((s) => s.requestId === r.id) ?? [];
  const paperIds = [
      ...new Set([
        ...r.paperIds,
        ...(r.limitationPaperId ? [r.limitationPaperId] : []),
      ]),
    ],
    day = localEvidenceDay();
  const initialSection =
    r.status === "submitted" && missing ? "files" : "overview";
  const [section, setSection] = useState(initialSection);
  const guidance =
    r.status === "submitted"
      ? missing
        ? "Review the received files and their handling status before concluding sufficiency."
        : !writer
          ? "Review the received files and recorded assessment. The audit team manages receipt and sufficiency decisions."
          : r.deliveryComplete === false
            ? "The delivery is partial. Assess the receipt or record the remaining evidence before concluding sufficiency."
            : "Assess whether the accepted files meet this request. Record the rationale for sufficiency or return the request for more evidence."
      : r.status === "returned"
        ? writer
          ? "More evidence is needed. Record the follow-up receipt and any items still outstanding."
          : "More evidence is needed. Review the request, assessment and linked working papers."
        : r.status === "open"
          ? writer
            ? "Record the received package when the evidence arrives. File acceptance and evidence sufficiency are separate decisions."
            : "The request is awaiting evidence. Review its deliverable, handling instructions and linked working papers."
          : r.status === "accepted"
            ? "Sufficiency is recorded for this request. Evaluate the support and conclusions in the linked working papers."
            : "Review the linked decision memo and its effect on the scoped audit conclusion.";
  const hasSecondary = (writer && !closed) || (lead && closed);
  return (
    <div className="evidence-request-record">
      <div className="detail-status">
        <RequestState request={r} />
        <span className="subtle">Revision {r.revision}</span>
      </div>
      <div className="request-next-step">
        <p className="record-decision-note">{guidance}</p>
        <div className="request-primary-actions">
          {writer && r.status === "submitted" && !missing && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => onForm("requestAssess", r)}
            >
              Assess evidence
            </Button>
          )}
          {r.status === "submitted" &&
            (missing || !writer) &&
            section !== "files" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setSection("files")}
              >
                Open received files
                <ArrowUpRight size={14} aria-hidden="true" />
              </Button>
            )}
          {writer && ["open", "returned"].includes(r.status) && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => onForm("requestResponse", r)}
            >
              Record received evidence
            </Button>
          )}
          {closed && !!paperIds.length && section !== "papers" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setSection("papers")}
            >
              Open working papers
              <ArrowUpRight size={14} aria-hidden="true" />
            </Button>
          )}
          {hasSecondary && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label="More request actions"
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                  <span>More actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {writer && r.status === "submitted" && missing && (
                  <DropdownMenuItem onSelect={() => onForm("requestAssess", r)}>
                    Assess evidence
                  </DropdownMenuItem>
                )}
                {writer && r.status === "submitted" && (
                  <DropdownMenuItem
                    onSelect={() => onForm("requestResponse", r)}
                  >
                    Update received evidence
                  </DropdownMenuItem>
                )}
                {writer && ["open", "returned"].includes(r.status) && (
                  <DropdownMenuItem onSelect={() => onForm("requestEdit", r)}>
                    Edit request
                  </DropdownMenuItem>
                )}
                {lead && !closed && (
                  <DropdownMenuItem onSelect={() => onForm("requestClose", r)}>
                    Record limitation / scope change
                  </DropdownMenuItem>
                )}
                {lead && closed && (
                  <DropdownMenuItem onSelect={() => onForm("requestReopen", r)}>
                    Reopen request
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <Tabs
        className="record-workspace-tabs evidence-request-tabs"
        value={section}
        onValueChange={setSection}
      >
        <label className="evidence-detail-section-picker">
          Request section
          <select
            name="evidenceRequestSection"
            aria-label="Request section"
            value={section}
            onChange={(event) => setSection(event.target.value)}
          >
            <option value="overview">Overview</option>
            <option value="files">
              Received files ({r.evidenceIds.length})
            </option>
            <option value="papers">Working papers ({paperIds.length})</option>
            <option value="history">History ({r.history.length})</option>
          </select>
        </label>
        <TabsList aria-label="Request sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="files">
            Received files{" "}
            <span className="view-count">{r.evidenceIds.length}</span>
          </TabsTrigger>
          <TabsTrigger value="papers">
            Working papers <span className="view-count">{paperIds.length}</span>
          </TabsTrigger>
          <TabsTrigger value="history">
            History <span className="view-count">{r.history.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <dl className="record-summary-grid">
            <div>
              <dt>Responsible party</dt>
              <dd>{r.responsibleParty}</dd>
            </div>
            <div>
              <dt>Request deadline</dt>
              <dd className={requestOverdue(r, day) ? "overdue" : undefined}>
                {evidenceDueDate(r.dueDate)}
                {requestOverdue(r, day) && (
                  <small>Request deadline passed</small>
                )}
              </dd>
            </div>
            <div>
              <dt>Period / version</dt>
              <dd>{r.periodVersion}</dd>
            </div>
            <div>
              <dt>Delivery status</dt>
              <dd>
                {r.deliveryComplete === undefined
                  ? "No completeness assessment recorded"
                  : r.deliveryComplete
                    ? "Complete receipt recorded"
                    : "Partial delivery"}
              </dd>
            </div>
          </dl>
          <section className="readable-section">
            <h3>Expected deliverable & purpose</h3>
            <p className="record-text">{r.description}</p>
          </section>
          <section className="readable-section">
            <h3>Confidentiality & collection instructions</h3>
            <p className="record-text">{r.handling}</p>
          </section>
          {r.remainingItems && (
            <section className="readable-section">
              <h3>Items still outstanding</h3>
              <p className="record-text">{r.remainingItems}</p>
            </section>
          )}
          {r.assessment && (
            <section className="readable-section">
              <h3>
                {r.status === "waived"
                  ? "Disposition rationale"
                  : "Evidence assessment"}
              </h3>
              <p className="record-text">{r.assessment}</p>
            </section>
          )}
          <p className="request-note">
            Request disposition records collection and an auditor assessment.
            Working-paper review and the scoped audit conclusion remain separate
            decisions.
          </p>
        </TabsContent>
        <TabsContent value="files">
          <section className="readable-section">
            <h3>Received files</h3>
            {r.evidenceIds.map((id) => {
              const artifact = e.artifacts.find((a) => a.id === id);
              return (
                <button
                  type="button"
                  className="linked-record"
                  key={id}
                  disabled={!artifact}
                  onClick={() => onArtifact(id)}
                >
                  <FileText size={16} aria-hidden="true" />
                  <span>
                    <b>{artifact?.name ?? "Unavailable evidence reference"}</b>
                    <small>{artifact?.category ?? id}</small>
                  </span>
                  <span
                    className={
                      "badge " +
                      (artifact?.status === "accepted" ? "neutral" : "amber")
                    }
                  >
                    {fileStatus(artifact?.status)}
                  </span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              );
            })}
            {!r.evidenceIds.length && (
              <p className="subtle">No received files recorded.</p>
            )}
            {!!r.evidenceIds.length && missing && (
              <p className="request-warning">
                Review file acceptance before concluding sufficiency.
              </p>
            )}
          </section>
          {r.deliveryComplete !== undefined && (
            <section className="readable-section">
              <h3>Delivery completeness</h3>
              <p>
                {r.deliveryComplete
                  ? "Complete receipt recorded"
                  : "Partial delivery · items remain outstanding"}
              </p>
              {r.remainingItems && (
                <p className="record-text">{r.remainingItems}</p>
              )}
            </section>
          )}
          {r.response && (
            <details className="captured-record">
              <summary>Auditor-recorded receipt</summary>
              <p className="record-text">{r.response}</p>
            </details>
          )}
          {!!submissions.length && (
            <section className="request-receipt-list">
              <h3>
                Client receipts{" "}
                <span className="view-count">{submissions.length}</span>
              </h3>
              {submissions.map((s) => (
                <details className="captured-record" key={s.id}>
                  <summary>
                    Client receipt · {s.delivery} ·{" "}
                    {new Date(s.at).toLocaleString()}
                  </summary>
                  <p>{resolve(s.actor)}</p>
                  <p className="record-text">{s.note}</p>
                  {s.remaining && (
                    <p className="record-text">Outstanding: {s.remaining}</p>
                  )}
                </details>
              ))}
            </section>
          )}
        </TabsContent>
        <TabsContent value="papers">
          <section className="readable-section">
            <h3>Working papers</h3>
            {paperIds.map((id) => {
              const p = e.papers.find((p) => p.id === id);
              return p ? (
                <button
                  type="button"
                  className="linked-record"
                  key={id}
                  onClick={() => onPaper(p)}
                >
                  <FileText size={16} aria-hidden="true" />
                  <span>
                    <b>{p.title}</b>
                    <small>
                      {p.templateId} ·{" "}
                      {p.status === "signed"
                        ? "Signed revision"
                        : "Prepare and evaluate evidence"}
                      {p.id === r.limitationPaperId ? " · Decision memo" : ""}
                    </small>
                  </span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <p className="subtle" key={id}>
                  Working paper unavailable.
                </p>
              );
            })}
            {!paperIds.length && (
              <p className="subtle">No working papers linked.</p>
            )}
          </section>
          {r.limitationPaperId && (
            <p className="request-note">
              Complete the linked limitation/scope memo with accepted support
              for the decision, then submit it for independent review. If the
              evidence becomes available, reassess that memo; its conclusions do
              not change automatically.
            </p>
          )}
        </TabsContent>
        <TabsContent value="history">
          <dl className="record-summary-grid">
            <div>
              <dt>Requested by</dt>
              <dd>
                {resolve(r.createdBy)}
                <small>{new Date(r.createdAt).toLocaleString()}</small>
              </dd>
            </div>
            <div>
              <dt>Last recorded by</dt>
              <dd>
                {resolve(r.updatedBy)}
                <small>{new Date(r.updatedAt).toLocaleString()}</small>
              </dd>
            </div>
          </dl>
          <section className="request-history-list">
            <h3>Previous revisions</h3>
            {r.history.length ? (
              r.history
                .slice()
                .reverse()
                .map((h) => (
                  <details className="captured-record" key={h.revision}>
                    <summary>
                      Revision {h.revision} · {requestLabel(h)} ·{" "}
                      {new Date(h.updatedAt).toLocaleString()}
                    </summary>
                    <div className="request-history">
                      <small>
                        {resolve(h.updatedBy)} ·{" "}
                        {new Date(h.updatedAt).toLocaleString()}
                      </small>
                      <p>
                        {h.subject} · {h.periodVersion} · Due{" "}
                        {evidenceDueDate(h.dueDate)}
                      </p>
                      <p>{h.description}</p>
                      <p>Responsible party: {h.responsibleParty}</p>
                      <p>Collection instructions: {h.handling}</p>
                      <div>
                        <b>Supported papers</b>
                        {h.paperIds.map((id) => {
                          const p = e.papers.find((p) => p.id === id);
                          return (
                            <button
                              type="button"
                              className="linked-record"
                              key={id}
                              disabled={!p}
                              onClick={() => p && onPaper(p)}
                            >
                              <span>
                                {p?.templateId ?? id} ·{" "}
                                {p?.title ?? "Unavailable paper reference"}
                              </span>
                              <ArrowUpRight size={14} aria-hidden="true" />
                            </button>
                          );
                        })}
                      </div>
                      <div>
                        <b>Received files</b>
                        {h.evidenceIds.length ? (
                          h.evidenceIds.map((id) => {
                            const artifact = e.artifacts.find(
                              (a) => a.id === id,
                            );
                            return (
                              <button
                                type="button"
                                className="linked-record"
                                key={id}
                                disabled={!artifact}
                                onClick={() => onArtifact(id)}
                              >
                                <span>
                                  {artifact?.name ??
                                    "Unavailable evidence reference"}
                                  <small>{id}</small>
                                </span>
                                <ArrowUpRight size={14} aria-hidden="true" />
                              </button>
                            );
                          })
                        ) : (
                          <p>No files recorded in this revision.</p>
                        )}
                      </div>
                      {h.deliveryComplete !== undefined && (
                        <p>
                          Delivery completeness:{" "}
                          {h.deliveryComplete
                            ? "Complete receipt recorded"
                            : "Partial delivery"}
                        </p>
                      )}
                      {h.remainingItems && (
                        <p>Outstanding: {h.remainingItems}</p>
                      )}
                      {h.limitationPaperId && (
                        <p>Decision memo reference: {h.limitationPaperId}</p>
                      )}
                      {h.response && <p>Receipt: {h.response}</p>}
                      {h.assessment && <p>Assessment: {h.assessment}</p>}
                    </div>
                  </details>
                ))
            ) : (
              <p className="subtle">
                This is the first revision of the request.
              </p>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
