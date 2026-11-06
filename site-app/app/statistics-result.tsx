"use client";
// A statistics 1.0.0 result (hosted 1.4, external 1.5): the pre-registered
// bands, the decision with its multiplicity adjustment, and every metric
// with its n and confidence interval (docs/design/audit-statistics.md 11).
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Metric, Result } from "@/lib/domain";
import { REASON_TEXT, explainResult } from "@/lib/hosted-statistics";
import { humanLabel } from "@/lib/presentation";
import { positionLabel } from "./statistics-position";
import { THRESHOLD_LIBRARY, type Band } from "@/lib/statistics";

type Details = {
  role: "headline" | "member" | "descriptive";
  metric: string;
  subject: string | null;
  comparator: string | null;
  band: Band | null;
  status: string;
  direction: string;
  smallCell: boolean;
  fisherExactP: number | null;
  chanceExactP: number | null;
  reasons: string[];
};
type Slice = {
  slice: string;
  n: number;
  suppressed: boolean;
  selectionRate?: number | null;
  selectionConfidenceInterval?: { lower: number; upper: number } | null;
  tpr?: number | null;
  tprConfidenceInterval?: { lower: number; upper: number } | null;
  fpr?: number | null;
  fprConfidenceInterval?: { lower: number; upper: number } | null;
};
const details = (m: Metric) => m.details as Details;
const PAIRS_SHOWN = 12;

/** A metric value in its own unit: shares as percentages, gaps in points, ratios and errors as numbers. */
function show(m: Metric, value: number | null | undefined) {
  if (value === null || value === undefined) return "Not estimable";
  const metric = details(m).metric;
  if (m.unit !== "ratio") return value.toPrecision(4);
  if (metric === "selection_rate_ratio") return value.toFixed(3);
  if (
    [
      "selection_rate_difference",
      "tpr_difference",
      "fpr_difference",
      "equalized_odds",
    ].includes(metric)
  )
    return (value * 100).toFixed(1) + " pp";
  return (value * 100).toFixed(1) + "%";
}
const p = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "–"
    : value < 0.0001
      ? value.toExponential(1)
      : value.toFixed(4);
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : (v * 100).toFixed(1) + "%";
/** A band in the metric's own unit, for example "≤ 10.0 pp" or "≥ 80.0%". */
function bandShown(m: Metric, band: Band | null | undefined) {
  if (!band) return "no band";
  const { lower, upper } = band;
  if (lower !== null && upper !== null)
    return details(m).metric !== "selection_rate_ratio" && lower === -upper
      ? `within ±${show(m, upper)}`
      : `within [${show(m, lower)}, ${show(m, upper)}]`;
  return lower !== null ? `≥ ${show(m, lower)}` : `≤ ${show(m, upper)}`;
}
const METHOD_NAMES: Record<string, string> = {
  wilson: "Wilson score",
  wilson_bonferroni_mean: "Wilson, Bonferroni-adjusted mean",
  newcombe_hybrid_score: "Newcombe hybrid score",
  katz_log: "Katz log",
  koopman_score: "Koopman score",
  mover_wilson: "MOVER (Wilson)",
  jaccard_wilson: "Jaccard–Wilson",
  jaccard_wilson_bonferroni: "Jaccard–Wilson, Bonferroni-adjusted",
  worst_member_bounds: "worst member bounds",
};
const methodName = (method: string) =>
  METHOD_NAMES[method] ?? humanLabel(method);
const range = (ci: { lower: number; upper: number } | null | undefined) =>
  ci ? `${pct(ci.lower)} – ${pct(ci.upper)}` : "";

function metricLabel(m: Metric) {
  const d = details(m);
  if (d.subject !== null)
    return `${humanLabel(d.metric)}: ${d.subject} vs ${d.comparator}`;
  return humanLabel(m.name);
}

