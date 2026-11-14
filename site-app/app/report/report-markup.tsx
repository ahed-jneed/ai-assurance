// The printed report of a captured snapshot, internal or client. Kept apart
// from the route so tests can render it (docs/design/criteria-model.md
// section 16, test 8).
import type { BriefFields, Workflow } from "@/lib/workflow-types";
import type {
  Model,
  Report,
  Run,
  EvidenceRequest,
  RulePackStamp,
} from "@/lib/domain/types";
import type { CriteriaStamp } from "@/lib/criteria/types";
import type { Ll144Summary } from "@/lib/ll144-audit";
import type { CriterionResult } from "@/lib/domain/report-gates";
import {
  snapshotTerms,
  type ReportParticulars,
} from "@/lib/domain/report-model";
import { requestLabel } from "@/lib/evidence-requests";
import { reportDate } from "@/lib/report-presentation";
import { legalDate } from "@/lib/rule-pack";

export type ReportSnapshot = {
  scope?: BriefFields;
  workflow?: Workflow;
  engagement: {
    title: string;
    id: string;
    /** Captured only on packs with the AI Act classification. */
    classification?: {
      version: string;
      operatorRole: string;
      rationale: string;
    };
  };
  /** The criteria pack stamp (docs/design/criteria-model.md section 10). */
  criteriaPack?: CriteriaPackStamp;
  regulatorySource?: string;
  summary: string;
  opinion: string;
  limitations: string;
  /** Report model v2 (contractVersion 2.0); absent on older snapshots. */
  reportTitle?: string;
  particulars?: ReportParticulars;
  elements?: { id: string; label: string; value: string }[];
  conclusionStatement?: {
    heading: string;
    basisHeading: string;
    text: string;
    levelStatement: string;
    notAssurance: boolean;
    /** A draft captured while completion gates were open (#144). */
    draftCaveat?: string;
  };
  criteria?: CriterionResult[];
  /** The publishable summaries of the approved LL144 audits (#30). */
  ll144Summaries?: Ll144Summary[];
  /** The capture time, in both snapshots. */
  createdAt?: string;
  /** Recorded at capture from rule pack 2026.11.1 on; absent on older snapshots. */
  rulePack?: RulePackStamp;
  methodologyVersion?: string;
  papers: {
    id: string;
    title: string;
    templateId?: string;
    revision: number;
    status: string;
    conclusion?: string;
    conclusionStatus?: string;
    body?: Record<string, string>;
    evidenceIds?: string[];
  }[];
  findings: {
    id: string;
    title: string;
    severity: string;
    status: string;
    condition: string;
    remediation: string;
  }[];
  evidence: {
    id: string;
    name: string;
    sha256: string;
    category: string;
    status: string;
  }[];
  models?: Model[];
  runs?: Run[];
  evidenceRequests?: EvidenceRequest[];
  annexIV?: {
    number: number;
    title: string;
    state: string;
    paperIds: string[];
    candidateEvidenceIds: string[];
    gaps: string[];
  }[];
};

const criterionResults = {
  no_exceptions: "No exceptions noted",
  exceptions: "Exceptions noted",
  not_evaluated: "Not fully evaluated",
};
/**
 * The ISAE 3000 (Revised) report of a report model v2 snapshot: title,
 * addressee, subject matter and criteria, responsibilities, the standard
 * applied, independence and quality management, the summary of work, any
 * basis for modification, the conclusion, results by criterion and the
 * signature, date and location.
 */
