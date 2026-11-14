"use client";
import { BookOpen } from "lucide-react";
import { lazy, Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ActionState } from "@/lib/permissions";
import type { Engagement } from "@/lib/domain/types";
import {
  asRulePack,
  isoToday,
  legalDate,
  upcomingDates,
  type RegulatorySnapshot,
} from "@/lib/rule-pack";
import type { WorkspaceData } from "../../workspace-types";
import { panelFallback } from "../panels";
import { ClassificationPanel } from "./classification-panel";
import {
  ObligationsByDate,
  RulePackSources,
  RulePackStatus,
  StandardsRegister,
} from "./rule-pack-views";

// The heatmap is code-split (docs/design/criteria-model.md section 15.2).
const CriteriaCoverage = lazy(() => import("./criteria-coverage"));
type CoverageProps = {
  tenantId: string;
  engagementId: string;
  version: number;
};

/**
 * The engagement's risk classification and criteria coverage heatmap,
 * with the rule pack's obligations by date, standards register and sources.
 */
export function RegulatoryMapping({
  engagement: e,
  catalog,
  features,
  coverage,
  approval,
  busy,
  onApprove,
}: {
  engagement: Engagement;
  catalog: WorkspaceData["catalog"];
  /** Where the heatmap loads from; absent for client roles (403 in phase 1). */
  coverage?: CoverageProps;
  /** What the engagement's criteria pack switches on. */
  features: { aiActClassification: boolean };
  /** Whether this person may approve the classification, and if not, why. */
  approval: ActionState;
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
            classified={features.aiActClassification}
            coverage={coverage}
            pack={pack}
            today={today}
            approval={approval}
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
  classified,
  coverage,
  pack,
  today,
  approval,
  busy,
  onApprove,
}: {
  engagement: Engagement;
  /** The pack has the AI Act classification (criteria model section 7.1). */
  classified: boolean;
  coverage?: CoverageProps;
  pack: RegulatorySnapshot | null;
  today: string;
  approval: ActionState;
  busy: boolean;
  onApprove: () => void;
}) {
  return (
    <>
      {classified && (
        <ClassificationPanel
          engagement={e}
          pack={pack}
          today={today}
          approval={approval}
          busy={busy}
          onApprove={onApprove}
        />
      )}
      {pack && (
        <section className="panel">
          <div className="panel-head">
            <h2>Regulatory basis</h2>
            <BookOpen size={20} />
          </div>
          <div className="content-pad body-copy">
            <RegulatoryBasis pack={pack} today={today} />
          </div>
        </section>
      )}
      {coverage && (
        <Suspense fallback={panelFallback}>
          <CriteriaCoverage {...coverage} />
        </Suspense>
      )}
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
