"use client";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { classify, type Engagement } from "@/lib/domain";
import {
  asRulePack,
  isoToday,
  legalDate,
  upcomingDates,
  type RegulatorySnapshot,
} from "@/lib/rule-pack";
import type { WorkspaceData } from "../../workspace-types";
import { articleCoverage } from "../coverage";
import { Badge } from "../workspace-ui";
import {
  ObligationsByDate,
  RulePackSources,
  RulePackStatus,
  StandardsRegister,
} from "./rule-pack-views";

/**
 * The engagement's risk classification and article-to-evidence coverage,
 * with the rule pack's obligations by date, standards register and sources.
 */
export function RegulatoryMapping({
  engagement: e,
  catalog,
  reviewer,
  busy,
  onApprove,
}: {
  engagement: Engagement;
  catalog: WorkspaceData["catalog"];
  reviewer: boolean;
  busy: boolean;
  /** Independent approval of a provisional classification. */
  onApprove: () => void;
}) {
  const pack = asRulePack(catalog?.regulatorySnapshot),
    today = isoToday();
  return (
    <>
      {pack && <RulePackStatus pack={pack} engagement={e} today={today} />}
      <Tabs defaultValue="classification">
        {pack && (
          <TabsList>
            <TabsTrigger value="classification">Classification</TabsTrigger>
            <TabsTrigger value="obligations">Obligations by date</TabsTrigger>
            <TabsTrigger value="standards">Standards register</TabsTrigger>
            <TabsTrigger value="sources">Sources & legal review</TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="classification">
          <Classification
            engagement={e}
            pack={pack}
            today={today}
            reviewer={reviewer}
            busy={busy}
            onApprove={onApprove}
          />
        </TabsContent>
        {pack && (
          <>
            <TabsContent value="obligations">
              <ObligationsByDate pack={pack} engagement={e} />
            </TabsContent>
            <TabsContent value="standards">
              <StandardsRegister pack={pack} />
            </TabsContent>
            <TabsContent value="sources">
              <RulePackSources pack={pack} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </>
  );
}

function Classification({
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
  return (
    <>
      <div className="split-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Risk classification</h2>
            <Badge value={e.classification.status} />
          </div>
          <div className="content-pad body-copy">
            <h3>{classify(e.classification)}</h3>
            <p>
              {e.classification.rationale ||
                "Complete the guided assessment and record your legal classification rationale."}
            </p>
            <p>
              <b>Operator:</b> {e.classification.operatorRole}
              <br />
              <b>Route:</b> {e.classification.annexRoute}
              <br />
              <b>Transparency duties:</b>{" "}
              {e.classification.transparency
                ? "Flagged separately"
                : "Not flagged"}
              <br />
              <b>Profiling:</b>{" "}
              {e.classification.profiling
                ? "Flagged; high-risk assessment required"
                : "Not flagged"}
              <br />
              <b>Recorded against:</b> {e.classification.version}, researched{" "}
              {legalDate(e.classification.asOf)}
            </p>
            <p>
              <b>Intended purpose:</b>{" "}
              {e.classification.intendedPurpose || "Unrecorded"}
            </p>
            {reviewer && e.classification.status === "provisional" && (
              <Button disabled={busy} onClick={onApprove}>
                Approve independently
              </Button>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Regulatory basis</h2>
            <BookOpen size={20} />
          </div>
          <div className="content-pad body-copy">
            {pack ? (
              <RegulatoryBasis pack={pack} today={today} />
            ) : (
              <p className="subtle">
                This engagement&apos;s criteria have no EU AI Act rule pack.
              </p>
            )}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Article-to-evidence mapping</h2>
        </div>
        {articleCoverage(e).map((c) => (
          <div className="control-row" key={c.article}>
            <span className="article">{c.article}</span>
            <div>
              <b>{c.title}</b>
              <p className="control-result">
                {c.papers.map((p) => p.templateId).join(" · ") ||
                  "No required papers"}
              </p>
              <Progress
                value={c.coverage}
                aria-label={c.title + " signed coverage"}
              />
            </div>
            <Badge value={c.coverage === 100 ? "signed" : "not evaluated"} />
          </div>
        ))}
      </section>
    </>
  );
}

/** Upcoming dates, guidance and the legal sources, from the rule pack. */
function RegulatoryBasis({
  pack,
  today,
}: {
  pack: RegulatorySnapshot;
  today: string;
}) {
  const act = pack.amendingActs[0];
  return (
    <details className="regulatory-detail">
      <summary>Applicable dates and legal sources</summary>
      <p>
        Current snapshot: <b>{pack.celex}</b>, rule pack{" "}
        <b>{pack.rulePackVersion}</b>, researched{" "}
        {legalDate(pack.researchedAsOf)}.
      </p>
      <ul className="rule-pack-list">
        {upcomingDates(pack, today).map((d) => (
          <li key={d.date}>
            <b>{legalDate(d.date)}</b>:{" "}
            {d.entries
              .map(
                (x) =>
                  x.title +
                  (x.pendingReview.length
                    ? " (pending legal review, " +
                      x.pendingReview.join(", ") +
                      ")"
                    : ""),
              )
              .join("; ")}
          </li>
        ))}
      </ul>
      <p>
        Assess each provision and transitional rule; the Obligations by date
        view lists every date with its legal basis and sources.
      </p>
      <p className="subtle">{pack.guidance}</p>
      {act && (
        <p className="subtle">
          Regulation {act.number} ({act.shortName}), {act.ojReference}, adopted{" "}
          {legalDate(act.adopted)}, in force {legalDate(act.entryIntoForce)}; it
          also amends {act.alsoAmends.join(" and ")}.
        </p>
      )}
      <p className="rule-pack-sources">
        <a
          className="source-link"
          href={pack.authenticAmendmentEli}
          target="_blank"
          rel="noreferrer"
        >
          Authentic amendment {pack.amendingRegulation}
        </a>
        <a
          className="source-link"
          href={pack.authenticBaseActEli}
          target="_blank"
          rel="noreferrer"
        >
          AI Act, {pack.baseAct.ojReference}
        </a>
        <a
          className="source-link"
          href={pack.consolidatedTextUrl}
          target="_blank"
          rel="noreferrer"
          title={"Legal effect: " + pack.consolidatedTextLegalEffect}
        >
          Consolidated text {pack.celex} (no legal effect)
        </a>
        <a
          className="source-link"
          href={pack.timelineUrl}
          target="_blank"
          rel="noreferrer"
        >
          Commission implementation timeline
        </a>
      </p>
    </details>
  );
}
