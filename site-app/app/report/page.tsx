import type { BriefFields, Workflow } from "@/lib/workflow-types";
import type { Model, Report, Run, EvidenceRequest } from "@/lib/domain";
import { requestLabel } from "@/lib/evidence-requests";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { ApiError, context, getEngagement, sanitize } from "@/lib/store";
export const dynamic = "force-dynamic";
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  return <ReportBody params={params} />;
}
async function ReportBody({
  params,
}: {
  params: Record<string, string | undefined>;
}) {
  await requireChatGPTUser(
    "/report?" +
      new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter((v): v is [string, string] => !!v[1]),
        ),
      ),
  );
  try {
    const ctx = await context(params.tenantId),
      engagement = await getEngagement(ctx, params.engagementId ?? ""),
      e = sanitize(engagement, ctx),
      report = e.reports.find((r) => r.id === params.reportId);
    if (!report) throw new ApiError(404, "Released report not found");
    // Build the markup inside the try block so that a malformed snapshot still
    // renders the "Report unavailable" fallback below.
    return reportMarkup(report, report.snapshot as ReportSnapshot);
  } catch (error) {
    return (
      <main className="print-report">
        <h1>Report unavailable</h1>
        <p>
          {error instanceof ApiError
            ? error.message
            : "The report could not be loaded."}
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keeps the existing full-page navigation; <Link> would prefetch and soft-navigate */}
        <a href="/">Return to workspace</a>
      </main>
    );
  }
}

type ReportSnapshot = {
  scope?: BriefFields;
  workflow?: Workflow;
  engagement: {
    title: string;
    id: string;
    classification: {
      version: string;
      operatorRole: string;
      rationale: string;
    };
  };
  summary: string;
  opinion: string;
  limitations: string;
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

function reportMarkup(report: Report, s: ReportSnapshot) {
  const scope = s.scope ?? s.workflow?.brief;
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
      </header>
      <section>
        <h2>Scoped conclusion</h2>
        <h3>{s.opinion}</h3>
        <p>{s.summary}</p>
        <p>{s.limitations}</p>
      </section>
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
      <section>
        <h2>Regulatory assessment</h2>
        <p>
          Operator: {s.engagement.classification.operatorRole} · Regulatory
          version: {s.engagement.classification.version}
        </p>
        <p>{s.engagement.classification.rationale}</p>
      </section>
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
