import type { ReactNode } from "react";
import type { AssuranceRecord } from "@/lib/assurance-core";
import type { ReviewQueueSummary } from "@/lib/assurance-search";
import type { ObligationOptions } from "@/lib/criteria/types";
import { count, valueLabel } from "@/lib/presentation";
import {
  runnerCapabilities,
  runnerCapabilityInfo,
  type RunnerCapability,
} from "@/lib/runner-capabilities";
import type { WorkspaceData } from "../workspace-types";
import type { ExternalJobFields } from "../external-job-detail";
import { distinctNames, planLabel } from "../genai-ingest-labels";

export type Engagement = NonNullable<WorkspaceData["engagement"]>;

// Rows of GET /api/assurance, as selected in lib/read-models/assurance-view.ts
// and lib/assurance-store.ts (jobs).
export type ExecutionJob = ExternalJobFields & {
  id: string;
  /** Null for a GenAI ingest job, which names no system. */
  system_name: string | null;
  fence: number;
  /** Leased attempts of the job; the fence also moves on a cancel (#233). */
  attempts: number;
  created_at: string;
  /** A GenAI ingest job's frozen plan: its record, procedure, criteria and time. */
  plan_id?: string | null;
  procedure_id?: string | null;
  plan_criteria?: number | null;
  plan_created_at?: string | null;
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
  /** Every member of the practice by name, revoked members included. */
  memberNames?: { user_id: string; display_name: string | null }[];
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

/** A coded value as the workbench shows it, in sentence case (#227). */
export const label = valueLabel;

/** An execution mode as the execution requests show it. */
export const modeLabel = (mode: string) =>
  mode === "genai_ingest" ? "GenAI ingest" : label(mode);

/**
 * What an execution request is called (#221): the system it runs, or for a
 * GenAI ingest job its frozen plan's label, as the Queue ingest dialog
 * named the plan. Never null or a bare id.
 */
export function jobName(
  j: Pick<
    ExecutionJob,
    | "mode"
    | "system_name"
    | "procedure_id"
    | "plan_criteria"
    | "plan_created_at"
  >,
  procedures: { id: string; templateId: string; title: string }[],
) {
  if (j.mode === "genai_ingest")
    return planLabel(
      j.procedure_id,
      j.plan_criteria,
      j.plan_created_at,
      procedures,
    );
  return j.system_name || "External execution";
}

/**
 * What a finished execution request offers to compile, if anything (#240
 * item 1): a GenAI ingest job compiles its envelope into a GenAI result, as
 * the GenAI evidence tab does; any other job compiles a draft paper. Nothing
 * once the job is compiled or before it succeeded.
 */
export function compileAction(
  j: Pick<ExecutionJob, "mode" | "state"> & { compiled?: boolean },
): { op: "compileGenaiResult" | "importJob"; label: string } | null {
  if (j.state !== "succeeded" || j.compiled) return null;
  return j.mode === "genai_ingest"
    ? { op: "compileGenaiResult", label: "Compile GenAI result" }
    : { op: "importJob", label: "Compile draft paper" };
}

/**
 * The execution requests' names, in order (#227): jobName, and for GenAI
 * ingest jobs of different plans that would read the same, the plan's id
 * suffix, as the Queue ingest dialog tells those plans apart.
 */
export function jobNames(
  jobs: (Parameters<typeof jobName>[0] & Pick<ExecutionJob, "plan_id">)[],
  procedures: Parameters<typeof jobName>[1],
) {
  return distinctNames(
    jobs,
    (j) => jobName(j, procedures),
    (j) => (j.mode === "genai_ingest" ? j.plan_id : null),
  );
}

/**
 * The Cancel execution select's options: the queued and running requests,
 * each named as the execution requests name it, with its id (#221).
 */
export function activeJobOptions(
  jobs: (Parameters<typeof jobNames>[0][number] &
    Pick<ExecutionJob, "id" | "state">)[],
  procedures: Parameters<typeof jobName>[1],
) {
  const names = jobNames(jobs, procedures);
  return jobs
    .map((j, i) => ({ j, name: names[i] }))
    .filter(({ j }) => ["queued", "running"].includes(j.state))
    .map(({ j, name }) => ({ value: j.id, label: name + " · " + j.id }));
}

/**
 * The external queue's telemetry line: totals by state and, when the list is
 * cut short, how many of the most recent requests it shows.
 */
export function telemetryText(t: Snapshot["telemetry"], listed: number) {
  return (
    [
      count(t.total, "request"),
      t.queued.toLocaleString() + " queued",
      t.running.toLocaleString() + " running",
      count(t.stalled, "expired lease"),
    ].join(" · ") +
    (t.total > listed
      ? " · listing the " +
        (listed === 1
          ? "most recent"
          : listed.toLocaleString() + " most recent")
      : "")
  );
}

/**
 * How many attempts a job has had: the leased attempts the runner recorded,
 * never the lease fence, which a cancel also moves (#233). A row from an
 * older server without the count shows none.
 */
export const attemptsLabel = (attempts: number | undefined) =>
  typeof attempts === "number" && attempts > 0
    ? count(attempts, "attempt")
    : "not yet attempted";

/**
 * Display name of a worker capability (lib/runner-capabilities.ts): label()
 * would spell acronyms out ("O N N X") (#202).
 */
export const adapterFormatLabel = (format: string) =>
  Object.hasOwn(runnerCapabilityInfo, format)
    ? runnerCapabilityInfo[format as RunnerCapability].name
    : label(format);
/**
 * The capabilities offered when enrolling a worker, in display order: every
 * one the server accepts, from the same list (#211).
 */
export const enrolmentFormats = runnerCapabilities;

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

/**
 * A person's name in the workbench's records: the viewer, then the members
 * holding access to the engagement, then any member of the practice, so a
 * revoked member keeps their name on the access decision that revoked them
 * (#244 item 5). "Practice member" only for an id no membership names.
 */
export function personName(
  id: string,
  sources: {
    identity: { id: string; name: string };
    people: readonly { user_id: string; display_name: string }[];
    memberNames?: readonly { user_id: string; display_name: string | null }[];
  },
) {
  if (id === sources.identity.id) return sources.identity.name;
  return (
    sources.people.find((p) => p.user_id === id)?.display_name ||
    sources.memberNames?.find((p) => p.user_id === id)?.display_name ||
    "Practice member"
  );
}
