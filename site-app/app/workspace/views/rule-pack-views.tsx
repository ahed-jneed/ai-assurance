"use client";
// The rule pack as the regulatory-mapping view shows it: the pack and
// engagement stamp with the staleness banner, the "Obligations by date" view,
// the standards register, and the legal-review items, unverified claims,
// guidance and sources. Everything renders from the catalog the workspace API
// sends; entries flagged for legal review always read "pending legal review".
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Engagement } from "@/lib/domain";
import {
  engagementPeriod,
  engagementRulePack,
  legalDate,
  obligationsByDate,
  researchAge,
  type ApplicationDate,
  type ObligationRow,
  type PeriodStatus,
  type RegulatorySnapshot,
  type Selection,
  type Source,
  type Standard,
} from "@/lib/rule-pack";

const dateTypeLabels: Record<ApplicationDate["dateType"], string> = {
  applies_from: "Applies from",
  compliance_deadline: "Compliance deadline",
  entry_into_force: "Entry into force",
};
const periodLabels: Record<PeriodStatus, [string, string]> = {
  readiness: ["Readiness", "blue"],
  applicable: ["Applicable", "green"],
  starts_in_period: ["Starts within period", "amber"],
  period_not_set: ["Set the period", "neutral"],
};
const selectionLabels: Record<Selection, [string, string]> = {
  candidate: ["Candidate for this system", "blue"],
  not_selected: ["Not selected by recorded facts", "neutral"],
  needs_information: ["Needs information", "amber"],
};
const actorLabel = (actor: string) =>
  actor.replaceAll("_", " ").replace(/^gpai /, "GPAI ");
/** The legal basis as one cited sentence; a leading ISO date reads as a legal date. */
function legalBasisText({
  reference,
  amendedBy,
  previousValue,
}: ApplicationDate["legalBasis"]) {
  return (
    [
      reference,
      amendedBy,
      previousValue &&
        "Previously " +
          previousValue.replace(/^\d{4}-\d{2}-\d{2}/, (d) => legalDate(d)),
    ]
      .filter(Boolean)
      .map((part) => part!.replace(/\.$/, ""))
      .join(". ") + "."
  );
}

/** "Pending legal review" for flagged content; never shown as approved. */
export function LegalReviewLabel({ itemIds }: { itemIds: string[] }) {
  return itemIds.length ? (
    <span className="badge amber" title="Pending qualified legal review">
      Pending legal review · {itemIds.join(", ")}
    </span>
  ) : null;
}

function SourceLinks({
  ids,
  sources,
}: {
  ids: string[];
  sources: Map<string, Source>;
}) {
  return (
    <span className="rule-pack-sources">
      {ids.map((id) => {
        const s = sources.get(id);
        const href = s?.canonicalUrl ?? s?.accessUrl;
        return href ? (
          <a
            key={id}
            className="source-link"
            href={href}
            target="_blank"
            rel="noreferrer"
            title={s!.title + " · retrieved " + legalDate(s!.retrievedOn)}
          >
            {s!.kind === "secondary" ? "Secondary: " : ""}
            {s!.title}
          </a>
        ) : (
          <span key={id}>{id}</span>
        );
      })}
    </span>
  );
}

/**
 * The rule pack the workspace applies, how the engagement relates to it, the
 * pending legal review, and the staleness banner once the research is older
 * than the pack's configured age.
 */
export function RulePackStatus({
  pack,
  engagement: e,
  today,
}: {
  pack: RegulatorySnapshot;
  engagement: Engagement;
  today: string;
}) {
  const age = researchAge(pack, today),
    relation = engagementRulePack(e, { version: pack.rulePackVersion });
  return (
    <section className="rule-pack-status" aria-label="Rule pack">
      <div className="context-strip">
        <span>
          Rule pack <b>{pack.rulePackVersion}</b>
        </span>
        <span>
          Legal text <b>{pack.celex}</b> (consolidated{" "}
          {legalDate(pack.consolidatedAsOf)})
        </span>
        <span>Researched {legalDate(pack.researchedAsOf)}</span>
        {pack.approval.status !== "approved" && (
          <span className="badge amber">Pending legal review</span>
        )}
      </div>
      {age.stale && (
        <div className="warning-card" role="status">
          The legal research behind rule pack {pack.rulePackVersion} is{" "}
          {age.days} days old (researched {legalDate(pack.researchedAsOf)}; this
          workspace flags research older than {age.maxAgeDays} days). Check the
          Official Journal for later amendments, corrigenda and guidance before
          relying on these dates.
        </div>
      )}
      {relation.kind === "legacy" && (
        <div className="warning-card">
          This engagement was created before rule-pack stamps. Its
          classification keeps the legal version it was recorded against (
          {relation.recordedLegalVersion}, researched{" "}
          {legalDate(relation.recordedResearchedAsOf)}). The dates here are from
          rule pack {pack.rulePackVersion}; review the classification and the
          program against them.
        </div>
      )}
      {relation.kind === "other" && (
        <div className="warning-card">
          This engagement is stamped with rule pack {relation.stamp.version}{" "}
          (researched {legalDate(relation.stamp.researchedAsOf)}), but this
          workspace applies rule pack {pack.rulePackVersion}. Review the
          differences before relying on these dates.
        </div>
      )}
      {relation.kind === "current" && (
        <p className="subtle">
          This engagement was stamped with rule pack {relation.stamp.version}{" "}
          when it was created.
        </p>
      )}
      {pack.approval.status !== "approved" && (
        <p className="note">
          No qualified legal review has taken place yet. Every entry is pending
          legal review, and entries with legal-review items are interpretations
          that must not be presented as settled law.
        </p>
      )}
    </section>
  );
}

