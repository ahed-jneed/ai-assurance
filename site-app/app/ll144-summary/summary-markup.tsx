import type { Ll144Summary } from "@/lib/ll144-audit";
import type { Ll144SummaryView } from "@/lib/read-models/ll144-summary";

const fmt = (v: number | null | undefined, digits = 4) =>
  v === null || v === undefined ? "–" : v.toFixed(digits);
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : (v * 100).toFixed(2) + "%";
const interval = (i: { lower: number; upper: number } | null | undefined) =>
  i ? `[${fmt(i.lower)}, ${fmt(i.upper)}]` : "–";
/** An intersectional label is a JSON array of its parts; show them joined. */
const label = (c: { category: string; components: string[] }) =>
  c.components.join(" / ") || c.category;

function Table({
  table,
  rate,
}: {
  table: Ll144Summary["tables"][number];
  rate: Ll144Summary["rate"];
}) {
  const count = rate === "selection" ? "selected" : "scoredAboveMedian";
  return (
    <section aria-labelledby={"ll144-" + table.dimension}>
      <h2 id={"ll144-" + table.dimension}>{table.title}</h2>
      <table className="ll144-table">
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Number of applicants</th>
            <th scope="col">
              {rate === "selection" ? "Selected" : "Scored above the median"}
            </th>
            <th scope="col">
              {rate === "selection" ? "Selection rate" : "Scoring rate"}
            </th>
            <th scope="col">Impact ratio</th>
            <th scope="col">Rate interval (supplementary)</th>
            <th scope="col">Impact-ratio interval (supplementary)</th>
          </tr>
        </thead>
        <tbody>
          {table.categories.map((c) => (
            <tr key={c.category}>
              <th scope="row">
                {label(c)}
                {c.category === table.referenceCategory &&
                !table.notes.includes("reference_rate_zero")
                  ? " (reference)"
                  : ""}
                {c.excluded ? " (excluded, under 2%)" : ""}
              </th>
              <td>{c.n}</td>
              <td>{String(c[count] ?? 0)}</td>
              <td>{pct(c.rate)}</td>
              <td>{c.excluded ? "excluded" : fmt(c.impactRatio)}</td>
              <td>{interval(c.supplementary.rateInterval)}</td>
              <td>{interval(c.supplementary.impactRatioInterval)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Individuals in an unknown category, not included in these calculations:{" "}
        <strong>{table.unknownCategoryCount}</strong>
      </p>
      {table.notes.includes("reference_rate_zero") && (
        <p>No category has a rate above zero, so no impact ratio is defined.</p>
      )}
      {table.notes.includes("no_known_category") && (
        <p>No individual has a known category in this dimension.</p>
      )}
    </section>
  );
}

/** The standalone publishable summary (6 RCNY 5-303), for screen and print. */
export function summaryMarkup(view: Ll144SummaryView, jsonHref: string) {
  const s = view.summary;
  return (
    <main className="print-report ll144-summary">
      <header>
        <p className="ll144-kicker">Summary of the results of a bias audit</p>
        <h1>{s.tool.name}</h1>
        <p>{s.law}</p>
        {s.status !== "approved" && (
          <p className="ll144-draft" role="status">
            Draft: this audit is not approved and must not be published.
          </p>
        )}
        {s.legalReview === "pending" && (
          <p className="ll144-pending">
            The methodology&apos;s reading of the rules is pending qualified
            legal review.
          </p>
        )}
        <p>
          {view.source === "report"
            ? `As captured in report ${view.reportId}.`
            : "Live view of the engagement's audit."}{" "}
          <a href={jsonHref}>Download this summary as JSON</a>
        </p>
      </header>
      <section aria-labelledby="ll144-required">
        <h2 id="ll144-required">Required elements</h2>
        <dl className="ll144-elements">
          {s.requiredElements.map((r) => (
            <div key={r.element}>
              <dt>
                {r.element} <span className="ll144-rule">({r.rule})</span>
              </dt>
              <dd>
                {r.value === "tables"
                  ? "See the tables below."
                  : r.value === "exclusions"
                    ? "See the excluded categories below."
                    : r.value}
              </dd>
            </div>
          ))}
        </dl>
        <p>
          The tool may not be used after <strong>{s.useAllowedUntil}</strong>{" "}
          without a new bias audit.
        </p>
      </section>
      <section aria-labelledby="ll144-data">
        <h2 id="ll144-data">Data</h2>
        <p>
          <strong>
            {s.dataSource.kind === "historical"
              ? "Historical data."
              : "Test data."}
          </strong>{" "}
          {s.dataSource.source}
        </p>
        <p>{s.dataSource.explanation}</p>
        {s.dataSource.kind === "test" && (
          <>
            <p>
              <strong>Why historical data was not used:</strong>{" "}
              {s.dataSource.whyHistoricalDataWasNotUsed}
            </p>
            <p>
              <strong>How the test data was generated and obtained:</strong>{" "}
              {s.dataSource.howTestDataWasGeneratedAndObtained}
            </p>
          </>
        )}
        <p>
          <strong>Demographic data:</strong> {s.demographicData}
        </p>
        {s.rate === "scoring" && (
          <p>
            Median score of the full sample: <strong>{s.medianScore}</strong>
          </p>
        )}
      </section>
      {s.tables.map((t) => (
        <Table key={t.dimension} table={t} rate={s.rate} />
      ))}
      {s.exclusions.length > 0 && (
        <section aria-labelledby="ll144-excluded">
          <h2 id="ll144-excluded">Excluded categories</h2>
          <ul>
            {s.exclusions.map((x) => (
              <li key={x.dimension + x.category}>
                {x.category}: {x.n} applicants, rate {pct(x.rate)}.
                Justification: {x.justification}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="ll144-notes">
        <h2 id="ll144-notes">Notes</h2>
        <ul>
          {s.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
