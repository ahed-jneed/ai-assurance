"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight, FileText, Link2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AssuranceRecord } from "@/lib/assurance-core";
import type { Engagement } from "@/lib/domain/types";
import { recordReviewState, recordTitle } from "./assurance-register";

type Props = {
  record: AssuranceRecord;
  records: AssuranceRecord[];
  engagement: Engagement;
  person: (id: string) => string;
  onRecord: (record: AssuranceRecord) => void;
  onPaper: (id: string) => void;
  onEvidence: (id: string) => void;
  review?: ReactNode;
  initialSection?: Section;
  linksDisabled?: boolean;
};

type Reference = { title: string; detail?: string; open?: () => void };
type Section = "overview" | "sources" | "review";

const sectionLabels: Record<Section, string> = {
  overview: "Overview",
  sources: "Sources",
  review: "Review & history",
};

const sourceFields = new Set([
  "artifactId",
  "artifactIds",
  "pipelineArtifactId",
  "deploymentArtifactId",
  "datasetId",
  "sourceDatasetId",
  "securityReviewId",
  "governanceArtifactId",
  "evidenceId",
  "evidenceIds",
  "paperId",
  "paperIds",
  "procedureId",
  "modelId",
  "modelIds",
  "systemId",
  "predictionId",
  "datasetCardRecordId",
  "sourceIds",
  "affectedIds",
  "previousId",
  "newId",
  "supersedesId",
  "assertionId",
  "impactId",
  "obligationId",
  "assistantId",
  "locationId",
  "relations",
  "citations",
]);

const priorityFields = [
  "assessment",
  "auditorAssessment",
  "reason",
  "limitations",
  "missingEvidence",
  "statement",
  "description",
  "intendedUse",
  "rationale",
  "periodAnalysis",
  "excerpt",
  "quality",
  "lineageAssurance",
  "originAssurance",
];

const labels: Record<string, string> = {
  assessment: "Auditor assessment",
  auditorAssessment: "Auditor assessment",
  reason: "Decision rationale",
  limitations: "Limitations",
  missingEvidence: "Unresolved evidence",
  statement: "Assertion",
  description: "Change description",
  intendedUse: "Intended use",
  rationale: "Basis for the assessment",
  periodAnalysis: "Application period analysis",
  excerpt: "Source observation",
  quality: "Source quality and limitations",
  lineageAssurance: "Lineage assurance",
  originAssurance: "Origin assurance",
  conclusion: "Proposed assessment",
  outcome: "Proposed assessment",
  decision: "Recorded decision",
  artifactId: "Source evidence",
  artifactIds: "Source evidence",
  pipelineArtifactId: "Pipeline evidence",
  deploymentArtifactId: "Deployment evidence",
  datasetId: "Dataset evidence",
  sourceDatasetId: "Source population evidence",
  securityReviewId: "Security review evidence",
  governanceArtifactId: "Processing and privacy evidence",
  evidenceId: "Supporting evidence",
  evidenceIds: "Supporting evidence",
  paperId: "Working paper",
  paperIds: "Working papers",
  procedureId: "Audit procedure",
  modelId: "Model version",
  modelIds: "Model versions",
  systemId: "System revision",
  predictionId: "Prediction lineage",
  datasetCardRecordId: "Dataset card",
  sourceIds: "Selected sources",
  affectedIds: "Affected assurance records",
  previousId: "Previous source or revision",
  newId: "New source or revision",
  supersedesId: "Previous assessment",
  assertionId: "Assertion",
  impactId: "Change assessment",
  obligationId: "Obligation assessment",
  assistantId: "Evidence briefing",
  locationId: "Source location",
  relations: "Source relationships",
  citations: "Citations",
  recordId: "Record",
  citationIds: "Cited records",
  modelPins: "Model integrity pins",
  artifactPins: "Evidence integrity pins",
  retrievedPins: "Retrieved source pins",
  inputHashes: "Input integrity hashes",
  sha256: "SHA-256",
  sourceURL: "Legal source",
  idColumn: "Unique record column",
  producedAt: "Prediction generation time",
  humanDecision: "Human oversight",
  sourceType: "Changed source type",
  stratumColumn: "Stratum column",
  populationCount: "Population size",
  eligibleCount: "Eligible population size",
  selected: "Selected population records",
  sizeMeaning: "Sample size meaning",
};

