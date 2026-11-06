"use client";
import { Button } from "@/components/ui/button";
import { classificationRules } from "@/lib/classification-rules";
import type { Engagement } from "@/lib/domain";
import {
  aiOfficeCompetence,
  approvalBlockers,
  art50Assessment,
  awaitsReclassification,
  capturedBeforeMigration,
  classificationFacts,
  classify,
  factDefinitions,
  factLabel,
  highRiskRouteOf,
  reReviewTriggers,
  type Art50Status,
  type ClassificationRules,
  type FactDefinition,
} from "@/lib/domain/classification";
import type { Truth } from "@/lib/predicates";
import { legalDate, type RegulatorySnapshot } from "@/lib/rule-pack";
import { Badge } from "../workspace-ui";
import { LegalReviewLabel } from "./rule-pack-views";

const art50Labels: Record<Art50Status, [string, string]> = {
  candidate: ["Candidate: applies pending approval", "blue"],
  excluded: ["Excluded by a recorded exclusion", "neutral"],
  not_triggered: ["Not triggered by recorded facts", "neutral"],
  needs_information: ["Needs information", "amber"],
  role_not_held: ["Role not held", "neutral"],
};
const routeLabels: Record<string, string> = {
  annex_iii: "high risk (Annex III)",
  annex_i_section_a: "high risk (Annex I Section A)",
  annex_i_section_b: "high risk (Annex I Section B)",
  not_high_risk: "not high risk",
  unknown: "needs information",
};
const competenceText = (t: Truth | "not_applicable") =>
  t === "not_applicable"
    ? "Not applicable to this role"
    : t === "unknown"
      ? "Needs information"
      : t
        ? "AI Office"
        : "National market surveillance authority";

/** The recorded answer in words, with its stamp as a tooltip. */
function AnswerText({
  e,
  def,
}: {
  e: Engagement;
  def: Pick<FactDefinition, "id" | "kind" | "values">;
}) {
  const a = e.classification.answers?.[def.id];
  if (!a) return <span className="badge amber">Needs information</span>;
  const text =
    typeof a.value === "boolean"
      ? a.value
        ? "Yes"
        : "No"
      : def.kind === "date"
        ? legalDate(a.value)
        : (def.values?.find((v) => v.value === a.value)?.label ?? a.value);
  return (
    <span
      title={
        "Answered " +
        a.answeredAt.slice(0, 10) +
        " under " +
        a.legalVersion +
        ", rule pack " +
        a.rulePackVersion
      }
    >
      {text}
      {a.evidence && (
        <small className="subtle"> · evidence: {a.evidence}</small>
      )}
      {a.checkedOn && (
        <small className="subtle"> · checked {legalDate(a.checkedOn)}</small>
      )}
    </span>
  );
}

