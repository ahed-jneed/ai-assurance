"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AssuranceRecord } from "@/lib/assurance-core";
import { RecordPicker, type SearchScope } from "../assurance-record-search";
import { emptyRelation, type Relation } from "./types";

/** The precise sources an assertion relates to, each with its rationale. */
export function SourceRelations({
  scope,
  refreshKey,
  relations,
  setRelations,
  onDirty,
  remember,
  describeRecord,
}: {
  scope: SearchScope;
  refreshKey: unknown;
  relations: Relation[];
  setRelations: (relations: Relation[]) => void;
  onDirty: () => void;
  remember: (...records: AssuranceRecord[]) => void;
  describeRecord: (id: string) => string;
}) {
  return (
    <section>
      <h3>Source relationships</h3>
      {relations.map((r, i) => (
        <div className="record-item" key={i}>
          <div className="workbench-field">
            <span>Precise source</span>
            <RecordPicker
              scope={scope}
              kinds={["location"]}
              refreshKey={refreshKey}
              single
              selected={r.locationId ? [r.locationId] : []}
              onChange={(ids) => {
                setRelations(
                  relations.map((x, j) =>
                    j === i ? { ...x, locationId: ids[0] ?? "" } : x,
                  ),
                );
                onDirty();
              }}
              onPick={remember}
              label={"Precise source " + (i + 1)}
              empty="No source locations recorded yet."
              title={(x) =>
                String(x.body.label ?? x.id) +
                (x.body.version ? " · " + x.body.version : "")
              }
              detail={(x) => String(x.body.locator ?? "")}
              describe={describeRecord}
            />
          </div>
          <label className="workbench-field">
            Relationship
            <select
              value={r.relation}
              onChange={(ev) =>
                setRelations(
                  relations.map((x, j) =>
                    j === i ? { ...x, relation: ev.target.value } : x,
                  ),
                )
              }
            >
              {["supports", "contradicts", "superseded"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="workbench-field">
            Relevance and reliability rationale
            <Textarea
              required
              value={r.rationale}
              onChange={(ev) =>
                setRelations(
                  relations.map((x, j) =>
                    j === i ? { ...x, rationale: ev.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setRelations(relations.filter((_, j) => i !== j));
              onDirty();
            }}
          >
            Remove source
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setRelations([...relations, emptyRelation()]);
          onDirty();
        }}
      >
        Add source relationship
      </Button>
    </section>
  );
}
