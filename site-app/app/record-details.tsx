"use client";
import { useState, type ReactNode } from "react";
import { findingDue } from "./audit-registers";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FrozenReportDetails } from "./report-details";
import { FindingActions } from "./finding-actions";
import { SpecialCategoryRecord } from "./special-category";
import { performancePositiveLabel, protocolConfigKeys } from "@/lib/evaluation";
import { humanLabel, readableResults } from "@/lib/presentation";
import { describePlan } from "@/lib/hosted-statistics";
import { StatisticsResult } from "./statistics-result";
import { legacyConfig } from "@/lib/domain";
import type {
  Engagement,
  Run,
  Result,
  Metric,
  Paper,
  Finding,
  Role,
} from "@/lib/domain";

type RecordValue = Record<string, unknown>;
const isRecord = (v: unknown): v is RecordValue =>
  !!v && typeof v === "object" && !Array.isArray(v);
const provenanceKeys = new Set([
  "sha256",
  "hash",
  "previous_hash",
  "previousHash",
  "auditEventHead",
  "eventHead",
  "provenance",
  "key",
  "contractVersion",
  "annexMapVersion",
]);
const date = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
};
function State({ value }: { value: string }) {
  const color = [
    "pass",
    "signed",
    "accepted",
    "approved",
    "succeeded",
    "active",
    "closed",
  ].includes(value)
    ? "green"
    : ["fail", "failed", "Critical", "High", "revoked"].includes(value)
      ? "red"
      : "neutral";
  return <span className={"badge " + color}>{humanLabel(value)}</span>;
}
function PlainValue({
  value,
  name,
  resolve,
}: {
  value: unknown;
  name: string;
  resolve: (id: string) => string;
}) {
  if (name === "details" && typeof value === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {}
    if (isRecord(parsed))
      return <RecordFields value={parsed} resolve={resolve} />;
  }
  if (value === null || value === undefined || value === "")
    return <span className="subtle">Not recorded</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number")
    return (
      <span>
        {Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4)}
      </span>
    );
  if (typeof value === "string")
    return (
      <span className="record-text">
        {/(?:At|_at)$/.test(name)
          ? date(value)
          : /Ids?$/.test(name) ||
              [
                "actor",
                "author",
                "approvedBy",
                "closedBy",
                "uploadedBy",
              ].includes(name)
            ? resolve(value)
            : name === "results"
              ? readableResults(value)
              : [
                    "action",
                    "status",
                    "state",
                    "kind",
                    "outcome",
                    "conclusionStatus",
                    "automationMode",
                  ].includes(name)
                ? humanLabel(value)
                : value}
      </span>
    );
  if (Array.isArray(value)) {
    if (!value.length) return <span className="subtle">None</span>;
    if (value.every((v) => !isRecord(v) && !Array.isArray(v)))
      return (
        <ul className="record-list">
          {value.map((v, i) => (
            <li key={i}>
              <PlainValue
                value={v}
                name={name.endsWith("Ids") ? name.slice(0, -1) : name}
                resolve={resolve}
              />
            </li>
          ))}
        </ul>
      );
    return (
      <div className="record-stack">
        {value.map((v, i) =>
          isRecord(v) ? (
            <details className="record-item" key={i}>
              <summary>
                <span>
                  {String(v.title ?? v.label ?? v.name ?? "Item " + (i + 1))}
                </span>
                {v.revision != null && <small>v{String(v.revision)}</small>}
                {typeof v.status === "string" && <State value={v.status} />}
              </summary>
              <RecordFields
                value={v}
                resolve={resolve}
                omit={["title", "label", "name"]}
              />
            </details>
          ) : (
            <div className="record-item" key={i}>
              <PlainValue value={v} name={name} resolve={resolve} />
            </div>
          ),
        )}
      </div>
    );
  }
  return isRecord(value) ? (
    <RecordFields value={value} resolve={resolve} />
  ) : null;
}
export function RecordFields({
  value,
  resolve,
  omit = [],
}: {
  value: RecordValue;
  resolve: (id: string) => string;
  omit?: string[];
}) {
  const fields = Object.entries(value).filter(
    ([k]) => !omit.includes(k) && !provenanceKeys.has(k),
  );
  const provenance = Object.entries(value).filter(([k]) =>
    provenanceKeys.has(k),
  );
  return (
    <>
      <dl className="record-fields">
        {fields.map(([key, v]) => (
          <div key={key}>
            <dt>{humanLabel(key)}</dt>
            <dd>
              <PlainValue value={v} name={key} resolve={resolve} />
            </dd>
          </div>
        ))}
      </dl>
      {provenance.length > 0 && (
        <details className="provenance">
          <summary>Technical provenance</summary>
          <dl className="record-fields">
            {provenance.map(([key, v]) => (
              <div key={key}>
                <dt>{humanLabel(key)}</dt>
                <dd>
                  <PlainValue value={v} name={key} resolve={resolve} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}
export function ApprovalTable({
  paper,
  resolve,
}: {
  paper: Paper;
  resolve: (id: string) => string;
}) {
  const rows = [
    ...paper.reviews.map((r) => ({
      ...r,
      action: "Independent review",
      hash: "",
    })),
    ...paper.signatures.map((s) => ({ ...s, action: "Sign-off" })),
  ];
  return rows.length ? (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Action</TableHead>
          <TableHead>Person</TableHead>
          <TableHead>Revision</TableHead>
          <TableHead>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            <TableCell>{row.action}</TableCell>
            <TableCell>{resolve(row.userId)}</TableCell>
            <TableCell>v{row.revision}</TableCell>
            <TableCell>
              {date(row.at)}
              {row.hash && (
                <details className="provenance">
                  <summary>Digest</summary>
                  <span className="hash-text">{row.hash}</span>
                </details>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ) : (
    <p className="subtle">No reviews or sign-offs yet.</p>
  );
}
function formatMetric(metric: Metric) {
  if (metric.value === null) return "Not estimable";
  if (metric.name.includes("gap"))
    return (metric.value * 100).toFixed(2) + " pp";
  if (metric.name.includes("ratio")) return metric.value.toFixed(3);
  if (
    [
      "accuracy",
      "precision",
      "recall",
      "f1",
      "macro_f1",
      "balanced_accuracy",
      "specificity",
      "prevalence",
      "majority_baseline_accuracy",
    ].includes(metric.name)
  )
    return (metric.value * 100).toFixed(1) + "%";
  return metric.value.toFixed(4);
}
function GroupDetail({ value }: { value: unknown }) {
  if (
    Array.isArray(value) &&
    value.length &&
    isRecord(value[0]) &&
    "support" in value[0]
  )
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {[
              "Class",
              "Reference rows",
              "Predicted rows",
              "Precision",
              "Recall",
              "F1",
            ].map((v) => (
              <TableHead key={v}>{v}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {value.map((g, i) => (
            <TableRow key={i}>
              <TableCell>{String(g.label)}</TableCell>
              <TableCell>{String(g.support)}</TableCell>
              <TableCell>{String(g.predicted)}</TableCell>
              {["precision", "recall", "f1"].map((key) => (
                <TableCell key={key}>
                  {typeof g[key] === "number"
                    ? (g[key] * 100).toFixed(1) + "%"
                    : "Not estimable"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  if (
    Array.isArray(value) &&
    value.length &&
    isRecord(value[0]) &&
    "group" in value[0]
  )
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {[
              "Group",
              "Rows",
              "Selection rate",
              "True positive rate",
              "False positive rate",
            ].map((v) => (
              <TableHead key={v}>{v}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {value.map((g, i) => (
            <TableRow key={i}>
              <TableCell>{String(g.group)}</TableCell>
              <TableCell>{String(g.n)}</TableCell>
              {["rate", "tpr", "fpr"].map((key) => (
                <TableCell key={key}>
                  {typeof g[key] === "number"
                    ? (g[key] * 100).toFixed(1) + "%"
                    : "Not estimable"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  if (isRecord(value) && "tp" in value)
    return (
      <div className="confusion-grid">
        {[
          ["True positives", "tp"],
          ["False positives", "fp"],
          ["False negatives", "fn"],
          ["True negatives", "tn"],
        ].map(([label, key]) => (
          <div key={key}>
            <span>{label}</span>
            <b>{String(value[key])}</b>
          </div>
        ))}
      </div>
    );
  return null;
}
/** The criterion text of a frozen 1.0-1.2 result, from its run's legacy thresholds. */
function Criterion({ result, run }: { result: Result; run: Run }) {
  const c = legacyConfig(run.config);
  if (!c) return <span>Pre-registered statistics plan</span>;
  return (
    <span>
      {result.testId === "performance"
        ? "Accuracy ≥ " +
          (c.minimumAccuracy * 100).toFixed(1) +
          "%" +
          (run.task === "Multiclass classification"
            ? " · Macro F1 ≥ " +
              ((c.minimumMacroF1 ?? 0.7) * 100).toFixed(1) +
              "%"
            : c.minimumRecall !== undefined
              ? " · Recall of '" +
                performancePositiveLabel(c) +
                "' ≥ " +
                (c.minimumRecall * 100).toFixed(1) +
                "%"
              : "")
        : result.testId === "regression"
          ? "RMSE ≤ " + c.maximumRmse + " target units"
          : result.testId === "disparate_impact"
            ? "Impact ratio ≥ " + c.minimumImpactRatio
            : "Maximum gap ≤ " +
              (
                (result.testId === "equalized_odds"
                  ? (c.maximumOddsGap ?? c.maximumParityGap)
                  : c.maximumParityGap) * 100
              ).toFixed(1) +
              " pp"}
    </span>
  );
}

export function RunDetails({
  run,
  engagement,
  onPaper,
  resolve,
}: {
  run: Run;
  engagement?: Engagement | null;
  onPaper: (p: Paper) => void;
  resolve: (id: string) => string;
}) {
  return (
    <>
      <div className="detail-status">
        <State value={run.state} />
        <State value={run.outcome ?? "pending"} />
        <span className="subtle">{date(run.createdAt)}</span>
      </div>
      {run.error && <p className="error-banner">{run.error}</p>}
      <Tabs defaultValue="results">
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="inputs">Inputs & policy</TabsTrigger>
          <TabsTrigger value="papers">Generated papers</TabsTrigger>
        </TabsList>
        <TabsContent value="results">
          <div className="record-stack">
            {run.results.length ? (
              run.results.map((result) => (
                <section className="result-section" key={result.testId}>
                  <div className="panel-head">
                    <h3>{result.label}</h3>
                    <State value={result.outcome} />
                  </div>
                  <div className="content-pad">
                    {result.decision ? (
                      <StatisticsResult result={result} />
                    ) : (
                      <>
                        <p className="criterion">
                          <Criterion result={result} run={run} />
                          <span className="subtle"> · Internal policy</span>
                        </p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Metric</TableHead>
                              <TableHead>Result</TableHead>
                              <TableHead>Rows</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {result.metrics.map((metric) => (
                              <TableRow key={metric.name}>
                                <TableCell>{humanLabel(metric.name)}</TableCell>
                                <TableCell>
                                  <b>{formatMetric(metric)}</b>
                                </TableCell>
                                <TableCell>
                                  {metric.sampleSize.toLocaleString()}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {result.metrics
                          .filter((m) => m.details)
                          .map((m) => (
                            <GroupDetail key={m.name} value={m.details} />
                          ))}
                      </>
                    )}
                    <details className="provenance">
                      <summary>Limitations</summary>
                      <ul className="record-list">
                        {result.limitations.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    </details>
                  </div>
                </section>
              ))
            ) : (
              <p className="subtle">
                Results will appear when execution completes.
              </p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="inputs">
          {run.manifest && (
            <>
              <section className="readable-section">
                <h3>Frozen evaluation manifest</h3>
                <p>
                  {run.manifest.model.name} · version{" "}
                  {run.manifest.model.version} · {run.manifest.model.task}
                </p>
                <p>
                  {run.manifest.dataset.name} · {run.manifest.dataset.rowCount}{" "}
                  rows · {run.manifest.executionMode.replaceAll("_", " ")}
                </p>
                <p>
                  {run.manifest.profile?.name ?? "Explicit configuration"} ·{" "}
                  {run.manifest.profile?.version ?? "Legacy"}
                </p>
                <ul className="record-list">
                  {run.manifest.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </section>
              {run.manifest.profile?.specialCategory && (
                <section className="readable-section">
                  <h3>Special-category data</h3>
                  <SpecialCategoryRecord
                    declaration={run.manifest.profile.specialCategory}
                    acknowledgement={
                      run.manifest.specialCategoryAcknowledgement
                    }
                  />
                </section>
              )}
              {run.manifest.profile && (
                <details className="ml-more">
                  <summary>Captured dataset declarations & criteria</summary>
                  <RecordFields
                    value={{
                      ...run.manifest.profile.datasetContext,
                      rationale: run.manifest.profile.rationale,
                    }}
                    resolve={resolve}
                  />
                </details>
              )}
              <details className="ml-more">
                <summary>Captured model card</summary>
                <RecordFields
                  value={{ ...run.manifest.model }}
                  resolve={resolve}
                />
              </details>
            </>
          )}
          <RecordFields
            value={{
              modelId: run.modelId,
              datasetId: run.datasetId,
              procedures: run.suite.map(
                (id) =>
                  run.results.find((r) => r.testId === id)?.label ??
                  humanLabel(id),
              ),
              mappingsAndCriteria: Object.fromEntries(
                Object.entries(run.config).filter(([key]) =>
                  protocolConfigKeys(
                    run.task ?? "Binary classification",
                    run.suite,
                  ).includes(key),
                ),
              ),
              ...(run.manifest?.statistics
                ? {
                    statisticsPlan: describePlan(run.manifest.statistics),
                    statisticsPlanSha256:
                      run.provenance.inputHashes.statisticsPlan,
                  }
                : {}),
              policy: {
                source: run.thresholds.source,
                version: run.provenance.policyVersion,
                frozenAt: run.thresholds.frozenAt,
                frozenBy: run.thresholds.frozenBy,
              },
              seed: run.seed,
              provenance: run.provenance,
            }}
            resolve={resolve}
          />
        </TabsContent>
        <TabsContent value="papers">
          <div className="record-stack">
            {run.paperIds.map((id) => {
              const p = engagement?.papers.find((p) => p.id === id);
              return p ? (
                <Button key={id} variant="outline" onClick={() => onPaper(p)}>
                  {p.templateId} · {p.title}
                </Button>
              ) : (
                <p key={id}>{resolve(id)}</p>
              );
            })}
            {!run.paperIds.length && (
              <p className="subtle">No generated working papers.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
function TemplateDetails({
  record,
  resolve,
}: {
  record: RecordValue;
  resolve: (id: string) => string;
}) {
  return (
    <>
      <div className="detail-status">
        <span className="badge neutral">{String(record.id)}</span>
        <State value={String(record.kind)} />
        <span className="subtle">{String(record.stage)}</span>
      </div>
      <section className="readable-section">
        <h3>Objective</h3>
        <p>{String(record.objective)}</p>
      </section>
      <section className="readable-section">
        <h3>Audit procedures</h3>
        <ol className="procedure-list">
          {Array.isArray(record.procedures) &&
            record.procedures.map((p, i) => (
              <li key={i}>{isRecord(p) ? String(p.text) : String(p)}</li>
            ))}
        </ol>
      </section>
      <section className="readable-section">
        <h3>Required evidence</h3>
        <PlainValue
          value={record.evidenceRequired}
          name="evidenceRequired"
          resolve={resolve}
        />
      </section>
      {Array.isArray(record.regulatoryRefs) &&
        record.regulatoryRefs.length > 0 && (
          <section className="readable-section">
            <h3>Requirements</h3>
            <PlainValue
              value={record.regulatoryRefs}
              name="regulatoryRefs"
              resolve={resolve}
            />
          </section>
        )}
      <section className="readable-section">
        <h3>Completion requirement</h3>
        <p>
          {String(
            record.signOffGate ??
              "Independent review of the completed working paper.",
          )}
        </p>
      </section>
    </>
  );
}
function FindingDetails({
  record,
  resolve,
  engagement,
  role,
  userId,
  busy,
  onRemediate,
  onRetest,
  findingReview,
}: {
  record: RecordValue;
  resolve: (id: string) => string;
  engagement?: Engagement | null;
  role: Role;
  userId: string;
  busy: boolean;
  onRemediate?: (id: string) => void;
  onRetest?: (id: string) => void;
  findingReview?: ReactNode;
}) {
  const finding = record as Finding;
  const [tab, setTab] = useState(
    finding.status === "ready_for_retest" ? "retest" : "observation",
  );
  const due = findingDue(finding);
  return (
    <div className="finding-record">
      <div className="detail-status">
        <State value={finding.severity} />
        <State value={finding.status} />
        <span className="subtle">Article {finding.article}</span>
      </div>
      <dl className="record-summary-grid">
        <div>
          <dt>Responsible owner</dt>
          <dd>{finding.owner || "Unassigned"}</dd>
        </div>
        <div>
          <dt>Remediation deadline</dt>
          <dd className={due.overdue ? "overdue" : ""}>
            {due.overdue && "Overdue · "}
            {due.label}
          </dd>
        </div>
        <div>
          <dt>Risk assessment</dt>
          <dd>
            {finding.riskScore} / 25
            <small>
              Likelihood {finding.likelihood} × impact {finding.impact}
            </small>
          </dd>
        </div>
        <div>
          <dt>Visibility</dt>
          <dd>
            {finding.visibility === "client"
              ? "Shared with client"
              : "Internal team"}
          </dd>
        </div>
      </dl>
      {engagement && onRemediate && onRetest && (
        <FindingActions
          finding={finding}
          artifacts={engagement.artifacts}
          role={role}
          userId={userId}
          busy={busy}
          onRemediate={onRemediate}
          onRetest={() => setTab("retest")}
        />
      )}
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="record-workspace-tabs"
      >
        <TabsList aria-label="Finding details">
          <TabsTrigger value="observation">Observation</TabsTrigger>
          <TabsTrigger value="remediation">Remediation</TabsTrigger>
          <TabsTrigger value="retest">Support & retest</TabsTrigger>
        </TabsList>
        <TabsContent value="observation">
          {[
            ["condition", "Observed condition"],
            ["criteria", "Assessment criteria"],
            ["effect", "Impact"],
            ["cause", "Root cause"],
          ].map(([key, title]) => (
            <section key={key} className="readable-section">
              <h3>{title}</h3>
              <p className="record-text">
                {String(record[key] || "Not recorded")}
              </p>
            </section>
          ))}
        </TabsContent>
        <TabsContent value="remediation">
          <section className="readable-section">
            <h3>Management response</h3>
            <p className="record-text">
              {finding.response || "No management response recorded."}
            </p>
          </section>
          <section className="readable-section">
            <h3>Remediation performed</h3>
            <p className="record-text">
              {finding.remediation || "No remediation recorded."}
            </p>
            {finding.remediationAt && (
              <p className="record-attribution">
                Recorded by {resolve(finding.remediationBy ?? "")} on{" "}
                {date(finding.remediationAt)}
              </p>
            )}
          </section>
        </TabsContent>
        <TabsContent value="retest">
          {findingReview}
          <section className="readable-section">
            <h3>Remediation evidence</h3>
            <PlainValue
              value={finding.retestEvidenceIds}
              name="retestEvidenceIds"
              resolve={resolve}
            />
          </section>
          {!findingReview && finding.retest && (
            <>
              <section className="readable-section">
                <h3>Independent retest</h3>
                <State value={finding.retest.conclusion} />
                <p className="record-text">{finding.retest.results}</p>
                <p className="record-text">{finding.retest.rationale}</p>
              </section>
            </>
          )}
        </TabsContent>
      </Tabs>
      <details className="provenance">
        <summary>History & attribution</summary>
        <RecordFields
          value={{
            createdBy: record.createdBy,
            remediationBy: record.remediationBy,
            closedBy: record.closedBy,
            id: record.id,
          }}
          resolve={resolve}
        />
      </details>
    </div>
  );
}
export function RecordDetails({
  value,
  engagement,
  onPaper,
  resolve,
  role = "Client Viewer",
  userId = "",
  busy = false,
  onRemediate,
  onRetest,
  findingReview,
}: {
  value: unknown;
  engagement?: Engagement | null;
  onPaper: (paper: Paper) => void;
  resolve: (id: string) => string;
  role?: Role;
  userId?: string;
  busy?: boolean;
  onRemediate?: (id: string) => void;
  onRetest?: (id: string) => void;
  findingReview?: ReactNode;
}) {
  if (!isRecord(value))
    return <PlainValue value={value} name="record" resolve={resolve} />;
  if ("suite" in value && "provenance" in value)
    return (
      <RunDetails
        run={value as Run}
        engagement={engagement}
        onPaper={onPaper}
        resolve={resolve}
      />
    );
  if ("procedures" in value && "objective" in value)
    return <TemplateDetails record={value} resolve={resolve} />;
  if ("snapshot" in value) return <FrozenReportDetails value={value} />;
  if ("condition" in value && "riskScore" in value)
    return (
      <FindingDetails
        key={String(value.id)}
        record={value}
        resolve={resolve}
        engagement={engagement}
        role={role}
        userId={userId}
        busy={busy}
        onRemediate={onRemediate}
        onRetest={onRetest}
        findingReview={findingReview}
      />
    );
  if ("body" in value)
    return (
      <>
        <RecordFields
          value={value}
          resolve={resolve}
          omit={["body", "reviews", "signatures"]}
        />
        <h3>Working paper content</h3>
        {isRecord(value.body) && (
          <RecordFields value={value.body} resolve={resolve} />
        )}
        <RecordFields
          value={{
            reviews: value.reviews ?? [],
            signatures: value.signatures ?? [],
          }}
          resolve={resolve}
        />
      </>
    );
  return <RecordFields value={value} resolve={resolve} />;
}
