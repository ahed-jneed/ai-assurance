"use client";

import { Button } from "@/components/ui/button";
import type { AssuranceRecord } from "@/lib/assurance-core";
import { RecordPicker, type SearchScope } from "../assurance-record-search";
import type { Act, OpenForm, RegisterList } from "./types";

/** Assistant: cited evidence briefings over selected sources. */
export function AssistantSection({
  scope,
  refreshKey,
  writer,
  busy,
  sourceIds,
  setSourceIds,
  known,
  hasSources,
  act,
  open,
  list,
  onBriefing,
  onEvidenceSection,
  remember,
  describeRecord,
}: {
  scope: SearchScope;
  refreshKey: unknown;
  writer: boolean;
  busy: boolean;
  sourceIds: string[];
  setSourceIds: (ids: string[]) => void;
  known: ReadonlyMap<string, AssuranceRecord>;
  // Whether the engagement holds source locations or assertions.
  hasSources: boolean;
  act: Act;
  open: OpenForm;
  list: RegisterList;
  /** Opens the briefing an assist action created. */
  onBriefing: (record: AssuranceRecord) => void;
  onEvidenceSection: () => void;
  remember: (...records: AssuranceRecord[]) => void;
  describeRecord: (id: string) => string;
}) {
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Cited evidence briefing</h2>
          <p className="subtle">
            Select up to 30 sources to prepare an attributed draft.
          </p>
        </div>
      </div>
      <div className="workbench-briefing-selection">
        <span>{sourceIds.length} of 30 sources selected</span>
        {sourceIds.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSourceIds([])}>
            Clear selection
          </Button>
        )}
      </div>
      <div className="briefing-sources">
        <RecordPicker
          scope={scope}
          kinds={["location", "assertion"]}
          refreshKey={refreshKey}
          selected={sourceIds}
          onChange={setSourceIds}
          max={30}
          disabled={busy}
          label="Briefing sources"
          empty="No source locations or assertions recorded yet."
          title={(r) => String(r.body.label ?? r.body.statement ?? r.id)}
          detail={(r) => String(r.body.locator ?? r.body.criterion ?? "")}
          describe={describeRecord}
          onPick={remember}
        />
      </div>
      {writer && (
        <div className="briefing-actions">
          {[
            ["summary", "Brief selected evidence"],
            ["contradictions", "Show recorded contradictions"],
            ["unsupported", "Find support gaps"],
            ["questions", "Draft collection questions"],
          ].map(([action, title]) => (
            <Button
              key={action}
              variant="outline"
              disabled={busy || !sourceIds.length}
              onClick={() =>
                void act("assist", { sourceIds, action })
                  // "assist" always responds with the created briefing.
                  .then((v) => onBriefing(v.record as AssuranceRecord))
                  .catch(() => {})
              }
            >
              {title}
            </Button>
          ))}
        </div>
      )}
      {list(
        ["assistant"],
        "No evidence briefings prepared yet",
        !hasSources ? (
          <button type="button" onClick={onEvidenceSection}>
            Open assertions and source locations
          </button>
        ) : undefined,
      )}
      <details className="help-panel">
        <summary>Optional model service</summary>
        {writer && (
          <div className="row-actions">
            <Button
              variant="outline"
              disabled={
                !sourceIds.some((id) => known.get(id)?.kind === "location")
              }
              onClick={() => open("exportBriefing")}
            >
              Export selected locations
            </Button>
            <Button variant="outline" onClick={() => open("importBriefing")}>
              Import cited model draft
            </Button>
          </div>
        )}
        <p>
          The available assistant uses deterministic extraction and recorded
          relationships. Client content is data; embedded instructions do not
          execute. It preserves exact citations and does not review, sign or
          release work. The optional portable model service requires an approved
          destination and provider credentials. Exported source packets are
          scoped, expiring and signed; returned drafts are checked against their
          exact pins.
        </p>
      </details>
    </>
  );
}
