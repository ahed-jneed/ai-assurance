"use client";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  FileText,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  finalReportGates,
  type Engagement,
  type Report,
  type Role,
} from "@/lib/domain";
import type { GateFeatures } from "@/lib/domain";
import {
  opinionLabel,
  termsLabel,
  type ReportTerms,
} from "@/lib/domain/report-model";
import { reportRows, type RegisterQuery } from "@/lib/register-views";
import {
  packageOpenLabel,
  packageStatus,
  packageStatusLabel,
} from "@/lib/report-presentation";
import { DatabaseToolbar } from "./database-toolbar";
import { RegisterControls } from "./register-controls";
import { ReportReadiness, type GateAction } from "./audit-gates";
import { QualityReviewPanel } from "./quality-review-panel";
import type { WorkspaceData } from "./workspace-types";

type Props = {
  engagement: Engagement;
  tenantId: string;
  role: Role;
  userId: string;
  people: WorkspaceData["people"];
  busy: boolean;
  terms: ReportTerms;
  onTerms: (value: ReportTerms) => void;
  onAudience: (paperId: string, audience: "internal" | "client") => void;
  onGate: GateAction;
  onCreate: (kind: "draft" | "final") => void;
  onOpen: (report: Report) => void;
  /** Runs an engagement command (the quality review's). */
  onAct: (op: string, data: Record<string, unknown>) => void;
  section: string;
  onSection: (value: string) => void;
  query: RegisterQuery;
  onQuery: (patch: Partial<RegisterQuery>) => void;
  onReset: () => void;
  /** What the engagement's criteria pack switches on (the classification gate). */
  features?: GateFeatures;
};

