"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CheckCircle2, Search } from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { paperAudience } from "@/lib/client-projection";
import {
  finalReportGates,
  paperCurrent,
  type AuditGate,
  type Engagement,
  type Role,
} from "@/lib/domain";
import {
  assuranceLevelIds,
  assuranceLevels,
  conclusionTypes,
  engagementTypeIds,
  engagementTypes,
  normalizeTerms,
  requiresSupport,
  termsLabel,
  type ReportTerms,
} from "@/lib/domain/report-model";
import { paperNextAction, type PaperTarget } from "@/lib/paper-workflow";
/** Report elements the approved brief and program supply. */
export const briefElements = [
  "report:subject",
  "report:criteria",
  "report:responsibilities",
  "report:independence",
  "report:work",
];
export type GateAction = (gate: AuditGate, target?: PaperTarget) => void;

export function AuditGateList({
  gates,
  engagement: e,
  role,
  userId,
  onGate,
  compact = false,
}: {
  gates: AuditGate[];
  engagement: Engagement;
  role: Role;
  userId: string;
  onGate?: GateAction;
  compact?: boolean;
}) {
  const groups = [
    "Scope & program",
    "Classification",
    "Evidence collection",
    "Paper preparation",
    "Independent review",
    "Paper signatures",
    "Conclusion exceptions",
    "Evaluations",
    "Findings",
    "Report elements",
    "Quality review",
    "Engagement stage",
  ];
  const group = (g: AuditGate) =>
    g.kind === "paper"
      ? {
          draft: "Paper preparation",
          in_review: "Independent review",
          reviewed: "Paper signatures",
          signed: "Paper signatures",
        }[e.papers.find((p) => p.id === g.recordId)?.status ?? "draft"]
      : {
          workflow: "Scope & program",
          classification: "Classification",
          run: "Evaluations",
          finding: "Findings",
          stage: "Engagement stage",
          request: "Evidence collection",
          conclusion: "Conclusion exceptions",
          report: "Report elements",
          quality_review: "Quality review",
        }[g.kind];
  function row(g: AuditGate) {
    const p = ["paper", "conclusion"].includes(g.kind)
        ? e.papers.find((p) => p.id === g.recordId)
        : undefined,
      next = p
        ? paperNextAction({ paper: p, artifacts: e.artifacts, role, userId })
        : undefined;
    const run =
      g.kind === "run" ? e.runs.find((r) => r.id === g.recordId) : undefined;
    const detail =
      next?.reason ??
      (g.kind === "stage"
        ? `Current stage: ${e.stage}. A Lead Auditor advances one stage at a time from Overview.`
        : g.kind === "classification"
          ? g.id === "prohibited"
            ? "Document the prohibited-practice assessment and issue an adverse conclusion or a disclaimer, as the evidence supports."
            : e.classification.intendedPurpose
              ? "Independent classification approval required."
              : "Record the intended purpose and risk route, then obtain independent approval."
          : g.kind === "finding"
            ? "An open High or Critical finding prevents an unmodified or readiness conclusion."
            : g.kind === "run"
              ? run?.state === "queued"
                ? "An Auditor or Lead Auditor executes or cancels this queued evaluation."
                : "Wait for execution to finish. A Lead Auditor can recover an interrupted run after two minutes."
              : g.kind === "report"
                ? briefElements.includes(g.id)
                  ? "The report states this from the approved brief and audit program."
                  : g.message
                : "");
    const request =
      g.kind === "request"
        ? e.evidenceRequests?.find((r) => r.id === g.recordId)
        : undefined;
    const guidance =
      g.kind === "conclusion"
        ? `Recorded conclusion: ${p?.body.conclusionStatus?.replaceAll("_", " ")}. Resolve and review a new revision, or select a modified conclusion that reflects the exception.`
        : g.kind === "request"
          ? request?.disposition === "unobtainable"
            ? "Unavailable evidence is a scope limitation: issue a qualified conclusion, or a disclaimer where its possible effects are pervasive."
            : `Responsible party: ${request?.responsibleParty ?? "Not recorded"}. Due ${request?.dueDate ?? "not recorded"}. Record a response and assess it, or obtain a Lead-approved limitation/scope decision.`
          : detail || g.message;
    const action = p
      ? next?.target === "review"
        ? "Review comments"
        : p.status === "draft"
          ? "Prepare paper"
          : p.status === "in_review"
            ? "Open review"
            : p.status === "reviewed"
              ? "Open sign-off"
              : "Open paper"
      : {
          paper: "Open paper",
          workflow: g.recordId ? "Open procedure" : "Open scope & program",
          classification: "Open assessment",
          request: "Assess receipt",
          run: "Open evaluation",
          finding: "Review remediation",
          stage: "Open lifecycle",
          conclusion: "Assess conclusion",
          report: briefElements.includes(g.id)
            ? "Open scope & program"
            : "Edit report terms",
          quality_review: "Open quality review",
        }[g.kind];
    const content = (
      <>
        <span className="audit-gate-description">
          <b>{g.title}</b>
          {guidance && <small>{guidance}</small>}
        </span>
        {onGate && (
          <span className="audit-gate-action">
            {action}
            <ArrowUpRight size={14} aria-hidden="true" />
          </span>
        )}
      </>
    );
    return onGate ? (
      <button
        type="button"
        className="audit-gate-row"
        key={g.id}
        onClick={() => onGate(g, next?.target)}
      >
        {content}
      </button>
    ) : (
      <div className="audit-gate-row" key={g.id}>
        {content}
      </div>
    );
  }
  return (
    <div className={"audit-gate-list " + (compact ? "compact" : "")}>
      {groups.map((label) => {
        const items = gates.filter((g) => group(g) === label);
        return items.length ? (
          <details
            className="audit-gate-group"
            key={label}
            open={items.length === 1}
          >
            <summary>
              <span className="gate-group-label">
                {label}
                <small>{items[0].title}</small>
              </span>
              <span className="count-label">{items.length}</span>
            </summary>
            <div>{items.map(row)}</div>
          </details>
        ) : null;
      })}
    </div>
  );
}