function fieldLabel(key: string) {
  return (
    labels[key] ??
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replaceAll("_", " ")
      .replace(/^./, (c) => c.toUpperCase())
  );
}

function isTechnical(key: string) {
  return (
    /sha256|hash|pins|provenance|signature/i.test(key) ||
    [
      "key",
      "schemaVersion",
      "parser",
      "algorithm",
      "keyId",
      "sourceVersion",
      "catalogVersion",
    ].includes(key)
  );
}

function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function meaningful(value: unknown) {
  return value !== undefined && value !== "";
}

export function AssuranceRecordDetails({
  record,
  records,
  engagement,
  person,
  onRecord,
  onPaper,
  onEvidence,
  review,
  initialSection = "overview",
  linksDisabled = false,
}: Props) {
  const [section, setSection] = useState<Section>(initialSection);
  const body = record.body;
  const entries = Object.entries(body).filter(([, value]) => meaningful(value));
  const technical = entries.filter(([key]) => isTechnical(key));
  const sources = entries.filter(
    ([key]) => sourceFields.has(key) && !isTechnical(key),
  );
  const overview = entries
    .filter(([key]) => !sourceFields.has(key) && !isTechnical(key))
    .sort(([a], [b]) => {
      const left = priorityFields.indexOf(a),
        right = priorityFields.indexOf(b);
      return (
        (left < 0 ? priorityFields.length : left) -
        (right < 0 ? priorityFields.length : right)
      );
    });
  const assessed = ["assertion", "impact", "obligation"].includes(record.kind);
  const state = assessed
    ? recordReviewState(record, records)
    : record.kind === "assistant"
      ? "Draft proposal"
      : record.kind === "registry"
        ? "Imported proposal"
        : record.kind === "prediction"
          ? "Declared lineage"
          : record.kind === "system"
            ? "System revision"
            : record.kind === "location"
              ? "Source observation"
              : "Diagnostic record";
  const successors = records.filter(
    (item) => item.body.supersedesId === record.id,
  );
  const previous =
    typeof body.supersedesId === "string"
      ? records.find((item) => item.id === body.supersedesId)
      : undefined;

  function resolve(key: string, id: string): Reference | undefined {
    const recordKeys = [
      "systemId",
      "predictionId",
      "datasetCardRecordId",
      "sourceIds",
      "affectedIds",
      "supersedesId",
      "assertionId",
      "impactId",
      "obligationId",
      "assistantId",
      "locationId",
      "recordId",
      "citationIds",
    ];
    const evidenceKeys = [
      "artifactId",
      "artifactIds",
      "pipelineArtifactId",
      "deploymentArtifactId",
      "datasetId",
      "sourceDatasetId",
      "securityReviewId",
      "governanceArtifactId",
      "evidenceId",
      "evidenceIds",
    ];
    if (recordKeys.includes(key) || ["previousId", "newId"].includes(key)) {
      const target = records.find((item) => item.id === id);
      if (target)
        return {
          title: recordTitle(target),
          detail: fieldLabel(target.kind),
          open: target.id === record.id ? undefined : () => onRecord(target),
        };
    }
    if (evidenceKeys.includes(key) || ["previousId", "newId"].includes(key)) {
      const artifact = engagement.artifacts.find((item) => item.id === id);
      if (artifact)
        return {
          title: artifact.name,
          detail: `${artifact.category} · ${artifact.status === "unverified" ? "Awaiting acceptance" : fieldLabel(artifact.status)}`,
          open: () => onEvidence(artifact.id),
        };
    }
    if (["paperId", "paperIds", "previousId", "newId"].includes(key)) {
      const paper = engagement.papers.find((item) => item.id === id);
      if (paper)
        return {
          title: `${paper.templateId} · ${paper.title}`,
          detail: `Revision ${paper.revision} · ${fieldLabel(paper.status)}`,
          open: () => onPaper(paper.id),
        };
    }
    if (["modelId", "modelIds", "previousId", "newId"].includes(key)) {
      const model = engagement.models.find((item) => item.id === id);
      if (model) {
        const artifact = engagement.artifacts.find(
          (item) => item.id === model.artifactId,
        );
        return {
          title: `${model.name} · ${model.version}`,
          detail: `${model.format}${artifact ? " · Open model evidence" : ""}`,
          open: artifact ? () => onEvidence(artifact.id) : undefined,
        };
      }
    }
    if (key === "procedureId") {
      const procedure = engagement.workflow?.procedures.find(
        (item) => item.id === id,
      );
      if (procedure) {
        const paper = engagement.papers.find(
          (item) => item.id === procedure.paperId,
        );
        return {
          title: `${procedure.templateId} · ${procedure.title}`,
          detail: paper
            ? "Audit procedure working paper"
            : "Audit procedure · No working paper available",
          open: paper ? () => onPaper(paper.id) : undefined,
        };
      }
    }
    return undefined;
  }

  function renderReference(key: string, id: string) {
    const target = resolve(key, id);
    if (!target)
      return (
        <span className="workbench-reference-unavailable">
          <span>{id}</span>
          <small>Reference unavailable in this engagement</small>
        </span>
      );
    const content = (
      <>
        <Link2 size={15} aria-hidden="true" />
        <span>
          <b>{target.title}</b>
          {target.detail && <small>{target.detail}</small>}
        </span>
        {target.open && <ArrowUpRight size={14} aria-hidden="true" />}
      </>
    );
    return target.open ? (
      <button
        type="button"
        disabled={linksDisabled}
        className="workbench-reference"
        onClick={target.open}
      >
        {content}
      </button>
    ) : (
      <span className="workbench-reference">{content}</span>
    );
  }

  function renderValue(
    value: unknown,
    key: string,
    depth = 0,
    sourceContext = false,
    hideTechnical = false,
  ): ReactNode {
    if (value === null || value === undefined)
      return <p className="subtle">Not declared</p>;
    if (typeof value !== "object") {
      if (
        sourceContext &&
        typeof value === "string" &&
        (sourceFields.has(key) || ["recordId", "citationIds"].includes(key))
      )
        return renderReference(key, value);
      return (
        <p className="record-text">
          {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
        </p>
      );
    }
    if (depth >= 5)
      return (
        <p className="subtle">
          Further detail is retained in the immutable source record.
        </p>
      );
    if (Array.isArray(value))
      return (
        <div className="workbench-value-list">
          {value.length ? (
            value.slice(0, 100).map((item, index) => (
              <div className="workbench-value-item" key={index}>
                {renderValue(
                  item,
                  key,
                  depth + 1,
                  sourceContext,
                  hideTechnical,
                )}
              </div>
            ))
          ) : (
            <p className="subtle">None recorded</p>
          )}
          {value.length > 100 && (
            <p className="subtle">
              Showing 100 of {value.length} entries. The complete population is
              retained in the immutable source record.
            </p>
          )}
        </div>
      );
    const childEntries = Object.entries(value).filter(
      ([childKey, item]) =>
        meaningful(item) && (!hideTechnical || !isTechnical(childKey)),
    );
    return childEntries.length ? (
      <div className="workbench-value-object">
        {childEntries.map(([childKey, item]) => (
          <div className="workbench-value-field" key={childKey}>
            <h4>{fieldLabel(childKey)}</h4>
            {renderValue(
              item,
              childKey,
              depth + 1,
              sourceContext,
              hideTechnical,
            )}
          </div>
        ))}
      </div>
    ) : (
      <p className="subtle">
        {hideTechnical && Object.keys(value).length
          ? "Integrity details are available under Sources."
          : "None recorded"}
      </p>
    );
  }

  function renderFields(
    values: [string, unknown][],
    sourceContext = false,
    hideTechnical = false,
  ) {
    return values.map(([key, value]) => (
      <section className="readable-section workbench-detail-section" key={key}>
        <h3>{fieldLabel(key)}</h3>
        {renderValue(
          value,
          key,
          0,
          sourceContext && (sourceFields.has(key) || isTechnical(key)),
          hideTechnical,
        )}
      </section>
    ));
  }

  return (
    <div className="workbench-record-details">
      <div className="workbench-record-summary">
        <span
          className={`badge ${state === "Confirmed" ? "green" : state === "Returned" ? "amber" : "neutral"}`}
        >
          {state}
        </span>
        <dl className="workbench-record-meta">
          <div>
            <dt>Recorded by</dt>
            <dd>{person(record.actor)}</dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>{readableDate(record.createdAt)}</dd>
          </div>
        </dl>
      </div>
      <label className="workbench-detail-picker">
        Record section
        <select
          value={section}
          onChange={(event) => setSection(event.target.value as Section)}
        >
          {Object.entries(sectionLabels).map(([value, title]) => (
            <option value={value} key={value}>
              {title}
            </option>
          ))}
        </select>
      </label>
      <Tabs
        value={section}
        onValueChange={(value) => setSection(value as Section)}
        className="workbench-detail-tabs"
      >
        <TabsList aria-label="Assurance record sections">
          {Object.entries(sectionLabels).map(([value, title]) => (
            <TabsTrigger key={value} value={value}>
              {title}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent
          value="overview"
          className="record-body workbench-detail-body"
        >
          {overview.length ? (
            renderFields(overview, false, true)
          ) : (
            <p className="subtle">
              This record contains source references and integrity details. Open
              Sources to inspect them.
            </p>
          )}
        </TabsContent>
        <TabsContent
          value="sources"
          className="record-body workbench-detail-body"
        >
          {sources.length ? (
            renderFields(sources, true, true)
          ) : (
            <div className="workbench-detail-empty">
              <FileText size={20} aria-hidden="true" />
              <p>
                No source references were recorded in this assurance record.
              </p>
            </div>
          )}
          <details className="provenance workbench-source-integrity">
            <summary>Source integrity</summary>
            <dl className="workbench-integrity-meta">
              <div>
                <dt>Record identity</dt>
                <dd>
                  <code>{record.id}</code>
                </dd>
              </div>
              <div>
                <dt>Record SHA-256</dt>
                <dd>
                  <code>{record.sha256}</code>
                </dd>
              </div>
              <div>
                <dt>Record type</dt>
                <dd>{fieldLabel(record.kind)}</dd>
              </div>
            </dl>
            {technical.length > 0 && renderFields(technical, true)}
            <details className="workbench-stored-record">
              <summary>Full stored record fields</summary>
              {renderFields(entries, true)}
            </details>
          </details>
        </TabsContent>
        <TabsContent
          value="review"
          forceMount
          className="workbench-detail-body"
        >
          {review ?? (
            <p className="subtle">
              No independent review actions apply to this record.
            </p>
          )}
          <section className="workbench-revision-history">
            <h3>Revision history</h3>
            {previous && (
              <div className="workbench-revision-item">
                <small>Previous assessment</small>
                {renderReference("supersedesId", previous.id)}
              </div>
            )}
            <div className="workbench-revision-item">
              <small>Selected record</small>
              <b>{recordTitle(record)}</b>
              <p className="subtle">
                {person(record.actor)} · {readableDate(record.createdAt)}
              </p>
            </div>
            {successors.map((item) => (
              <div className="workbench-revision-item" key={item.id}>
                <small>Successor assessment</small>
                {renderReference("sourceIds", item.id)}
              </div>
            ))}
            {!previous && !successors.length && (
              <p className="subtle">
                No predecessor or successor revision is available in this
                engagement.
              </p>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