function Obligation({
  row,
  sources,
}: {
  row: ObligationRow;
  sources: Map<string, Source>;
}) {
  const e = row.entry;
  return (
    <details className="obligation-detail">
      <summary>
        <b>{e.title}</b>
        <span className="reference-cell">{e.provisions.join("; ")}</span>
      </summary>
      <p>{e.summary}</p>
      <dl className="document-properties">
        <div>
          <dt>Scope</dt>
          <dd>{e.scope}</dd>
        </div>
        <div>
          <dt>Actors</dt>
          <dd>{e.actors.map(actorLabel).join(", ")}</dd>
        </div>
        <div>
          <dt>Legal basis</dt>
          <dd>{legalBasisText(e.legalBasis)}</dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>
            From {legalDate(e.effectiveFrom)}
            {e.effectiveTo ? " to " + legalDate(e.effectiveTo) : ""}
          </dd>
        </div>
        <div>
          <dt>Verification</dt>
          <dd>
            {e.verification.status === "verified"
              ? "Verified"
              : "Secondary sources only"}{" "}
            on {legalDate(e.verification.verifiedOn)}
          </dd>
        </div>
        <div>
          <dt>Approval</dt>
          <dd>
            {e.approval.status === "approved"
              ? "Approved by " +
                e.approval.reviewer +
                ", " +
                e.approval.approvedAt
              : "Pending legal review (no reviewer or approval time yet)"}
          </dd>
        </div>
      </dl>
      {e.conditions && (
        <ul className="rule-pack-list">
          {e.conditions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {row.practices.length > 0 && (
        <>
          <h4>Art 5(1) practices dated here</h4>
          <ul className="rule-pack-list">
            {row.practices.map((p) => (
              <li key={p.point}>
                <b>{p.point}</b> {p.label}
                {p.conditions
                  ? " (conditions: " + p.conditions.join(", ") + ")"
                  : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {(row.rules.length > 0 || row.links.length > 0) && (
        <>
          <h4>Transitional rules</h4>
          <ul className="rule-pack-list">
            {row.rules.map((t) => (
              <li key={t.reference + t.rule}>
                <b>{t.reference}</b> {t.rule}
                {t.selection && (
                  <>
                    {" "}
                    <SelectionLabel
                      selection={t.selection}
                      missing={t.missingFacts}
                    />
                  </>
                )}
              </li>
            ))}
            {row.links.map((l) => (
              <li key={l.entryId}>
                <b>{l.reference}</b>{" "}
                <a className="source-link" href={"#" + l.entryId}>
                  {l.authority ? "Authority deadline" : "See"}{" "}
                  {l.date ? legalDate(l.date) : ""}: {l.title}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {e.notes && <p className="subtle">{e.notes}</p>}
      <p className="subtle">
        Sources: <SourceLinks ids={e.sourceIds} sources={sources} />
      </p>
      <p className="subtle">
        Change history:{" "}
        {e.history.map((h) => h.rulePackVersion + " " + h.change).join(" · ")}
      </p>
    </details>
  );
}

function SelectionLabel({
  selection,
  missing,
}: {
  selection: Selection;
  missing: string[];
}) {
  const [label, tone] = selectionLabels[selection];
  return (
    <span
      className={"badge " + tone}
      title={missing.length ? "Unknown facts: " + missing.join(", ") : label}
    >
      {label}
      {missing.length ? ": " + missing.join(", ") : ""}
    </span>
  );
}

/**
 * "Obligations by date": each operator duty's application date, and whether
 * the engagement period falls before it (readiness), after it (applicable)
 * or across it. Authority deadlines follow separately.
 */
export function ObligationsByDate({
  pack,
  engagement: e,
}: {
  pack: RegulatorySnapshot;
  engagement: Engagement;
}) {
  const groups = obligationsByDate(pack, e),
    period = engagementPeriod(e),
    sources = new Map(pack.sources.map((s) => [s.id, s]));
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Obligations by date</h2>
          <span className="subtle">
            {period
              ? "Engagement period " +
                legalDate(period.start) +
                " to " +
                legalDate(period.end)
              : "Engagement period not set in the brief"}
          </span>
        </div>
        <p className="subtle rule-pack-intro">
          Each date shows where the engagement period falls against it: wholly
          before (readiness), on or after (applicable), or across it. Selection
          reads only the recorded facts; unknown facts need information, and
          applicability stays a reviewed decision.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Obligation</TableHead>
              <TableHead>Engagement period</TableHead>
              <TableHead>This system</TableHead>
              <TableHead>Review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.flatMap(({ date, rows }) =>
              rows.map((row, index) => {
                const [period, tone] = periodLabels[row.period];
                return (
                  <TableRow key={row.entry.id} id={row.entry.id}>
                    <TableCell className="obligation-date">
                      {index === 0 && <b>{legalDate(date)}</b>}
                      <small>{dateTypeLabels[row.entry.dateType]}</small>
                    </TableCell>
                    <TableCell className="obligation-cell">
                      <Obligation row={row} sources={sources} />
                    </TableCell>
                    <TableCell>
                      <span className={"badge " + tone}>{period}</span>
                    </TableCell>
                    <TableCell>
                      {row.selection ? (
                        <SelectionLabel
                          selection={row.selection}
                          missing={row.missingFacts}
                        />
                      ) : (
                        <span className="subtle">No fact conditions</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.pendingReview.length ? (
                        <LegalReviewLabel itemIds={row.pendingReview} />
                      ) : (
                        <span className="subtle">
                          Verified{" "}
                          {legalDate(row.entry.verification.verifiedOn)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Authority deadlines</h2>
          <span className="subtle">Not operator duties</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Provision</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Deadline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...pack.authorityDeadlines]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((d) => (
                <TableRow key={d.id} id={d.id}>
                  <TableCell className="obligation-date">
                    <b>{legalDate(d.date)}</b>
                  </TableCell>
                  <TableCell>{d.provision}</TableCell>
                  <TableCell>{actorLabel(d.actor)}</TableCell>
                  <TableCell>
                    {d.summary}
                    <br />
                    <SourceLinks ids={d.sourceIds} sources={sources} />
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}

function Presumption({ standard: s }: { standard: Standard }) {
  const p = s.presumptionOfConformity;
  if (p.status === "none")
    return (
      <>
        <b>No presumption of conformity</b>
        {p.note && !/^none\.?$/i.test(p.note.trim()) && (
          <p className="subtle">{p.note}</p>
        )}
      </>
    );
  return (
    <>
      <p>
        Limited to the clauses the standard covers, from{" "}
        {p.from ? legalDate(p.from) : "OJ publication"}.
      </p>
      {p.clauseScope && (
        <p>
          Covers {p.clauseScope.covers.join("; ")} ({p.clauseScope.clause}); not{" "}
          {p.clauseScope.excludes.join(", ")}.{" "}
          {p.clauseScope.status === "secondary_only" && (
            <span className="badge amber" title={p.clauseScope.verificationGap}>
              Unverified: secondary sources only
            </span>
          )}
        </p>
      )}
      {p.applicationNote && <p className="subtle">{p.applicationNote}</p>}
    </>
  );
}

const standardGroups: [Standard["category"], string][] = [
  ["harmonised_standard_cited", "Harmonised standards cited in the OJ"],
  [
    "international_standard_not_cited",
    "ISO/IEC standards (not cited in the OJ)",
  ],
  ["draft_not_harmonised", "CEN-CENELEC JTC 21 drafts"],
];

/** Standards by citation status; references and clause numbers only (D-03). */
export function StandardsRegister({ pack }: { pack: RegulatorySnapshot }) {
  const sources = new Map(pack.sources.map((s) => [s.id, s]));
  return (
    <>
      <p className="note">{pack.standardsCitationRule}</p>
      {standardGroups.map(([category, heading]) => (
        <section className="panel" key={category}>
          <div className="panel-head">
            <h2>{heading}</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Presumption of conformity</TableHead>
                <TableHead>Use in audits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pack.standards
                .filter((s) => s.category === category)
                .map((s) => (
                  <TableRow key={s.id} id={s.id}>
                    <TableCell>
                      <b>{s.reference}</b>
                      <br />
                      <span className="reference-cell">{s.title}</span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          "badge " +
                          (category === "harmonised_standard_cited"
                            ? "green"
                            : category === "draft_not_harmonised"
                              ? "amber"
                              : "neutral")
                        }
                      >
                        {s.label}
                      </span>
                      {s.ojCitation && (
                        <p className="subtle">
                          <a
                            className="source-link"
                            href={s.ojCitation.eli}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Implementing Decision {s.ojCitation.decisionNumber}
                          </a>
                          , {s.ojCitation.ojReference}
                        </p>
                      )}
                      {s.cen && (
                        <p className="subtle">
                          CEN: {s.cen.status} since{" "}
                          {legalDate(s.cen.currentStageDate)}; forecast vote{" "}
                          {legalDate(s.cen.forecastVotingDate)}
                          {s.cen.note ? ". " + s.cen.note : ""}
                        </p>
                      )}
                      {s.europeanAdoption && (
                        <p className="subtle">
                          {s.europeanAdoption.reference
                            ? "European adoption: " +
                              s.europeanAdoption.reference
                            : "No European adoption"}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Presumption standard={s} />
                      <LegalReviewLabel itemIds={s.legalReview.itemIds} />
                    </TableCell>
                    <TableCell>
                      <p>{s.useInAudits}</p>
                      {s.aiActArticleIndicative && (
                        <p className="subtle">
                          AI Act (indicative): {s.aiActArticleIndicative}
                        </p>
                      )}
                      {s.reportedOutcome && (
                        <p className="subtle">
                          <span className="badge amber">
                            Unverified: secondary sources only
                          </span>{" "}
                          {s.reportedOutcome.text}
                        </p>
                      )}
                      <p className="subtle">
                        <SourceLinks ids={s.sourceIds} sources={sources} />
                      </p>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </>
  );
}

/** Legal-review items, unverified claims, guidance and the source register. */
export function RulePackSources({ pack }: { pack: RegulatorySnapshot }) {
  const titles = new Map<string, string>([
    ...pack.applicationDates.map((e) => [e.id, e.title] as [string, string]),
    ...pack.standards.map((s) => [s.id, s.reference] as [string, string]),
    ...pack.authorityDeadlines.map(
      (d) => [d.id, d.provision] as [string, string],
    ),
  ]);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Items for qualified legal review</h2>
          <a
            className="source-link"
            href={pack.approval.tracking}
            target="_blank"
            rel="noreferrer"
          >
            Review tracking
          </a>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Question</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pack.legalReviewItems.map((i) => (
              <TableRow key={i.id} id={i.id}>
                <TableCell>
                  <b>{i.id}</b>
                  <br />
                  {i.topic}
                </TableCell>
                <TableCell>
                  <details>
                    <summary className="subtle">
                      Affects{" "}
                      {i.relatedIds
                        .map((id) => titles.get(id) ?? id)
                        .join("; ")}
                    </summary>
                    <p>{i.question}</p>
                  </details>
                </TableCell>
                <TableCell>
                  {i.status === "resolved" ? (
                    <span className="badge green">Resolved</span>
                  ) : (
                    <span className="badge amber">Pending legal review</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Not verified</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim</TableHead>
              <TableHead>Why it is unverified</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pack.unverified.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <span className="badge amber">Unverified</span> <b>{u.id}</b>{" "}
                  {u.claim}
                </TableCell>
                <TableCell>{u.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Guidance</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Use</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pack.guidanceDocuments.map((g) => (
              <TableRow key={g.id}>
                <TableCell>
                  {g.url ? (
                    <a
                      className="source-link"
                      href={g.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {g.title}
                    </a>
                  ) : (
                    g.title
                  )}
                </TableCell>
                <TableCell>{g.status}</TableCell>
                <TableCell>{g.platformUse ?? g.note}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Sources</h2>
          <span className="subtle">
            The authentic Official Journal texts govern
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Publisher</TableHead>
              <TableHead>Retrieved</TableHead>
              <TableHead>SHA-256</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pack.sources.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <a
                    className="source-link"
                    href={s.canonicalUrl ?? s.accessUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.title}
                  </a>
                  {s.kind === "secondary" && (
                    <>
                      {" "}
                      <span className="badge amber">Secondary</span>
                    </>
                  )}
                </TableCell>
                <TableCell>{s.publisher}</TableCell>
                <TableCell>{legalDate(s.retrievedOn)}</TableCell>
                <TableCell className="mono">
                  {s.sha256 ? s.sha256.slice(0, 16) + "…" : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}