function FactRows({ e, defs }: { e: Engagement; defs: FactDefinition[] }) {
  return (
    <dl className="classification-facts">
      {defs.map((d) => (
        <div key={d.id}>
          <dt>
            {d.label}
            {d.appliesFrom && (
              <small className="subtle">
                {" "}
                Applies from {legalDate(d.appliesFrom)}
              </small>
            )}{" "}
            {d.legalReview?.length ? (
              <LegalReviewLabel itemIds={[...d.legalReview]} />
            ) : null}
          </dt>
          <dd>
            <AnswerText e={e} def={d} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The classification in the regulatory-mapping view (#19): the label and
 * what still needs information, the Art 5 screen, the Art 50 items, GPAI
 * roles and AI Office competence, SME status, the derogation record, the
 * guidance cited with its re-review triggers and the classification history.
 */
export function ClassificationPanel({
  engagement: e,
  pack,
  today,
  reviewer,
  busy,
  onApprove,
}: {
  engagement: Engagement;
  pack: RegulatorySnapshot | null;
  today: string;
  reviewer: boolean;
  busy: boolean;
  onApprove: () => void;
}) {
  const c = e.classification,
    rules: ClassificationRules = classificationRules(pack),
    defs = factDefinitions(rules),
    section = (s: FactDefinition["section"]) =>
      defs.filter((d) => d.section === s),
    art50 = art50Assessment(c, rules),
    blockers = approvalBlockers(c, rules),
    competence = aiOfficeCompetence(c),
    triggers = reReviewTriggers(c, rules, today),
    stalePackages = e.reports.filter(
      (r) =>
        r.kind === "final" &&
        (!r.release || ["internal", "approved"].includes(r.release.state)) &&
        capturedBeforeMigration(r.snapshot),
    ).length,
    route = highRiskRouteOf(c),
    label = (id: string) => factLabel(rules, id);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Risk classification</h2>
          <Badge value={c.status} />
        </div>
        <div className="content-pad body-copy">
          <h3>{classify(c)}</h3>
          <p>
            {c.rationale ||
              "Complete the guided assessment and record your legal classification rationale."}
          </p>
          <p>
            <b>Operator:</b> {c.operatorRole}
            <br />
            <b>Route:</b> {c.annexRoute} ({routeLabels[route]})
            <br />
            <b>Recorded against:</b> {c.version}, researched {legalDate(c.asOf)}
            {c.rulePackVersion && (
              <>; evaluated with rule pack {c.rulePackVersion}</>
            )}
          </p>
          <p>
            <b>Intended purpose:</b> {c.intendedPurpose || "Unrecorded"}
          </p>
          {c.legacy && (
            <p className="context-strip" data-testid="classification-migration">
              Recorded before tri-state facts with four flags
              {c.legacy.status === "approved"
                ? ", approved by " + (c.legacy.approvedBy ?? "a reviewer")
                : ""}
              .{" "}
              {awaitsReclassification(c)
                ? "Every fact is now unknown: classify again and approve independently."
                : "Classified again with the guided assessment."}{" "}
              The earlier approval stays in the history and the audit trail.
              {stalePackages > 0 &&
                " " +
                  stalePackages +
                  (stalePackages === 1
                    ? " final report package was"
                    : " final report packages were") +
                  " captured before the migration and must be captured again."}
            </p>
          )}
          {blockers.length > 0 && (
            <div className="classification-blockers">
              <b>
                {c.status === "approved"
                  ? "Now needs attention"
                  : "Approval waits for"}
              </b>
              <ul className="rule-pack-list">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          {reviewer && c.status === "provisional" && (
            <Button
              disabled={busy || blockers.length > 0}
              title={
                blockers.length ? "Resolve the listed items first" : undefined
              }
              onClick={onApprove}
            >
              Approve independently
            </Button>
          )}
        </div>
      </section>
      <div className="split-grid">
        {rules.practices.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <h2>Prohibited practices (Art 5)</h2>
            </div>
            <div className="content-pad body-copy">
              <FactRows e={e} defs={section("art5")} />
            </div>
          </section>
        )}
        <section className="panel">
          <div className="panel-head">
            <h2>Transparency (Art 50)</h2>
          </div>
          <div className="content-pad body-copy">
            <ul className="classification-items">
              {art50.map((r) => {
                const [text, tone] = art50Labels[r.status];
                return (
                  <li key={r.code}>
                    <b>
                      Art {r.article} · {r.title}
                    </b>{" "}
                    <span className={"badge " + tone}>{text}</span>
                    {r.missingFacts.length > 0 && (
                      <small className="subtle">
                        {" "}
                        Unknown: {r.missingFacts.map(label).join("; ")}
                      </small>
                    )}
                    {r.exclusion && (
                      <small className="subtle">
                        {" "}
                        Excluded: {r.exclusion.label} ({r.exclusion.basis}){" "}
                        {r.exclusion.legalReview?.required && (
                          <LegalReviewLabel
                            itemIds={r.exclusion.legalReview.itemIds}
                          />
                        )}
                      </small>
                    )}
                    {r.claimedExceptions.map((x) => (
                      <small className="subtle" key={x.id}>
                        {" "}
                        Exception claimed, tested per item: {x.label}{" "}
                        {x.legalReview?.required && (
                          <LegalReviewLabel itemIds={x.legalReview.itemIds} />
                        )}
                      </small>
                    ))}
                  </li>
                );
              })}
            </ul>
            <details className="regulatory-detail">
              <summary>Art 50 facts and exceptions</summary>
              <FactRows
                e={e}
                defs={[
                  ...section("art50Provider"),
                  ...section("art50Shared"),
                  ...section("art50Deployer"),
                ]}
              />
            </details>
          </div>
        </section>
      </div>
      <div className="split-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>GPAI, AI Office and organisation</h2>
          </div>
          <div className="content-pad body-copy">
            <FactRows e={e} defs={section("gpai")} />
            <p>
              <b>AI Office competence (Art 75(1)):</b> provider duties:{" "}
              {competenceText(competence.provider)}; deployer duties under Art
              50(3) and (4): {competenceText(competence.deployer)}.{" "}
              <LegalReviewLabel itemIds={["LR-08"]} />
            </p>
            <FactRows
              e={e}
              defs={classificationFacts.filter(
                (d) => d.section === "organisation",
              )}
            />
            {c.derogation && (
              <p>
                <b>Art 6(3) derogation:</b> {c.derogation.rationale || "—"}
                <br />
                <b>Registration evidence:</b>{" "}
                {c.derogation.registrationEvidence || "—"}
              </p>
            )}
            <details className="regulatory-detail">
              <summary>Route facts and dates</summary>
              <FactRows
                e={e}
                defs={[...section("route"), ...section("dates")]}
              />
            </details>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Guidance cited and re-review</h2>
          </div>
          <div className="content-pad body-copy">
            <ul className="rule-pack-list">
              {(c.guidance ?? rules.guidance).map((g) => (
                <li key={g.id}>
                  {g.title}: {g.reference}, {g.status}
                  {g.date ? " (" + legalDate(g.date) + ")" : ""}
                  {g.legalEffect && (
                    <small className="subtle"> {g.legalEffect}</small>
                  )}
                </li>
              ))}
            </ul>
            {!c.guidance && (
              <p className="subtle">
                Not classified yet: the guidance the next classification will
                cite.
              </p>
            )}
            <ul className="classification-items">
              {triggers.map((t) => (
                <li key={t.id}>
                  <b>{t.title}</b>{" "}
                  <span
                    className={
                      "badge " + (t.state === "due" ? "amber" : "neutral")
                    }
                  >
                    {t.state === "due"
                      ? "Re-review due"
                      : t.state === "scheduled"
                        ? "Scheduled " + legalDate(t.date!)
                        : "Watching"}
                  </span>
                  <small className="subtle"> {t.basis}</small>
                </li>
              ))}
            </ul>
            {(c.history?.length ?? 0) > 0 && (
              <details className="regulatory-detail">
                <summary>Classification history</summary>
                <ul className="rule-pack-list">
                  {[...(c.history ?? [])].reverse().map((h, i) => (
                    <li key={i}>
                      {h.at ? h.at.slice(0, 10) + " · " : ""}
                      {h.action === "approved_v1"
                        ? "Approved before tri-state facts"
                        : h.action === "approved"
                          ? "Approved"
                          : "Classified"}
                      {h.by ? " by " + h.by : ""}: {h.label} ({h.legalVersion}
                      {h.rulePackVersion
                        ? ", rule pack " + h.rulePackVersion
                        : ""}
                      )
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
