import type { ReactNode } from "react";
import type { AssuranceRecord } from "@/lib/assurance-core";
import type { ReviewQueueSummary } from "@/lib/assurance-search";
import type { ObligationOptions } from "@/lib/criteria/types";
import type { WorkspaceData } from "../workspace-types";
import type { ExternalJobFields } from "../external-job-detail";

export type Engagement = NonNullable<WorkspaceData["engagement"]>;

// Rows of GET /api/assurance, as selected in lib/read-models/assurance-view.ts
// and lib/assurance-store.ts (jobs).
export type ExecutionJob = ExternalJobFields & {
  id: string;
  system_name: string;
  fence: number;
  created_at: string;
};
export type RunnerWorker = {
  id: string;
  name: string;
  image_digest: string;
  capabilities: string;
  active: number;
  last_seen: string | null;
};
export type EngagementAccess = {
  user_id: string;
  display_name: string;
  role: string;
  status: string;
  active: number;
};

export type Snapshot = {
  // Records of formKinds (and obligation assessments where the pack has
  // them), loaded page by page by kind. Never every record: the registers,
  // the record pickers, the search, the review queue and the record details
  // read the server instead.
  records: AssuranceRecord[];
  total: number;
  // How many records the engagement holds of each kind.
  kindCounts: Record<string, number>;
  // The caller's review queue, computed on the server over every record.
  queue: ReviewQueueSummary;
  jobs: (ExecutionJob & { compiled?: boolean })[];
  workers: RunnerWorker[];
  access: EngagementAccess[];
  eligibleMembers: WorkspaceData["people"];
  capabilities: Record<string, string>;
  // The external queue over every job of the engagement.
  telemetry: {
    total: number;
    queued: number;
    running: number;
    stalled: number;
  };
};

// Fields of the POST /api/assurance response that the workbench reads; each
// operation returns only some of them.
export type ActResult = {
  record?: AssuranceRecord;
  packet?: unknown;
  trust?: unknown;
} & ({ token?: undefined } | { token: string; workerId: string });

/** Runs one POST /api/assurance operation and refreshes the workbench. */
export type Act = (
  op: string,
  values: Record<string, unknown>,
) => Promise<ActResult>;

/** Opens the form dialog of `op`, revising `previous` or prefilled. */
export type OpenForm = (
  op: string,
  previous?: AssuranceRecord | null,
  defaults?: Record<string, string>,
) => void;

/** A register of the records of `kinds` that match the search and filter. */
export type RegisterList = (
  kinds: string[],
  empty: string,
  emptyAction?: ReactNode,
) => ReactNode;

export type Field = {
  name: string;
  label: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  multiline?: boolean;
  type?: string;
  help?: string;
  initial?: string;
};

export type FieldOption = { value: string; label: string };

export type FeatureRow = {
  name: string;
  type: string;
  unit: string;
  nullable: boolean;
  nullHandling: string;
  categories: never[];
};
export const emptyFeature = (): FeatureRow => ({
  name: "",
  type: "number",
  unit: "",
  nullable: false,
  nullHandling: "reject",
  categories: [],
});

export type Relation = {
  locationId: string;
  relation: string;
  rationale: string;
};
export const emptyRelation = (): Relation => ({
  locationId: "",
  relation: "supports",
  rationale: "",
});

export type Exclusion = { recordId: string; reason: string };

export const label = (s: string) =>
  s.replace(/([A-Z])/g, " $1").replaceAll("_", " ");

/**
 * Display names of the worker adapter formats (lib/commands/assurance/
 * workers.ts): label() would spell acronyms out ("O N N X") (#202).
 */
const adapterFormatNames: Record<string, string> = {
  provided_predictions: "Provided predictions",
  client_local: "Client-local worker",
  ONNX: "ONNX",
  XGBoost: "XGBoost",
  LightGBM: "LightGBM",
  PMML: "PMML",
  genai_ingest: "GenAI evidence ingest",
};
export const adapterFormatLabel = (format: string) =>
  adapterFormatNames[format] ?? label(format);
/** The formats offered when enrolling a worker, in display order. */
export const enrolmentFormats = [
  "provided_predictions",
  "ONNX",
  "XGBoost",
  "LightGBM",
  "PMML",
] as const;

/**
 * A prediction lineage record as a picker option: its input dataset, model
 * name and version and the date the predictions were produced, never the raw
 * record id (#202).
 */
export function predictionOptionLabel(
  r: Pick<AssuranceRecord, "createdAt" | "body">,
  e: Pick<Engagement, "artifacts" | "models">,
) {
  const dataset = e.artifacts.find((a) => a.id === r.body.datasetId)?.name,
    model = e.models.find((m) => m.id === r.body.modelId),
    date = String(r.body.producedAt ?? r.createdAt ?? "").slice(0, 10);
  return [
    dataset ?? "Predictions",
    model ? model.name + " " + model.version : "",
    date,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Pending legal review · LR-02": a flagged obligation item, never approved (D-02). */
export const pendingLegalReview = (itemIds: string[]) =>
  "Pending legal review · " + itemIds.join(", ");
/** An obligation subitem in a picker, with its legal-review flag when it has one. */
export function obligationOptionLabel(o: ObligationOptions["items"][number]) {
  const label = o.article + " · " + o.title;
  return o.legalReview?.required
    ? label + " (" + pendingLegalReview(o.legalReview.itemIds) + ")"
    : label;
}
