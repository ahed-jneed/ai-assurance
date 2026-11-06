"use client";
import { useState } from "react";
import { LockKeyhole, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { requestLabel } from "@/lib/evidence-requests";
import type { EvidenceRequest } from "@/lib/domain";
import { humanLabel, readableResults } from "@/lib/presentation";
import { legalDate } from "@/lib/rule-pack";
type Row = Record<string, unknown>;
const record = (v: unknown): v is Row =>
  !!v && typeof v === "object" && !Array.isArray(v);
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(record) : []);
const text = (v: unknown, fallback = "Not recorded") =>
  typeof v === "string" && v ? v : typeof v === "number" ? String(v) : fallback;
const date = (v: unknown) => {
  const value = new Date(text(v, ""));
  return Number.isNaN(value.getTime())
    ? "Not recorded"
    : value.toLocaleString();
};
const sections = {
  objective: "Objective",
  scope: "Scope & population",
  criteria: "Criteria & requirements",
  procedures: "Procedures performed",
  sampling: "Sampling & materiality",
  results: "Results & exceptions",
  limitations: "Evidence limitations",
  conclusion: "Auditor conclusion",
};
function State({ value }: { value: unknown }) {
  return (
    <span
      className={
        "badge " +
        (["signed", "accepted", "approved", "pass"].includes(text(value))
          ? "green"
          : ["High", "Critical", "fail", "failed"].includes(text(value))
            ? "red"
            : ["draft", "not_evaluated"].includes(text(value))
              ? "neutral"
              : "blue")
      }
    >
      {humanLabel(text(value))}
    </span>
  );
}
function Narrative({ value }: { value: Row }) {
  return (
    <>
      {Object.entries(sections).map(([key, label]) =>
        key in value ? (
          <section key={key} className="readable-section">
            <h3>{label}</h3>
            <p className="record-text">
              {key === "results"
                ? readableResults(text(value[key], ""))
                : text(value[key])}
            </p>
          </section>
        ) : null,
      )}
      {"conclusionStatus" in value && (
        <p>
          <span className="subtle">Conclusion </span>
          <State value={value.conclusionStatus} />
        </p>
      )}
    </>
  );
}
function Strings({
  value,
  resolve,
}: {
  value: unknown;
  resolve?: (id: string) => string;
}) {
  const values = Array.isArray(value) ? value : [];
  return values.length ? (
    <ul className="record-list">
      {values.map((v, i) => (
        <li key={i}>{resolve ? resolve(text(v, "")) : text(v)}</li>
      ))}
    </ul>
  ) : (
    <p className="subtle">None recorded.</p>
  );
}
function Checklist({ value }: { value: unknown }) {
  return (
    <ul className="record-list">
      {rows(value).map((item, i) => (
        <li key={text(item.id, String(i))}>
          {text(item.text)}
          {typeof item.specificDocumentRequired === "string" && (
            <small className="block subtle">
              {text(item.specificDocumentRequired)} required
            </small>
          )}
        </li>
      ))}
    </ul>
  );
}
function CapturedApprovals({ paper }: { paper: Row }) {
  const approvals = [
    ...rows(paper.reviews).map((r) => ({ ...r, action: "Independent review" })),
    ...rows(paper.signatures).map((r) => ({ ...r, action: "Sign-off" })),
  ];
  return (
    <section className="readable-section">
      <h3>Captured approvals</h3>
      {approvals.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Revision</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Identity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {approvals.map((r: Row, i) => (
              <TableRow key={i}>
                <TableCell>{text(r.action)}</TableCell>
                <TableCell>{text(r.revision)}</TableCell>
                <TableCell>{date(r.at)}</TableCell>
                <TableCell>
                  <details className="provenance">
                    <summary>Account & digest</summary>
                    <span className="hash-text">{text(r.userId)}</span>
                    {r.hash != null && (
                      <span className="hash-text">{text(r.hash)}</span>
                    )}
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="subtle">
          No approvals included in this captured revision.
        </p>
      )}
    </section>
  );
}
function CapturedRuns({
  runs,
  resolve,
}: {
  runs: Row[];
  resolve: (id: string) => string;
}) {
  return (
    <>
      {runs.map((run, i) => (
        <details className="captured-record" key={text(run.id, String(i))}>
          <summary>
            <span>Diagnostic run · {date(run.createdAt)}</span>
            <State value={run.state} />
            <State value={run.outcome ?? "pending"} />
          </summary>
          <dl className="document-properties">
            <div>
              <dt>Model version</dt>
              <dd>
                {record(run.manifest) && record(run.manifest.model)
                  ? text(run.manifest.model.name) +
                    " · " +
                    text(run.manifest.model.version)
                  : resolve(text(run.modelId, ""))}
              </dd>
            </div>
            <div>
              <dt>Protocol</dt>
              <dd>
                {record(run.manifest) && record(run.manifest.profile)
                  ? text(run.manifest.profile.name) +
                    " · " +
                    text(run.manifest.profile.version)
                  : "Legacy explicit configuration"}
              </dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd>{resolve(text(run.datasetId, ""))}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{date(run.completedAt)}</dd>
            </div>
          </dl>
          {rows(run.results).map((result, j) => (
            <section className="readable-section" key={j}>
              <h3>
                {text(result.label)} <State value={result.outcome} />
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Rows</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows(result.metrics).map((m, k) => (
                    <TableRow key={k}>
                      <TableCell>{humanLabel(text(m.name))}</TableCell>
                      <TableCell>
                        {m.value == null
                          ? "Not estimable"
                          : typeof m.value === "number"
                            ? Number(m.value.toFixed(4))
                            : text(m.value)}
                      </TableCell>
                      <TableCell>{text(m.unit, "—")}</TableCell>
                      <TableCell>{text(m.sampleSize)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <h3>Limitations</h3>
              <Strings value={result.limitations} />
            </section>
          ))}
          {run.error != null && (
            <p className="record-text">{text(run.error)}</p>
          )}
          <details className="provenance">
            <summary>Captured input & execution policy</summary>
            <span className="hash-text">
              Run: {text(run.id)} · Model: {text(run.modelId)}
            </span>
            {record(run.config) && (
              <dl className="record-fields">
                {Object.entries(run.config).map(([key, value]) => (
                  <div key={key}>
                    <dt>{humanLabel(key)}</dt>
                    <dd>{text(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {record(run.provenance) && (
              <span className="hash-text">
                Runner {text(run.provenance.runnerVersion)} · Policy{" "}
                {text(run.provenance.policyVersion)}
              </span>
            )}
          </details>
        </details>
      ))}
      {!runs.length && (
        <p className="empty-result">
          No diagnostic runs included in this package.
        </p>
      )}
    </>
  );
}
export function FrozenReportDetails({ value }: { value: Row }) {
  const snapshot = record(value.snapshot) ? value.snapshot : {},
    audit = record(snapshot.engagement) ? snapshot.engagement : {},
    classification = record(audit.classification) ? audit.classification : {},
    papers = rows(snapshot.papers),
    evidence = rows(snapshot.evidence),
    findings = rows(snapshot.findings),
    annex = rows(snapshot.annexIV),
    runs = rows(snapshot.runs),
    models = rows(snapshot.models),
    requests = rows(snapshot.evidenceRequests),
    [selectedPaper, setSelectedPaper] = useState<Row | null>(null);
  const workflow = record(snapshot.workflow) ? snapshot.workflow : null,
    scope = record(snapshot.scope)
      ? snapshot.scope
      : workflow && record(workflow.brief)
        ? workflow.brief
        : null;
  const captured = new Map(
    [...papers, ...evidence, ...findings].map((row) => [
      text(row.id, ""),
      text(row.title ?? row.name, text(row.id)),
    ]),
  );
  for (const m of models)
    captured.set(text(m.id, ""), text(m.name) + " · " + text(m.version));
  for (const run of runs)
    captured.set(text(run.id, ""), "Diagnostic run · " + date(run.createdAt));
  const resolve = (id: string) => captured.get(id) ?? id;
  const [section, setSection] = useState("summary");
  const reportSections = [
    { value: "summary", label: "Summary" },
    { value: "papers", label: "Papers", count: papers.length },
    ...(workflow ? [{ value: "program", label: "Scope & program" }] : []),
    { value: "findings", label: "Findings", count: findings.length },
    ...("annexIV" in snapshot ? [{ value: "annex", label: "Annex IV" }] : []),
    { value: "evidence", label: "Evidence", count: evidence.length },
    ...(requests.length
      ? [{ value: "requests", label: "Requests", count: requests.length }]
      : []),
    ...("runs" in snapshot
      ? [{ value: "runs", label: "Diagnostics", count: runs.length }]
      : []),
    ...("models" in snapshot
      ? [{ value: "models", label: "Models", count: models.length }]
      : []),
  ];
  const source =
    typeof snapshot.regulatorySource === "string" &&
    snapshot.regulatorySource.startsWith("https://")
      ? snapshot.regulatorySource
      : null;
  return (
    <>
      <div className="detail-status">
        <State value={value.kind} />
        <span className="fixed-snapshot">
          <LockKeyhole size={13} />
          Fixed snapshot
        </span>
      </div>
      {Array.isArray(value.replaces) && value.replaces.length > 0 && (
        <p className="subtle report-replaces">
          Replaces {value.replaces.map((id) => text(id)).join(", ")}. A released
          report is replaced when a newer one is released, so the earlier report
          is no longer listed.
        </p>
      )}
      <Tabs
        value={section}
        onValueChange={setSection}
        className="captured-report-tabs"
      >
        <label className="captured-section-select">
          Report section
          <select
            aria-label="Report section"
            name="reportSection"
            value={section}
            onChange={(ev) => setSection(ev.target.value)}
          >
            {reportSections.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
                {"count" in s ? " (" + s.count + ")" : ""}
              </option>
            ))}
          </select>
        </label>
        <TabsList aria-label="Captured report sections">
          {reportSections.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
              {"count" in s && (
                <span className="tab-record-count">{s.count}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="summary">
          <dl className="document-properties">
            <div>
              <dt>Engagement</dt>
              <dd>{text(audit.title)}</dd>
            </div>
            <div>
              <dt>Opinion</dt>
              <dd>{text(snapshot.opinion)}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>{date(value.createdAt ?? snapshot.createdAt)}</dd>
            </div>
            {"stage" in audit && (
              <div>
                <dt>Stage</dt>
                <dd>{text(audit.stage)}</dd>
              </div>
            )}
          </dl>
          <section className="readable-section">
            <h3>Executive summary</h3>
            <p className="record-text">{text(snapshot.summary)}</p>
          </section>
          <section className="readable-section">
            <h3>Scope & limitations</h3>
            {scope && (
              <>
                <dl className="document-properties">
                  <div>
                    <dt>System</dt>
                    <dd>{text(scope.systemName)}</dd>
                  </div>
                  <div>
                    <dt>Audit period</dt>
                    <dd>
                      {text(scope.periodStart)} — {text(scope.periodEnd)}
                    </dd>
                  </div>
                </dl>
                {[
                  ["intendedUse", "Intended use"],
                  ["boundary", "Audit boundary"],
                  ["deliverables", "Deliverables"],
                ].map(([k, t]) => (
                  <section className="readable-section" key={k}>
                    <h3>{t}</h3>
                    <p className="record-text">{text(scope[k])}</p>
                  </section>
                ))}
              </>
            )}
            <p className="record-text">{text(snapshot.limitations)}</p>
          </section>
          <details className="provenance">
            <summary>Captured classification & regulatory basis</summary>
            <dl className="document-properties">
              <div>
                <dt>Operator role</dt>
                <dd>{text(classification.operatorRole)}</dd>
              </div>
              <div>
                <dt>Route</dt>
                <dd>{text(classification.annexRoute)}</dd>
              </div>
              <div>
                <dt>Legal snapshot</dt>
                <dd>{text(classification.version)}</dd>
              </div>
              {snapshot.annexMapVersion != null && (
                <div>
                  <dt>Annex map</dt>
                  <dd>{text(snapshot.annexMapVersion)}</dd>
                </div>
              )}
              {record(snapshot.rulePack) && (
                <div>
                  <dt>Rule pack</dt>
                  <dd>
                    {text(snapshot.rulePack.version)}, researched{" "}
                    {legalDate(text(snapshot.rulePack.researchedAsOf))}
                    {snapshot.rulePack.legalReview === "approved"
                      ? ""
                      : " · pending legal review"}
                  </dd>
                </div>
              )}
              {snapshot.methodologyVersion != null && (
                <div>
                  <dt>Methodology</dt>
                  <dd>{text(snapshot.methodologyVersion)}</dd>
                </div>
              )}
            </dl>
            <p className="record-text">{text(classification.rationale)}</p>
            {source && (
              <a
                className="source-link"
                href={source}
                target="_blank"
                rel="noreferrer"
              >
                Recorded regulatory source
              </a>
            )}
          </details>
        </TabsContent>
        <TabsContent value="papers">
          {"papers" in snapshot ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Captured paper</TableHead>
                    <TableHead>Revision</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {papers.map((p, i) => (
                    <TableRow key={text(p.id, String(i))}>
                      <TableCell>
                        <button
                          className="paper-link"
                          onClick={() => setSelectedPaper(p)}
                        >
                          <FileText size={15} className="inline mr-2" />
                          {text(p.title)}
                        </button>
                        {p.templateId != null && (
                          <small className="subtle block">
                            {text(p.templateId)}
                          </small>
                        )}
                      </TableCell>
                      <TableCell>{text(p.revision)}</TableCell>
                      <TableCell>
                        <State value={p.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!papers.length && (
                <p className="empty-result">
                  No papers included in this package.
                </p>
              )}
            </>
          ) : (
            <p className="subtle">Not included in this released package.</p>
          )}
        </TabsContent>
        <TabsContent value="program">
          {scope && (
            <>
              <dl className="document-properties">
                <div>
                  <dt>Scope revision</dt>
                  <dd>
                    {text(scope.revision)} · {text(scope.status)}
                  </dd>
                </div>
                <div>
                  <dt>Program revision</dt>
                  <dd>
                    {workflow && record(workflow.program)
                      ? text(workflow.program.revision) +
                        " · " +
                        text(workflow.program.status)
                      : "Not captured"}
                  </dd>
                </div>
              </dl>
              {[
                ["actorResponsibilities", "Actor responsibilities"],
                ["basis", "Criteria and applicability dates"],
                ["audience", "Intended report users"],
                ["independence", "Independence and competence"],
                ["constraints", "Constraints"],
              ].map(([k, t]) => (
                <section className="readable-section" key={k}>
                  <h3>{t}</h3>
                  <p className="record-text">{text(scope[k])}</p>
                </section>
              ))}
            </>
          )}
          {rows(workflow?.procedures).map((p, i) => (
            <details className="captured-record" key={text(p.id, String(i))}>
              <summary>
                <span>
                  {text(p.templateId)} · {text(p.title)}
                </span>
                <span>
                  {p.selected ? "Selected" : "Outside scope"} ·{" "}
                  {text(p.applicability)}
                </span>
              </summary>
              {[
                ["criterion", "Criterion"],
                ["sourceVersion", "Source version"],
                ["periodAnalysis", "Period analysis"],
                ["rationale", "Scope rationale"],
                ["population", "Population"],
                ["sampling", "Planned sampling"],
              ].map(([k, t]) => (
                <section className="readable-section" key={k}>
                  <h3>{t}</h3>
                  <p className="record-text">{text(p[k])}</p>
                </section>
              ))}
              {record(p.execution) && (
                <>
                  <Narrative
                    value={{
                      procedures: p.execution.performed,
                      sampling: p.execution.sampling,
                      results: p.execution.results,
                      limitations: p.execution.limitations,
                    }}
                  />
                  {record(p.execution.assessment) && (
                    <Narrative
                      value={{
                        results:
                          "Relevance: " +
                          text(p.execution.assessment.relevance) +
                          " · Reliability: " +
                          text(p.execution.assessment.reliability) +
                          " · Coverage: " +
                          text(p.execution.assessment.coverage) +
                          " · Contradictions: " +
                          text(p.execution.assessment.contradictions),
                        conclusion: p.execution.assessment.conclusion,
                        conclusionStatus: p.execution.assessment.outcome,
                      }}
                    />
                  )}
                  <p>
                    Captured paper revision {text(p.paperRevision)} ·{" "}
                    {resolve(text(p.paperId, ""))}
                  </p>
                </>
              )}
              {record(p.review) && (
                <p>
                  Independent review: {text(p.review.reason)} ·{" "}
                  {date(p.review.at)}
                </p>
              )}
            </details>
          ))}
        </TabsContent>
        <TabsContent value="findings">
          {"findings" in snapshot ? (
            <>
              {findings.map((f, i) => (
                <details
                  className="captured-record"
                  key={text(f.id, String(i))}
                >
                  <summary>
                    <span>{text(f.title)}</span>
                    <State value={f.severity} />
                    <State value={f.status} />
                  </summary>
                  <dl className="document-properties">
                    <div>
                      <dt>Owner</dt>
                      <dd>{text(f.owner)}</dd>
                    </div>
                    <div>
                      <dt>Due date</dt>
                      <dd>{text(f.dueDate)}</dd>
                    </div>
                    <div>
                      <dt>Requirement</dt>
                      <dd>Article {text(f.article)}</dd>
                    </div>
                  </dl>
                  {[
                    ["condition", "Condition"],
                    ["criteria", "Criteria"],
                    ["cause", "Cause"],
                    ["effect", "Effect"],
                    ["response", "Management response"],
                    ["remediation", "Remediation & retest"],
                  ].map(([key, title]) => (
                    <section className="readable-section" key={key}>
                      <h3>{title}</h3>
                      <p className="record-text">{text(f[key])}</p>
                    </section>
                  ))}
                </details>
              ))}
              {!findings.length && (
                <p className="empty-result">
                  No findings included in this package.
                </p>
              )}
            </>
          ) : (
            <p className="subtle">Not included in this released package.</p>
          )}
        </TabsContent>
        <TabsContent value="annex">
          <p className="subtle annex-note">
            Candidate evidence requires a human assessment of the applicable
            subitems.
          </p>
          <Table className="annex-table">
            <TableHeader>
              <TableRow>
                <TableHead>Section</TableHead>
                <TableHead>Assessment</TableHead>
                <TableHead>Candidates</TableHead>
                <TableHead>Recorded gaps</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {annex.map((section, i) => {
                const gaps = Array.isArray(section.gaps) ? section.gaps : [],
                  specificGaps = gaps.filter(
                    (g) => !text(g, "").startsWith("Human assessment"),
                  ),
                  candidateIds = Array.isArray(section.candidateEvidenceIds)
                    ? section.candidateEvidenceIds
                    : [];
                return (
                  <TableRow key={text(section.number, String(i))}>
                    <TableCell>
                      <details className="annex-section">
                        <summary>
                          <span className="subtle">
                            {text(section.number)}.
                          </span>{" "}
                          {text(section.title)}
                        </summary>
                        <div>
                          <p className="subtle">{text(section.reference)}</p>
                          <h3>Captured papers</h3>
                          {Array.isArray(section.paperIds) &&
                            section.paperIds.map((id, j) => {
                              const p = papers.find((p) => p.id === id);
                              return p ? (
                                <button
                                  key={j}
                                  className="paper-link annex-paper"
                                  onClick={() => setSelectedPaper(p)}
                                >
                                  {text(p.title)}{" "}
                                  <small>Revision {text(p.revision)}</small>
                                </button>
                              ) : (
                                <p className="subtle" key={j}>
                                  Paper not included in this package.
                                </p>
                              );
                            })}
                          <h3>Candidate evidence</h3>
                          <Strings
                            value={section.candidateEvidenceIds}
                            resolve={resolve}
                          />
                          <h3>Evidence checklist</h3>
                          <Checklist value={section.checklist} />
                          <h3>Recorded gaps & review requirements</h3>
                          <Strings value={section.gaps} />
                        </div>
                      </details>
                    </TableCell>
                    <TableCell>
                      <span className="badge neutral">
                        {section.state === "candidate_evidence_present"
                          ? "Candidates found"
                          : humanLabel(text(section.state))}
                      </span>
                    </TableCell>
                    <TableCell>{candidateIds.length}</TableCell>
                    <TableCell>{specificGaps.length}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="evidence">
          {"evidence" in snapshot ? (
            <>
              {evidence.map((a, i) => (
                <details
                  className="captured-record"
                  key={text(a.id, String(i))}
                >
                  <summary>
                    <span>{text(a.name)}</span>
                    <span className="subtle">{text(a.category)}</span>
                    <State value={a.status} />
                  </summary>
                  <dl className="document-properties">
                    <div>
                      <dt>Size</dt>
                      <dd>
                        {typeof a.size === "number"
                          ? (a.size / 1024).toFixed(1) + " KB"
                          : "Not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt>Uploaded</dt>
                      <dd>{date(a.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Visibility</dt>
                      <dd>{text(a.visibility)}</dd>
                    </div>
                  </dl>
                  <details className="provenance">
                    <summary>Captured digest</summary>
                    <span className="hash-text">{text(a.sha256)}</span>
                  </details>
                </details>
              ))}
              {!evidence.length && (
                <p className="empty-result">
                  No evidence included in this package.
                </p>
              )}
            </>
          ) : (
            <p className="subtle">Not included in this released package.</p>
          )}
        </TabsContent>
        <TabsContent value="requests">
          {requests.map((r, i) => (
            <details className="captured-record" key={text(r.id, String(i))}>
              <summary>
                <span>{text(r.subject)}</span>
                <span className="badge neutral">
                  {requestLabel(r as unknown as EvidenceRequest)}
                </span>
              </summary>
              <dl className="document-properties">
                <div>
                  <dt>Responsible party</dt>
                  <dd>{text(r.responsibleParty)}</dd>
                </div>
                <div>
                  <dt>Period / version</dt>
                  <dd>{text(r.periodVersion)}</dd>
                </div>
                <div>
                  <dt>Due</dt>
                  <dd>{text(r.dueDate)}</dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>{text(r.revision)}</dd>
                </div>
              </dl>
              {[
                ["description", "Expected deliverable"],
                ["handling", "Collection instructions"],
                ["response", "Auditor-recorded receipt"],
                ["assessment", "Assessment / disposition rationale"],
              ].map(([key, label]) => (
                <section className="readable-section" key={key}>
                  <h3>{label}</h3>
                  <p className="record-text">{text(r[key])}</p>
                </section>
              ))}
              <h3>Captured evidence references</h3>
              <Strings value={r.evidenceIds} resolve={resolve} />
              <h3>Captured working papers</h3>
              <Strings value={r.paperIds} resolve={resolve} />
              {typeof r.limitationPaperId === "string" && (
                <p>Limitation memo: {resolve(r.limitationPaperId)}</p>
              )}
            </details>
          ))}
        </TabsContent>
        <TabsContent value="models">
          {models.map((m, i) => (
            <details className="captured-record" key={text(m.id, String(i))}>
              <summary>
                <span>
                  {text(m.name)} · {text(m.version)}
                </span>
                <span className="subtle">{text(m.task)}</span>
              </summary>
              <section className="readable-section">
                <h3>Intended use</h3>
                <p>{text(m.intendedPurpose)}</p>
              </section>
              {record(m.card) &&
                Object.entries(m.card)
                  .filter(
                    ([k, v]) =>
                      typeof v === "string" && v && k !== "schemaVersion",
                  )
                  .map(([k, v]) => (
                    <section className="readable-section" key={k}>
                      <h3>{humanLabel(k)}</h3>
                      <p>{text(v)}</p>
                    </section>
                  ))}
              <details className="provenance">
                <summary>Captured evidence pin</summary>
                <p>{resolve(text(m.artifactId, ""))}</p>
                <span className="hash-text">{text(m.sourceSha256)}</span>
              </details>
            </details>
          ))}
        </TabsContent>
        <TabsContent value="runs">
          <CapturedRuns runs={runs} resolve={resolve} />
        </TabsContent>
      </Tabs>
      <details className="provenance">
        <summary>Package integrity</summary>
        <span className="hash-text">SHA-256: {text(value.sha256)}</span>
        {value.actor != null && (
          <span className="hash-text">
            Creator account: {text(value.actor)}
          </span>
        )}
        {snapshot.auditEventHead != null && (
          <span className="hash-text">
            Captured event head: {text(snapshot.auditEventHead)}
          </span>
        )}
      </details>
      <Dialog
        open={!!selectedPaper}
        onOpenChange={(open) => {
          if (!open) setSelectedPaper(null);
        }}
      >
        <DialogContent className="audit-dialog captured-paper-dialog">
          <DialogHeader>
            <DialogTitle>{text(selectedPaper?.title)}</DialogTitle>
            <DialogDescription>
              Captured revision {text(selectedPaper?.revision)} · Read only
            </DialogDescription>
          </DialogHeader>
          {selectedPaper && (
            <>
              <div className="detail-status">
                <State value={selectedPaper.status} />
                <span className="fixed-snapshot">
                  <LockKeyhole size={13} />
                  Fixed snapshot
                </span>
              </div>
              {record(selectedPaper.body) ? (
                <Narrative value={selectedPaper.body} />
              ) : (
                <section className="readable-section">
                  <h3>Auditor conclusion</h3>
                  <p className="record-text">
                    {text(selectedPaper.conclusion)}
                  </p>
                  <State value={selectedPaper.conclusionStatus} />
                </section>
              )}
              <section className="readable-section">
                <h3>Captured evidence</h3>
                {Array.isArray(selectedPaper.evidenceIds) ? (
                  <Strings
                    value={selectedPaper.evidenceIds}
                    resolve={resolve}
                  />
                ) : (
                  <p className="subtle">Not included in this released paper.</p>
                )}
              </section>
              {"runIds" in selectedPaper && (
                <section className="readable-section">
                  <h3>Captured diagnostics</h3>
                  <Strings value={selectedPaper.runIds} resolve={resolve} />
                </section>
              )}
              {("reviews" in selectedPaper ||
                "signatures" in selectedPaper) && (
                <CapturedApprovals paper={selectedPaper} />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