/**
 * The report terms: engagement type, assurance level (only where the type
 * provides assurance) and the conclusions the type can express.
 */
export function ReportTermsPicker({
  terms,
  onTerms,
}: {
  terms: ReportTerms;
  onTerms: (terms: ReportTerms) => void;
}) {
  const type = engagementTypes[terms.engagementType];
  const pick = (patch: Partial<Record<keyof ReportTerms, string>>) =>
    onTerms(normalizeTerms({ ...terms, ...patch }));
  return (
    <div className="report-terms">
      <label>
        Engagement type
        <Select
          value={terms.engagementType}
          onValueChange={(engagementType) => pick({ engagementType })}
        >
          <SelectTrigger aria-label="Engagement type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {engagementTypeIds.map((t) => (
              <SelectItem key={t} value={t}>
                {engagementTypes[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label>
        Assurance level
        <Select
          disabled={!type.assurance}
          value={terms.assuranceLevel ?? "none"}
          onValueChange={(assuranceLevel) => pick({ assuranceLevel })}
        >
          <SelectTrigger aria-label="Assurance level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {type.assurance ? (
              assuranceLevelIds.map((l) => (
                <SelectItem key={l} value={l}>
                  {assuranceLevels[l].label}
                </SelectItem>
              ))
            ) : (
              <SelectItem value="none">Not applicable</SelectItem>
            )}
          </SelectContent>
        </Select>
      </label>
      <label>
        Conclusion
        <Select
          value={terms.conclusion}
          onValueChange={(conclusion) => pick({ conclusion })}
        >
          <SelectTrigger aria-label="Conclusion">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {type.conclusions.map((c) => (
              <SelectItem key={c} value={c}>
                {conclusionTypes[c].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <p className="report-terms-guidance">
        <b>{termsLabel(terms)}.</b> {conclusionTypes[terms.conclusion].guidance}
        {!type.assurance &&
          " The report is labelled as not providing assurance."}
      </p>
    </div>
  );
}

export function ReportReadiness({
  engagement: e,
  role,
  userId,
  terms,
  onTerms,
  onGate,
  onAudience,
  busy = false,
}: {
  engagement: Engagement;
  role: Role;
  userId: string;
  terms: ReportTerms;
  onTerms: (terms: ReportTerms) => void;
  onGate: GateAction;
  /** Sets who a signed paper is written for; Lead Auditors only. */
  onAudience?: (paperId: string, audience: "internal" | "client") => void;
  busy?: boolean;
}) {
  const [search, setSearch] = useState("");
  const signed = e.papers.filter(
    (p) => paperCurrent(p) && p.status === "signed",
  );
  const gates = finalReportGates(e, terms),
    exceptions = e.findings.filter(
      (f) => f.status !== "closed" && ["High", "Critical"].includes(f.severity),
    ).length;
  const query = search.trim().toLowerCase(),
    visible = gates.filter(
      (g) =>
        !query || (g.title + " " + g.message).toLowerCase().includes(query),
    );
  return (
    <section className="report-readiness">
      <div className="readiness-heading">
        <div>
          <h2>Completion checklist</h2>
          <p className="subtle">
            {gates.length
              ? `${gates.length} ${gates.length === 1 ? "requirement remains" : "requirements remain"} before final capture`
              : "Completion gates met for the selected conclusion."}
          </p>
        </div>
      </div>
      <ReportTermsPicker terms={terms} onTerms={onTerms} />
      {!requiresSupport(terms.conclusion) && !!exceptions && (
        <p className="readiness-context">
          {exceptions} open High or Critical{" "}
          {exceptions === 1 ? "finding must" : "findings must"} be addressed in
          the conclusion and disclosures.
        </p>
      )}
      {!!gates.length && (
        <div className="completion-search">
          <Search size={16} aria-hidden="true" />
          <Input
            name="completionSearch"
            autoComplete="off"
            aria-label="Search completion requirements"
            placeholder="Find a paper, procedure or requirement…"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
          />
          {search && (
            <Button size="sm" variant="ghost" onClick={() => setSearch("")}>
              Clear
            </Button>
          )}
        </div>
      )}
      {gates.length ? (
        visible.length ? (
          <>
            <p className="checklist-match-count" role="status">
              {query
                ? `${visible.length} of ${gates.length} requirements match`
                : ""}
            </p>
            <AuditGateList
              gates={visible}
              engagement={e}
              role={role}
              userId={userId}
              onGate={onGate}
            />
          </>
        ) : (
          <div className="queue-empty">
            <span>No requirements match this search.</span>
            <Button variant="ghost" onClick={() => setSearch("")}>
              Clear search
            </Button>
          </div>
        )
      ) : (
        <div className="queue-empty">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>
            Classification, papers, evaluations and lifecycle are complete.
          </span>
        </div>
      )}
      {!!signed.length && (
        <details className="client-report-content">
          <summary>
            Client report content
            <span className="count-label">
              {signed.filter((p) => paperAudience(p) === "client").length} of{" "}
              {signed.length}
            </span>
          </summary>
          <p className="subtle">
            A released report publishes the conclusions of signed client papers.
            Memos stay internal unless a Lead Auditor shares them.
          </p>
          <ul>
            {signed.map((p) => (
              <li key={p.id}>
                <span>
                  <b>{p.templateId}</b> {p.title}
                </span>
                {onAudience ? (
                  <Select
                    disabled={busy}
                    value={paperAudience(p)}
                    onValueChange={(v) =>
                      onAudience(p.id, v === "client" ? "client" : "internal")
                    }
                  >
                    <SelectTrigger aria-label={"Audience of " + p.templateId}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client">Client</SelectItem>
                      <SelectItem value="internal">Internal</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="badge neutral">
                    {paperAudience(p) === "client" ? "Client" : "Internal"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
