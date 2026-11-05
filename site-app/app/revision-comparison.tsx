"use client";
import { useState } from "react";
import { compareFields } from "@/lib/revision-comparison";
import type { Paper } from "@/lib/domain";
import type { Procedure } from "@/lib/workflow-types";
function Comparison({
  history,
  current,
  userId,
}: {
  history: {
    label: string;
    reviewers: string[];
    value: Record<string, unknown>;
  }[];
  current: Record<string, unknown>;
  userId: string;
}) {
  const reviewed = history
      .map((h, i) => (h.reviewers.includes(userId) ? i : -1))
      .filter((i) => i >= 0)
      .at(-1),
    [index, setIndex] = useState(reviewed ?? Math.max(0, history.length - 1));
  const baseline = history[Math.min(index, history.length - 1)],
    diff = baseline ? compareFields(baseline.value, current) : [];
  if (!baseline)
    return <p className="subtle">No earlier saved version to compare.</p>;
  return (
    <section className="revision-comparison">
      <div className="comparison-controls">
        <label>
          Compare with
          <select
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {history.map((h, i) => (
              <option key={i} value={i}>
                {h.label}
                {h.reviewers.includes(userId) ? " · reviewed by you" : ""}
              </option>
            ))}
          </select>
        </label>
        <span>
          {diff.length} changed field{diff.length === 1 ? "" : "s"}
        </span>
      </div>
      {diff.length ? (
        diff.map((d, i) => (
          <article key={i}>
            <h3>{d.label}</h3>
            <div className="comparison-columns">
              <div>
                <small>Earlier saved version</small>
                <p>{d.before}</p>
              </div>
              <div>
                <small>Current saved version</small>
                <p>{d.after}</p>
              </div>
            </div>
          </article>
        ))
      ) : (
        <p className="subtle">
          No content or linked-source changes against this version.
        </p>
      )}
    </section>
  );
}
export function PaperComparison({
  paper,
  userId,
  resolve,
}: {
  paper: Paper;
  userId: string;
  resolve: (id: string) => string;
}) {
  const value = (body: Record<string, string>, e: string[], r: string[]) => ({
    ...body,
    evidence: e.map(resolve),
    evaluations: r.map(resolve),
  });
  return (
    <Comparison
      key={paper.id + ":" + paper.revision}
      userId={userId}
      current={value(paper.body, paper.evidenceIds, paper.runIds)}
      history={paper.history.map((h) => ({
        label:
          "Revision " + h.revision + " · " + new Date(h.at).toLocaleString(),
        reviewers: h.reviews.map((r) => r.userId),
        value: value(h.body, h.evidenceIds, h.runIds),
      }))}
    />
  );
}
export function ProcedureComparison({
  procedure: p,
  userId,
  resolve,
}: {
  procedure: Procedure;
  userId: string;
  resolve: (id: string) => string;
}) {
  const value = (
    plan: Record<string, unknown>,
    execution: Procedure["execution"],
  ) => ({
    ...plan,
    performed: execution?.performed,
    steps: execution?.steps,
    samplingActual: execution?.sampling,
    results: execution?.results,
    limitations: execution?.limitations,
    evidence: execution?.evidenceIds.map(resolve),
    evaluations: execution?.runIds.map(resolve),
    assessment: execution?.assessment
      ? Object.fromEntries(
          Object.entries(execution.assessment).filter(
            ([k]) => !["actor", "at"].includes(k),
          ),
        )
      : undefined,
  });
  const {
    selected,
    applicability,
    rationale,
    criterion,
    sourceVersion,
    periodAnalysis,
    population,
    sampling,
    ownerId,
    reviewerId,
    dueDate,
    method,
    modelId,
    datasetId,
    profileId,
  } = p;
  return (
    <Comparison
      key={p.id + ":" + p.revision + ":" + p.execution?.revision}
      userId={userId}
      current={value(
        {
          selected,
          applicability,
          rationale,
          criterion,
          sourceVersion,
          periodAnalysis,
          population,
          sampling,
          owner: resolve(ownerId),
          reviewer: resolve(reviewerId),
          dueDate,
          method,
          model: resolve(modelId),
          dataset: resolve(datasetId),
          protocol: resolve(profileId),
        },
        p.execution,
      )}
      history={p.history.map((h) => {
        const { ownerId, reviewerId, modelId, datasetId, profileId, ...plan } =
          h.plan;
        return {
          label:
            "Plan " +
            h.revision +
            " / execution " +
            (h.execution?.revision ?? 0) +
            " · " +
            new Date(h.at).toLocaleString(),
          reviewers: h.review ? [h.review.userId] : [],
          value: value(
            {
              ...plan,
              owner: resolve(ownerId),
              reviewer: resolve(reviewerId),
              model: resolve(modelId),
              dataset: resolve(datasetId),
              protocol: resolve(profileId),
            },
            h.execution,
          ),
        };
      })}
    />
  );
}