export function ReportWorkspace({
  engagement: e,
  tenantId,
  role,
  userId,
  people,
  busy,
  terms,
  onTerms,
  onAudience,
  onGate,
  onCreate,
  onOpen,
  onAct,
  section,
  onSection,
  query,
  onQuery,
  onReset,
  features,
}: Props) {
  const clientView = ["Client Viewer", "Client Contributor"].includes(role),
    lead = role === "Lead Auditor",
    qualityReviewer = role === "Engagement Quality Reviewer";
  const gates = clientView ? [] : finalReportGates(e, terms, features);
  const next =
    gates.find((g) => g.kind === "workflow") ??
    gates.find((g) => g.kind !== "stage") ??
    gates[0];
  const rows = reportRows(
    e.reports,
    clientView ? { ...query, facet: "all" } : query,
  );
  const latest = e.reports
    .filter((r) => r.kind === "final")
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const state = latest ? packageStatus(latest) : "";
  const needsPackage = !latest || ["withdrawn", "superseded"].includes(state);
  const activeStep = gates.length
    ? 0
    : !latest || ["withdrawn", "superseded"].includes(state)
      ? 1
      : state === "approved" || state === "released"
        ? 3
        : 2;
  const date = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  const library = (
    <section className="report-library">
      <DatabaseToolbar
        label="Reports"
        views={[
          { value: "all", label: "All packages" },
          { value: "draft", label: "Drafts" },
          { value: "final", label: "Final" },
        ]}
        value={query.view}
        onView={(view) => onQuery({ view })}
        search={query.search}
        onSearch={(search) => onQuery({ search })}
        count={rows.length}
      >
        {lead && e.reports.length > 0 && (
          <Button disabled={busy} onClick={() => onCreate("draft")}>
            Create snapshot
          </Button>
        )}
        {!clientView && (
          <RegisterControls
            facetLabel="Release status"
            facets={[
              "Internal",
              "Approved",
              "Released",
              "Superseded",
              "Withdrawn",
            ]}
            facet={query.facet}
            onFacet={(facet) => onQuery({ facet })}
            sort={query.sort}
            sorts={[
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
            ]}
            onSort={(sort) => onQuery({ sort })}
            active={
              !!query.search || query.view !== "all" || query.facet !== "all"
            }
            onClear={onReset}
          />
        )}
      </DatabaseToolbar>
      {rows.length ? (
        <>
          <div className="report-package-cards">
            {rows.map((r) => (
              <article className="report-package-card" key={r.id}>
                <header>
                  <button className="paper-link" onClick={() => onOpen(r)}>
                    {r.kind === "final" ? "Final report" : "Draft report"}
                  </button>
                  <span
                    className={
                      "badge " +
                      (["released", "approved"].includes(
                        packageStatus(r, clientView),
                      )
                        ? "green"
                        : "neutral")
                    }
                  >
                    {packageStatusLabel(r, clientView)}
                  </span>
                </header>
                <p>{opinionLabel(r.snapshot)}</p>
                <dl>
                  <div>
                    <dt>Captured</dt>
                    <dd>
                      <time dateTime={r.createdAt}>{date(r.createdAt)}</time>
                    </dd>
                  </div>
                  <div>
                    <dt>Included records</dt>
                    <dd>
                      {Array.isArray(r.snapshot.papers)
                        ? r.snapshot.papers.length
                        : 0}{" "}
                      papers ·{" "}
                      {Array.isArray(r.snapshot.findings)
                        ? r.snapshot.findings.length
                        : 0}{" "}
                      findings
                    </dd>
                  </div>
                  {!!r.replaces?.length && (
                    <div>
                      <dt>Replaces</dt>
                      <dd>{r.replaces.join(", ")}</dd>
                    </div>
                  )}
                  {!!r.supersededBy && (
                    <div>
                      <dt>Superseded by</dt>
                      <dd>{r.supersededBy}</dd>
                    </div>
                  )}
                </dl>
                <div className="report-card-actions">
                  <Button variant="outline" onClick={() => onOpen(r)}>
                    {packageOpenLabel(r, role, userId)}
                    <ArrowRight size={14} aria-hidden="true" />
                  </Button>
                  <a
                    className="download-link"
                    target="_blank"
                    rel="noreferrer"
                    href={
                      "/report?" +
                      new URLSearchParams({
                        tenantId,
                        engagementId: e.id,
                        reportId: r.id,
                      })
                    }
                  >
                    Print
                    <span className="sr-only">
                      {" "}
                      {r.kind} report captured {date(r.createdAt)} (opens a new
                      tab)
                    </span>
                  </a>
                </div>
              </article>
            ))}
          </div>
          <Table className="report-package-table">
            <TableHeader>
              <TableRow>
                <TableHead>Report package</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Opinion</TableHead>
                <TableHead>Captured</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <button className="paper-link" onClick={() => onOpen(r)}>
                      {r.kind === "final" ? "Final report" : "Draft report"}
                    </button>
                    <small className="block subtle">
                      {Array.isArray(r.snapshot.papers)
                        ? r.snapshot.papers.length
                        : 0}{" "}
                      papers ·{" "}
                      {Array.isArray(r.snapshot.findings)
                        ? r.snapshot.findings.length
                        : 0}{" "}
                      findings
                      {!!r.replaces?.length &&
                        " · replaces " + r.replaces.join(", ")}
                    </small>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        "badge " +
                        (["released", "approved"].includes(
                          packageStatus(r, clientView),
                        )
                          ? "green"
                          : ["withdrawn", "superseded"].includes(
                                packageStatus(r, clientView),
                              )
                            ? "neutral"
                            : "blue")
                      }
                    >
                      {packageStatusLabel(r, clientView)}
                    </span>
                  </TableCell>
                  <TableCell>{opinionLabel(r.snapshot)}</TableCell>
                  <TableCell>
                    <time dateTime={r.createdAt}>{date(r.createdAt)}</time>
                  </TableCell>
                  <TableCell>
                    <div className="report-row-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpen(r)}
                      >
                        {packageOpenLabel(r, role, userId)}
                        <ArrowRight size={14} aria-hidden="true" />
                      </Button>
                      <a
                        className="download-link"
                        target="_blank"
                        rel="noreferrer"
                        href={
                          "/report?" +
                          new URLSearchParams({
                            tenantId,
                            engagementId: e.id,
                            reportId: r.id,
                          })
                        }
                      >
                        Print
                        <span className="sr-only">
                          {" "}
                          {r.kind} report captured {date(r.createdAt)} (opens a
                          new tab)
                        </span>
                      </a>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : (
        <div className="report-empty">
          <div className="report-empty-icon">
            {e.reports.length ? (
              <Search size={23} aria-hidden="true" />
            ) : (
              <FileText size={25} aria-hidden="true" />
            )}
          </div>
          <h3>
            {e.reports.length
              ? "No packages match this view"
              : clientView
                ? "No reports released yet"
                : "Prepare your first report package"}
          </h3>
          <p>
            {e.reports.length
              ? "Clear the filters to see the available packages."
              : clientView
                ? "Released reports will appear here when the audit team completes the handoff."
                : "Capture a draft to review the evidence and conclusions collected so far."}
          </p>
          {e.reports.length ? (
            <Button variant="outline" onClick={onReset}>
              Clear filters
            </Button>
          ) : lead ? (
            <Button disabled={busy} onClick={() => onCreate("draft")}>
              Create draft snapshot
            </Button>
          ) : !clientView ? (
            <span className="subtle">
              A Lead Auditor creates report packages.
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
  if (clientView) return library;
  return (
    <div className="report-workspace">
      <section className="report-handoff" aria-label="Report handoff">
        <ol className="report-handoff-steps">
          {[
            "Complete audit",
            "Capture final package",
            "Independent approval",
            "Client release",
          ].map((label, i) => (
            <li
              key={label}
              aria-current={i === activeStep ? "step" : undefined}
              className={
                i < activeStep ||
                (i === 3 && state === "released" && !gates.length)
                  ? "complete"
                  : ""
              }
            >
              <span>
                {i < activeStep ||
                (i === 3 && state === "released" && !gates.length) ? (
                  <CheckCircle2 size={17} aria-hidden="true" />
                ) : (
                  <Circle size={17} aria-hidden="true" />
                )}
              </span>
              {label}
            </li>
          ))}
        </ol>
        <div className="report-next-step">
          <div>
            <span className={"badge " + (gates.length ? "amber" : "green")}>
              {gates.length
                ? "Final capture blocked"
                : "Final capture available"}
            </span>
            <h2>
              {gates.length
                ? next.title
                : state === "released"
                  ? "The latest final package is released"
                  : !needsPackage && latest
                    ? packageStatusLabel(latest)
                    : "The audit is ready for a final snapshot"}
            </h2>
            <p>
              {gates.length
                ? `${gates.length} ${gates.length === 1 ? "requirement remains" : "requirements remain"} for ${termsLabel(terms).toLowerCase()}. Draft snapshots are available throughout the audit.`
                : "Package approval and client release remain separate recorded decisions."}
            </p>
          </div>
          <div className="row-actions">
            {gates.length ? (
              <Button disabled={busy} onClick={() => onGate(next)}>
                Resolve next requirement
                <ArrowRight size={15} aria-hidden="true" />
              </Button>
            ) : !needsPackage && latest ? (
              <Button disabled={busy} onClick={() => onOpen(latest)}>
                {packageOpenLabel(latest, role, userId)}
                <ArrowRight size={15} aria-hidden="true" />
              </Button>
            ) : lead ? (
              <Button disabled={busy} onClick={() => onCreate("final")}>
                Prepare final snapshot
              </Button>
            ) : qualityReviewer ? (
              <span className="subtle">
                A Lead Auditor captures the final package for your sign-off.
              </span>
            ) : (
              <span className="subtle">
                A Lead Auditor captures the final package.
              </span>
            )}
          </div>
        </div>
      </section>
      <Tabs
        value={
          ["completion", "quality"].includes(section) ? section : "packages"
        }
        onValueChange={onSection}
        className="report-workspace-tabs"
      >
        <TabsList aria-label="Reporting workspace">
          <TabsTrigger value="packages">
            <FileText size={15} aria-hidden="true" />
            Report packages
            <span className="tab-record-count">{e.reports.length}</span>
          </TabsTrigger>
          <TabsTrigger value="completion">
            <ShieldCheck size={15} aria-hidden="true" />
            Completion checklist
            <span className="tab-record-count">{gates.length}</span>
          </TabsTrigger>
          <TabsTrigger value="quality">
            <UserCheck size={15} aria-hidden="true" />
            Quality review
          </TabsTrigger>
        </TabsList>
        <TabsContent value="packages">{library}</TabsContent>
        <TabsContent value="completion">
          <ReportReadiness
            engagement={e}
            role={role}
            userId={userId}
            terms={terms}
            onTerms={onTerms}
            onGate={onGate}
            onAudience={lead ? onAudience : undefined}
            busy={busy}
            features={features}
          />
        </TabsContent>
        <TabsContent value="quality">
          <QualityReviewPanel
            engagement={e}
            role={role}
            userId={userId}
            people={people}
            terms={terms}
            busy={busy}
            onAct={onAct}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
