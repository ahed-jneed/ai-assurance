"use client";
// The GenAI evidence level of each file in the Evidence vault (#145), from
// the GenAI results view, shared with the Testing lab's GenAI tab
// (lib/assurance-query.ts). Read only for internal roles (the view refuses
// client roles) and only when the engagement holds GenAI files; read again
// for each engagement version. A failed read shows no levels.
import { useMemo } from "react";
import { useAssuranceQuery } from "@/hooks/use-assurance-query";
import { genaiQuery } from "@/lib/assurance-query";
import type { Engagement, Role } from "@/lib/domain/types";
import {
  GENAI_RESULT_CATEGORIES,
  genaiArtifactLevels,
  type GenaiArtifactLevel,
} from "@/lib/genai/evidence-levels";
import { isClientRole } from "@/lib/workflow-state";

export function useGenaiLevels(
  tenantId: string,
  e: Engagement,
  role: Role,
): Map<string, GenaiArtifactLevel> {
  const wanted =
    !isClientRole(role) &&
    e.artifacts.some((a) => GENAI_RESULT_CATEGORIES.includes(a.category));
  const { data, error } = useAssuranceQuery(
    wanted ? { tenantId, engagementId: e.id, version: e.version } : null,
    genaiQuery,
  );
  const results = error ? undefined : data?.results;
  return useMemo(
    () =>
      wanted && results
        ? genaiArtifactLevels(results, e.artifacts)
        : new Map<string, GenaiArtifactLevel>(),
    [wanted, results, e.artifacts],
  );
}
