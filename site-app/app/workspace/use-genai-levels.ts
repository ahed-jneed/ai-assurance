"use client";
// The GenAI evidence level of each file in the Evidence vault (#145), from
// the GenAI results view. Loaded only for internal roles (the view refuses
// client roles) and only when the engagement holds GenAI files; reloaded
// when the engagement changes. A failed load shows no levels.
import { useEffect, useMemo, useState } from "react";
import type { Engagement, Role } from "@/lib/domain";
import {
  GENAI_RESULT_CATEGORIES,
  genaiArtifactLevels,
  type GenaiArtifactLevel,
  type GenaiResultLevelSource,
} from "@/lib/genai/evidence-levels";
import { isClientRole } from "@/lib/workflow-state";

export function useGenaiLevels(
  tenantId: string,
  e: Engagement,
  role: Role,
): Map<string, GenaiArtifactLevel> {
  const [results, setResults] = useState<GenaiResultLevelSource[]>([]);
  const wanted =
    !isClientRole(role) &&
    e.artifacts.some((a) => GENAI_RESULT_CATEGORIES.includes(a.category));
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void fetch(
      "/api/assurance?" +
        new URLSearchParams({ tenantId, engagementId: e.id, view: "genai" }),
      { headers: { accept: "application/json" } },
    )
      .then(
        (r) =>
          (r.ok ? r.json() : Promise.resolve({ results: [] })) as Promise<{
            results?: GenaiResultLevelSource[];
          }>,
      )
      .then((body) => {
        if (live) setResults(body.results ?? []);
      })
      .catch(() => {
        if (live) setResults([]);
      });
    return () => {
      live = false;
    };
  }, [wanted, tenantId, e.id, e.version]);
  return useMemo(
    () => (wanted ? genaiArtifactLevels(results, e.artifacts) : new Map()),
    [wanted, results, e.artifacts],
  );
}