function AssuranceReport({ s }: { s: ReportSnapshot }) {
  const c = s.conclusionStatement!,
    date = reportDate(s),
    element = (id: string) => s.elements?.find((e) => e.id === id),
    body = [
      "subject",
      "criteria",
      "responsibilities",
      "standard",
      "independence",
      "work",
    ];
  return (
    <>
      <section className="assurance-report">
        <h2>{s.reportTitle}</h2>
        {c.notAssurance && (
          <p>
            <strong>
              This is not an assurance report. It expresses no opinion or
              conclusion providing assurance.
            </strong>
          </p>
        )}
        <p>{"To: " + (s.particulars?.addressee || "Not recorded")}</p>
        {body.map((id) => {
          const el = element(id);
          return el ? (
            <div key={id}>
              <h3>{el.label}</h3>
              <p>{el.value}</p>
            </div>
          ) : null;
        })}
        <div>
          <h3>Executive summary</h3>
          <p>{s.summary}</p>
        </div>
        {c.basisHeading && (
          <div>
            <h3>{c.basisHeading}</h3>
            <p>{s.particulars?.basisForModification}</p>
          </div>
        )}
        <div className="assurance-conclusion">
          <h3>{c.heading}</h3>
          {c.draftCaveat && (
            <p className="report-draft-caveat">
              <strong>{c.draftCaveat}</strong>
            </p>
          )}
          <p>{c.text}</p>
          {c.levelStatement && <p>{c.levelStatement}</p>}
        </div>
        <p>{s.limitations}</p>
        <div className="report-signature">
          <p>{"Signed: " + (s.particulars?.signatory || "Not recorded")}</p>
          <p>
            Report date:{" "}
            {date
              ? new Date(date).toLocaleDateString("en-GB", {
                  timeZone: "Europe/Vienna",
                  dateStyle: "long",
                })
              : "Not recorded"}
          </p>
          <p>{"Location: " + (s.particulars?.location || "Not recorded")}</p>
        </div>
      </section>
      {!!s.criteria?.length && (
        <section>
          <h2>Results by criterion</h2>
          <table>
            <thead>
              <tr>
                <th>Criterion</th>
                <th>Procedures</th>
                <th>Exceptions</th>
                <th>Open findings</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {s.criteria.map((r) => (
                <tr key={r.criterion}>
                  <td>{r.criterion}</td>
                  <td>{r.procedures}</td>
                  <td>{r.exceptions}</td>
                  <td>
                    {r.openFindings}
                    {r.openHighFindings
                      ? " (" + r.openHighFindings + " High or Critical)"
                      : ""}
                  </td>
                  <td>{criterionResults[r.result] ?? r.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

export function reportMarkup(
  report: Report,
  s: ReportSnapshot,
  tenantId?: string,
) {
  const scope = s.scope ?? s.workflow?.brief,
    v2 = !!snapshotTerms(s) && !!s.conclusionStatement,
    supersededBy = report.supersededBy ?? report.release?.supersededBy;
  return (
    <main className="print-report">
      <nav className="print-toolbar">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keeps the existing full-page navigation; <Link> would prefetch and soft-navigate */}
        <a href="/">Return to workspace</a>
        <span>Use your browser&apos;s Print command to save a PDF.</span>
      </nav>
      <header>
        <p className="eyebrow">
          AI ASSURANCE · CONTROLLED {report.kind.toUpperCase()} REPORT
        </p>
        <h1>{s.engagement.title}</h1>
        <p className="report-meta">
          {report.id} · Created{" "}
          {new Date(report.createdAt).toLocaleString("en-GB", {
            timeZone: "Europe/Vienna",
          })}{" "}
          Europe/Vienna
        </p>
        {!!report.replaces?.length && (
          <p className="report-meta">Replaces {report.replaces.join(", ")}</p>
        )}
        {supersededBy && (
          <p className="report-meta report-superseded">
            Superseded by {supersededBy}. This report remains as it was issued.
          </p>
        )}
      </header>
      {v2 ? (
        <AssuranceReport s={s} />
      ) : (
        <section>
          <h2>Scoped conclusion</h2>
          <h3>{s.opinion}</h3>
          <p>{s.summary}</p>
          <p>{s.limitations}</p>
        </section>
      )}
      {scope && (
        <section>
          <h2>Agreed scope and audit period</h2>
          <h3>{scope.systemName}</h3>
          <p>
            {scope.periodStart} — {scope.periodEnd}
          </p>
          <p>Intended use: {scope.intendedUse}</p>
          <p>Boundary: {scope.boundary}</p>
          <p>Deliverables: {scope.deliverables}</p>
          {s.workflow && (
            <>
              <p>Actor responsibilities: {scope.actorResponsibilities}</p>
              <p>Criteria and period analysis: {scope.basis}</p>
              <p>Constraints: {scope.constraints}</p>
            </>
          )}
        </section>
      )}
      {s.workflow && (
        <section>
          <h2>Captured audit program</h2>
          <p>
            Program revision {s.workflow.program.revision} · scope revision{" "}
            {s.workflow.program.briefRevision}
          </p>
          {s.workflow.procedures.map((p) => (
            <article key={p.id}>
              <h3>
                {p.templateId} · {p.title}
              </h3>
              <p>
                {p.selected ? "Selected" : "Outside agreed scope"} ·{" "}
                {p.applicability}
              </p>
              <p>
                {p.criterion} · {p.sourceVersion}
              </p>
              <p>{p.periodAnalysis}</p>
              <p>{p.rationale}</p>
              {p.execution && (
                <>
                  <p>Performed: {p.execution.performed}</p>
                  <p>Sample: {p.execution.sampling}</p>
                  <p>Results: {p.execution.results}</p>
                  <p>Limitations: {p.execution.limitations}</p>
                  <p>Conclusion: {p.execution.assessment?.conclusion}</p>
                  <p>Independent review: {p.review?.reason}</p>
                </>
              )}
            </article>
          ))}
        </section>
      )}
      {s.engagement.classification ? (
        <RegulatoryAssessment
          s={s}
          classification={s.engagement.classification}
        />
      ) : (
        <section>
          <h2>Criteria</h2>
          <CriteriaPackLine s={s} />
          {s.regulatorySource && <p>Regulatory source: {s.regulatorySource}</p>}
        </section>
      )}
      <section>
        <h2>Working papers</h2>
        {s.papers.map((p) => (
          <article key={p.id}>
            <h3>
              {p.templateId ?? p.id} · {p.title}
            </h3>
            <p>
              Revision {p.revision} · {p.status} ·{" "}
              {p.conclusionStatus ?? p.body?.conclusionStatus}
            </p>
            <p>{p.conclusion ?? p.body?.conclusion}</p>
            {p.body?.limitations && <p>Limitations: {p.body.limitations}</p>}
          </article>
        ))}
      </section>
      <section>
        <h2>Findings & management action</h2>
        {s.findings.length ? (
          s.findings.map((f) => (
            <article key={f.id}>
              <h3>
                {f.id} · {f.title}
              </h3>
              <p>
                {f.severity} · {f.status}
              </p>
              <p>{f.condition}</p>
              <p>{f.remediation || "Remediation not recorded."}</p>
            </article>
          ))
        ) : (
          <p>No findings included in this package.</p>
        )}
      </section>
      {s.annexIV && (
        <section>
          <h2>Annex IV evidence compilation</h2>
          <p>
            Candidate evidence links support manual assessment. No section is
            automatically certified as complete.
          </p>
          {s.annexIV.map((section) => (
            <article key={section.number}>
              <h3>
                {section.number}. {section.title}
              </h3>
              <p>
                Assessment: {section.state} ·{" "}
                {section.candidateEvidenceIds.length} candidate evidence items
              </p>
              <p>{section.gaps.join("; ")}</p>
            </article>
          ))}
        </section>
      )}
      {s.models && (
        <section>
          <h2>Captured model versions</h2>
          {s.models.map((m) => (
            <article key={m.id}>
              <h3>
                {m.name} · {m.version}
              </h3>
              <p>
                {m.task} · {m.card?.framework ?? m.format}
              </p>
              <p>{m.intendedPurpose}</p>
              {m.card && (
                <>
                  <p>
                    Owner: {m.card.owner} · Output semantics:{" "}
                    {m.card.outputSemantics}
                  </p>
                  <p>Limitations: {m.card.limitations || "Not declared"}</p>
                </>
              )}
              <p className="report-hash">
                Source artifact: {m.artifactId} · SHA-256:{" "}
                {m.sourceSha256 ??
                  "Legacy registration; refer to evidence manifest"}
              </p>
            </article>
          ))}
        </section>
      )}
      {s.runs && (
        <section>
          <h2>Captured evaluations</h2>
          {s.runs.map((r) => (
            <article key={r.id}>
              <h3>
                {r.manifest?.model.name ?? r.modelId} ·{" "}
                {r.manifest?.model.version ?? "legacy"} · {r.state}
              </h3>
              <p>
                {r.manifest?.dataset.name ?? r.datasetId} · Protocol{" "}
                {r.manifest?.profile?.name ?? "Explicit configuration"}{" "}
                {r.manifest?.profile?.version ?? ""}
              </p>
              <p>
                Runner {r.provenance.runnerVersion} · Outcome{" "}
                {r.outcome ?? "pending"}
              </p>
              {r.results.map((result) => (
                <div key={result.testId}>
                  <h4>
                    {result.label} · {result.outcome}
                  </h4>
                  <table>
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Value</th>
                        <th>Unit</th>
                        <th>Rows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.metrics.map((metric) => (
                        <tr key={metric.name}>
                          <td>{metric.name.replaceAll("_", " ")}</td>
                          <td>
                            {metric.value === null
                              ? "Not estimable"
                              : Number(metric.value.toFixed(6))}
                          </td>
                          <td>{metric.unit}</td>
                          <td>{metric.sampleSize}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.limitations.map((l) => (
                    <p key={l}>Limitation: {l}</p>
                  ))}
                </div>
              ))}
              {r.error && <p>{r.error}</p>}
              <p className="report-hash">
                Run {r.id} · Dataset SHA-256 {r.provenance.inputHashes.dataset}{" "}
                · Manifest SHA-256{" "}
                {r.provenance.inputHashes.manifest ?? "Legacy"}
              </p>
            </article>
          ))}
        </section>
      )}
      {!!s.evidenceRequests?.length && (
        <section>
          <h2>Captured evidence requests & dispositions</h2>
          {s.evidenceRequests.map((r) => (
            <article key={r.id}>
              <h3>
                {r.subject} · {requestLabel(r)}
              </h3>
              <p>
                {r.responsibleParty} · Due {r.dueDate} · {r.periodVersion}
              </p>
              <p>{r.description}</p>
              {r.response && <p>Recorded receipt: {r.response}</p>}
              {r.assessment && <p>Assessment / disposition: {r.assessment}</p>}
              {r.limitationPaperId && (
                <p>Limitation memo: {r.limitationPaperId}</p>
              )}
            </article>
          ))}
        </section>
      )}
      {!!s.ll144Summaries?.length && (
        <section>
          <h2>NYC Local Law 144 bias audit summaries</h2>
          <ul>
            {s.ll144Summaries.map((x) => (
              <li key={x.auditId}>
                {x.tool.name}
                {x.classification &&
                  `, group ${x.classification.group} (${x.classification.groups.indexOf(x.classification.group) + 1} of ${x.classification.groups.length})`}
                : bias audit of {x.auditDate}, distribution date{" "}
                {x.tool.distributionDate}, {x.numberOfApplicants} individuals
                assessed.{" "}
                <a
                  href={
                    "/ll144-summary?" +
                    new URLSearchParams({
                      ...(tenantId ? { tenantId } : {}),
                      engagementId: s.engagement.id,
                      auditId: x.auditId,
                      reportId: report.id,
                    })
                  }
                >
                  Publishable summary
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2>Evidence manifest</h2>
        <table>
          <thead>
            <tr>
              <th>Artifact</th>
              <th>Category / acceptance</th>
              <th>SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {s.evidence.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>
                  {a.category} / {a.status}
                </td>
                <td className="report-hash">{a.sha256}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <footer>
        <p>
          Snapshot SHA-256: <span className="report-hash">{report.sha256}</span>
        </p>
        <p>
          This hash detects content changes. It does not establish external
          timestamping or a qualified electronic signature.
        </p>
      </footer>
    </main>
  );
}

/**
 * The captured criteria stamp. Snapshots captured before #61 have no
 * frameworks or crosswalks.
 */
type CriteriaPackStamp = Omit<CriteriaStamp, "frameworks" | "crosswalks"> &
  Partial<Pick<CriteriaStamp, "frameworks" | "crosswalks">>;
/**
 * The captured pack, framework data and crosswalk versions and, as it stood
 * at capture, the pending legal review.
 */
function CriteriaPackLine({ s }: { s: ReportSnapshot }) {
  if (!s.criteriaPack) return null;
  const { frameworks = [], crosswalks = [] } = s.criteriaPack;
  return (
    <>
      <p>
        Criteria pack {s.criteriaPack.packId} {s.criteriaPack.packVersion}
        {s.methodologyVersion ? " · methodology " + s.methodologyVersion : ""}
        {s.criteriaPack.legalReviewPending
          ? " · its legal content is pending qualified legal review"
          : ""}
      </p>
      {!!frameworks.length && (
        <p>
          Assessed against{" "}
          {frameworks
            .map((f) => `${f.id} ${f.edition} (data ${f.version})`)
            .join("; ")}
          {crosswalks.length
            ? " · crosswalks " +
              crosswalks.map((c) => c.id + " " + c.version).join("; ")
            : ""}
        </p>
      )}
    </>
  );
}
/** The AI Act classification as captured, with the rule pack it was made under. */
function RegulatoryAssessment({
  s,
  classification,
}: {
  s: ReportSnapshot;
  classification: NonNullable<ReportSnapshot["engagement"]["classification"]>;
}) {
  return (
    <section>
      <h2>Regulatory assessment</h2>
      <p>
        Operator: {classification.operatorRole} · Regulatory version:{" "}
        {classification.version}
      </p>
      {s.rulePack && (
        <p>
          Rule pack {s.rulePack.version} (legal text {s.rulePack.legalVersion},
          researched {legalDate(s.rulePack.researchedAsOf)}) · methodology{" "}
          {s.methodologyVersion}
          {s.rulePack.legalReview === "approved"
            ? ""
            : " · rule pack pending qualified legal review"}
        </p>
      )}
      <CriteriaPackLine s={s} />
      <p>{classification.rationale}</p>
    </section>
  );
}