function MetricRow({ m }: { m: Metric }) {
  const d = details(m);
  const ci = m.confidenceInterval;
  return (
    <TableRow>
      <TableCell>
        {metricLabel(m)}
        {d.role === "descriptive" && (
          <span className="subtle"> · descriptive</span>
        )}
      </TableCell>
      <TableCell>
        <b>{show(m, m.value)}</b>
      </TableCell>
      <TableCell>
        {ci ? (
          <>
            {show(m, ci.lower)} to {show(m, ci.upper)}
            <span className="subtle">
              {" "}
              · {Math.round(ci.level * 100)}% {methodName(ci.method)}
            </span>
          </>
        ) : (
          "No interval"
        )}
      </TableCell>
      <TableCell>{(m.denominator ?? m.sampleSize).toLocaleString()}</TableCell>
      <TableCell>{d.band ? bandShown(m, d.band) : "–"}</TableCell>
      <TableCell>
        {positionLabel(d)}
        {d.role !== "descriptive" && m.pValue !== null && (
          <span className="subtle"> · p {p(m.pValue)}</span>
        )}
        {d.chanceExactP !== null && (
          <span className="subtle"> · exact chance p {p(d.chanceExactP)}</span>
        )}
        {d.fisherExactP !== null && (
          <span className="subtle"> · Fisher p {p(d.fisherExactP)}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export function StatisticsResult({ result }: { result: Result }) {
  const decision = result.decision!;
  const headline = result.metrics.find((m) => details(m).role === "headline");
  const members = result.metrics.filter((m) => details(m).role === "member");
  const pairwise = members.filter((m) => details(m).subject !== null);
  const shownMembers =
    pairwise.length > PAIRS_SHOWN
      ? members.filter(
          (m) =>
            details(m).subject === null ||
            m.name === decision.decidingMemberId ||
            pairwise.indexOf(m) < PAIRS_SHOWN,
        )
      : members;
  const descriptive = result.metrics.filter(
    (m) => details(m).role === "descriptive",
  );
  const bands = headline
    ? [
        `${humanLabel(details(headline).metric)} ${bandShown(headline, details(headline).band)}`,
      ]
    : members
        .filter((m) => details(m).subject === null)
        .map((m) => `${humanLabel(m.name)} ${bandShown(m, details(m).band)}`);
  const slices = (headline?.slices ?? []) as Slice[];
  const reasons = [...new Set(decision.reasons)].filter((r) => REASON_TEXT[r]);
  return (
    <>
      <p className="criterion">
        <span>{bands.join(" · ") || "No pre-registered band"}</span>
        <span className="subtle">
          {" "}
          · {decision.role} · {Math.round(decision.confidenceLevel * 100)}%
          intervals
        </span>
      </p>
      <p className="statistics-explanation">{explainResult(result)}</p>
      <dl className="statistics-decision">
        <div>
          <dt>Decision p</dt>
          <dd>{p(decision.pValue)}</dd>
        </div>
        <div>
          <dt>Adjusted p</dt>
          <dd>
            {p(decision.adjustedPValue)}
            <span className="subtle">
              {" "}
              · {humanLabel(decision.adjustment ?? "")} over{" "}
              {decision.familySize} {decision.role} criteria
            </span>
          </dd>
        </div>
        <div>
          <dt>Rows evaluated</dt>
          <dd>{decision.sampleSize.toLocaleString()}</dd>
        </div>
        {decision.coverage && (
          <div>
            <dt>Coverage</dt>
            <dd>
              {pct(decision.coverage.value)} of rows (minimum{" "}
              {pct(decision.coverage.minimum)})
            </dd>
          </div>
        )}
        {decision.libraryEntry && (
          <div>
            <dt>Threshold source</dt>
            <dd>
              {decision.libraryEntry.id}@{decision.libraryEntry.version} ·{" "}
              {humanLabel(decision.libraryEntry.legalStatus)}:{" "}
              {decision.libraryEntry.caveat}
              {/* Current status notes, shown beside the frozen caveat and never frozen into the result. */}
              {THRESHOLD_LIBRARY.find(
                (e) => e.id === decision.libraryEntry!.id,
              )?.statusNotes.map((note) => (
                <small className="block subtle" key={note.asOf + note.text}>
                  Status as of {note.asOf}: {note.text}
                </small>
              ))}
            </dd>
          </div>
        )}
      </dl>
      <Table>
        <TableHeader>
          <TableRow>
            {[
              "Metric",
              "Estimate",
              "Interval",
              "n",
              "Band",
              "Point estimate",
            ].map((v) => (
              <TableHead key={v}>{v}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[
            ...(headline ? [headline] : []),
            ...shownMembers,
            ...descriptive,
          ].map((m) => (
            <MetricRow key={m.name} m={m} />
          ))}
        </TableBody>
      </Table>
      {shownMembers.length < members.length && (
        <p className="subtle">
          {members.length - shownMembers.length} further pairwise comparisons
          are in the exported run record.
        </p>
      )}
      {slices.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {["Group", "Rows", "Selection rate", "TPR", "FPR"].map((v) => (
                <TableHead key={v}>{v}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {slices.map((s) => (
              <TableRow key={s.slice}>
                <TableCell>
                  {s.slice}
                  {s.suppressed && (
                    <span className="subtle"> · suppressed, below minimum</span>
                  )}
                </TableCell>
                <TableCell>{s.n.toLocaleString()}</TableCell>
                {(["selection", "tpr", "fpr"] as const).map((key) => {
                  const value = key === "selection" ? s.selectionRate : s[key];
                  const ci = s[`${key}ConfidenceInterval`];
                  return (
                    <TableCell key={key}>
                      {value === undefined ? (
                        "–"
                      ) : (
                        <>
                          {pct(value)}
                          {ci && <span className="subtle"> ({range(ci)})</span>}
                        </>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {reasons.length > 0 && (
        <ul className="record-list">
          {reasons.map((r) => (
            <li key={r}>{REASON_TEXT[r]}</li>
          ))}
        </ul>
      )}
    </>
  );
}
