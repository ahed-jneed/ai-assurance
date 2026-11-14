"use client";

import { useMemo } from "react";
import { useAssuranceQuery } from "@/hooks/use-assurance-query";
import {
  recordsQuery,
  viewQuery,
  type AssuranceScope,
} from "@/lib/assurance-query";
import type { Snapshot } from "./types";

// The kinds the workbench loads in full: its forms offer them as options and
// the execution planner reads them. They grow with system revisions,
// prediction sets and dataset versions, not with the evidence, so they stay
// small; every other record is read by search (registers, pickers) or by id
// (details).
const systemRecords = recordsQuery("system"),
  predictionRecords = recordsQuery("prediction"),
  datasetRecords = recordsQuery("dataset"),
  obligationQuery = recordsQuery("obligation"),
  workbenchView = viewQuery<Omit<Snapshot, "records">>("workbench", {});

/**
 * The workbench view and the kinds its forms and execution planner read in
 * full, each a shared query (lib/assurance-query.ts): read once per
 * engagement version, kept while another view is open, and read again after
 * each action. The dataset cards are the Testing lab's query too.
 */
export function useWorkbenchData(
  atVersion: AssuranceScope,
  obligationsOn: boolean,
) {
  const view = useAssuranceQuery(atVersion, workbenchView),
    systems = useAssuranceQuery(atVersion, systemRecords),
    predictions = useAssuranceQuery(atVersion, predictionRecords),
    datasets = useAssuranceQuery(atVersion, datasetRecords),
    obligationRecords = useAssuranceQuery(
      obligationsOn ? atVersion : null,
      obligationQuery,
    ),
    queries = [view, systems, predictions, datasets, obligationRecords];
  const snapshot = useMemo<Snapshot | null>(
    () =>
      view.data &&
      systems.data &&
      predictions.data &&
      datasets.data &&
      (!obligationsOn || obligationRecords.data)
        ? {
            ...view.data,
            records: [
              ...systems.data,
              ...predictions.data,
              ...datasets.data,
              ...(obligationRecords.data ?? []),
            ],
          }
        : null,
    [
      view.data,
      systems.data,
      predictions.data,
      datasets.data,
      obligationRecords.data,
      obligationsOn,
    ],
  );
  const refreshing = queries.some((q) => q.fetching || q.loading),
    loadError = queries.find((q) => q.error)?.error ?? "",
    // Bumped by each answer of the view, so the server-backed registers and
    // the open record read again after an action.
    loaded = view.generation;
  const load = () => Promise.all(queries.map((q) => q.reload()));
  return { snapshot, refreshing, loadError, loaded, load };
}
