"use client";

import { useState } from "react";
import type { AssuranceRecord } from "@/lib/assurance-core";
import {
  emptyFeature,
  emptyRelation,
  type Exclusion,
  type FeatureRow,
  type Relation,
} from "./types";

/**
 * The open form dialog and the state its inputs keep outside the form: the
 * revised record, the prefilled values, the execution mode, the feature
 * contract, the source relationships, the exclusions and the affected records.
 */
export function useWorkbenchForm() {
  const [form, setForm] = useState(""),
    [preset, setPreset] = useState<Record<string, string>>({}),
    [executionMode, setExecutionMode] = useState("provided_predictions"),
    [revision, setRevision] = useState<AssuranceRecord | null>(null),
    [relations, setRelations] = useState<Relation[]>([emptyRelation()]),
    [exclusions, setExclusions] = useState<Exclusion[]>([
      { recordId: "", reason: "" },
    ]),
    [affectedIds, setAffectedIds] = useState<string[]>([]),
    [features, setFeatures] = useState<FeatureRow[]>([emptyFeature()]);

  /** Opens the form of `op`, revising `previous` or prefilled with `defaults`. */
  function start(
    op: string,
    previous: AssuranceRecord | null = null,
    defaults: Record<string, string> = {},
  ) {
    setPreset(defaults);
    setExecutionMode(defaults.mode ?? "provided_predictions");
    setRevision(previous);
    setRelations(
      previous?.body.relations?.map(
        (r: { locationId: string; relation: string; rationale: string }) => ({
          locationId: r.locationId,
          relation: r.relation,
          rationale: r.rationale,
        }),
      ) ?? [emptyRelation()],
    );
    setExclusions([{ recordId: "", reason: "" }]);
    if (op === "impact") setAffectedIds(previous?.body.affectedIds ?? []);
    setForm(op);
    setFeatures([emptyFeature()]);
  }

  return {
    form,
    setForm,
    preset,
    executionMode,
    setExecutionMode,
    revision,
    relations,
    setRelations,
    exclusions,
    setExclusions,
    affectedIds,
    setAffectedIds,
    features,
    setFeatures,
    start,
  };
}

export type WorkbenchForm = ReturnType<typeof useWorkbenchForm>;
