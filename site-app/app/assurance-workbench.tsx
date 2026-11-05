"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Textarea } from "@/components/ui/textarea";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  Plus,
  RefreshCw,
  FileCheck2,
  Link2,
  Copy,
  Search,
  X,
  ChevronRight,
} from "lucide-react";

import type { WorkspaceData } from "./workspace-types";

import type { AssuranceRecord } from "@/lib/assurance-core";

import obligations from "@/lib/obligation-subitems.json";

import {
  workbenchSections,
  workbenchReviewStates,
  workbenchReviewQueue,
  selectWorkbenchRecords,
  type WorkbenchQuery,
} from "@/lib/workbench-presentation";
import { AssuranceRecordDetails } from "./assurance-record-details";

import { ExecutionPlanner } from "./testing-readiness";

import { AssuranceRegister, recordTitle } from "./assurance-register";

type Snapshot = {
  records: AssuranceRecord[];
  jobs: any[];
  workers: any[];
  access: any[];
  eligibleMembers: any[];
  capabilities: Record<string, string>;
  telemetry: { queued: number; stalled: number };
};

type Field = {
  name: string;
  label: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  multiline?: boolean;
  type?: string;
  help?: string;
  initial?: string;
};

const label = (s: string) => s.replace(/([A-Z])/g, " $1").replaceAll("_", " ");

export function AssuranceWorkbench({
  data,
  onRefresh,
  onPaper,
  onNavigate,
  onEditing,
  onHosted,
  initialProcedure,
  location,
  onLocation,
  onEvidence,
}: {
  location: WorkbenchQuery;
  onLocation: (q: WorkbenchQuery) => void;
  onEvidence: (id: string) => void;
  onHosted: (procedureId: string, cardId: string) => void;
  initialProcedure?: string;
  data: WorkspaceData;
  onRefresh: () => Promise<unknown>;
  onPaper: (id: string) => void;
  onNavigate: (s: string) => void;
  onEditing: (v: boolean) => void;
}) {
  const e = data.engagement!,
    writer = ["Auditor", "Lead Auditor"].includes(data.identity.role),
    lead = data.identity.role === "Lead Auditor",
    reviewer = ["Lead Auditor", "Reviewer"].includes(data.identity.role);

  const query = location.search,
    reviewFilter = location.review,
    tab = location.section;
  const setQuery = (search: string) => onLocation({ ...location, search }),
    setReviewFilter = (review: string) => onLocation({ ...location, review });
  const [detailSection, setDetailSection] = useState<"overview" | "review">(
    "overview",
  );
  const [preset, setPreset] = useState<Record<string, string>>({}),
    [executionMode, setExecutionMode] = useState("provided_predictions");

  const [revision, setRevision] = useState<AssuranceRecord | null>(null),
    [relations, setRelations] = useState([
      { locationId: "", relation: "supports", rationale: "" },
    ]),
    [exclusions, setExclusions] = useState([{ recordId: "", reason: "" }]);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(true),
    [form, setForm] = useState(""),
    [dirty, setDirty] = useState(false),
    [sourceIds, setSourceIds] = useState<string[]>([]),
    [affectedIds, setAffectedIds] = useState<string[]>([]),
    [token, setToken] = useState<{ workerId: string; token: string } | null>(
      null,
    ),
    [features, setFeatures] = useState([
      {
        name: "",
        type: "number",
        unit: "",
        nullable: false,
        nullHandling: "reject",
        categories: [],
      },
    ]);

  const requestRef = useRef<{
    generation: number;
    controller: AbortController | null;
  }>({ generation: 0, controller: null });
  const load = useCallback(async () => {
    const generation = ++requestRef.current.generation;
    requestRef.current.controller?.abort();
    const controller = new AbortController();
    requestRef.current.controller = controller;
    setRefreshing(true);
    try {
      const response = await fetch(
        "/api/assurance?" +
          new URLSearchParams({ tenantId: data.tenantId, engagementId: e.id }),
        { cache: "no-store", signal: controller.signal },
      );
      const value = (await response.json()) as Snapshot & { error?: string };
      if (generation !== requestRef.current.generation) return;
      if (!response.ok) throw Error(value.error ?? "Workbench unavailable");
      setSnapshot(value);
      setLoadError("");
    } catch (x) {
      if (
        !controller.signal.aborted &&
        generation === requestRef.current.generation
      )
        setLoadError(x instanceof Error ? x.message : "Workbench unavailable");
    } finally {
      if (generation === requestRef.current.generation) setRefreshing(false);
    }
  }, [data.tenantId, e.id]);
  useEffect(() => {
    void load();
    return () => requestRef.current.controller?.abort();
  }, [load]);

  useEffect(() => {
    const protect = (ev: BeforeUnloadEvent) => {
      if (dirty || busy) {
        ev.preventDefault();
        ev.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, busy]);

  async function act(op: string, values: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/assurance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: data.tenantId,
            engagementId: e.id,
            op,
            data: values,
          }),
        }),
        v = (await r.json()) as any;
      if (!r.ok) throw Error(v.error);
      await load();
      await onRefresh();
      return v;
    } catch (x) {
      setError(
        x instanceof Error ? x.message : "Action could not be completed",
      );
      throw x;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    onEditing(dirty || busy);
    return () => onEditing(false);
  }, [dirty, busy, onEditing]);
  useEffect(() => {
    setDirty(false);
  }, [location.recordId]);

  const all = snapshot?.records ?? [],
    selected = all.find((r) => r.id === location.recordId) ?? null,
    queue = workbenchReviewQueue(all, data.identity.role, data.identity.id),
    kind = (k: string) => all.filter((r) => r.kind === k),
    options = (k: string) =>
      kind(k).map((r) => ({
        value: r.id,
        label:
          (r.body.name ?? r.body.label ?? r.body.statement ?? r.id) +
          (r.body.version ? " · " + r.body.version : ""),
      })),
    artifacts = e.artifacts.filter((a) => a.status === "accepted"),
    artifactOptions = (category?: string) =>
      artifacts
        .filter((a) => !category || a.category === category)
        .map((a) => ({ value: a.id, label: a.name })),
    models = e.models.map((m) => ({
      value: m.id,
      label: m.name + " · " + m.version,
    })),
    profiles = (e.evaluationProfiles ?? []).map((p) => ({
      value: p.id,
      label: p.name + " · " + p.version,
    })),
    procedures =
      e.workflow?.procedures
        .filter(
          (p) =>
            p.selected && ["applicable", "readiness"].includes(p.applicability),
        )
        .map((p) => ({ value: p.id, label: p.templateId + " · " + p.title })) ??
      [];

  const fields: Record<string, Field[]> = {
    obligationDecision: [
      {
        name: "code",
        label: "Obligation subitem",
        options: obligations.items.map((o) => ({
          value: o.code,
          label: o.article + " · " + o.title,
        })),
        required: true,
      },
      {
        name: "actor",
        label: "Reviewed operator role",
        options: [
          "Provider",
          "Deployer",
          "Importer",
          "Distributor",
          "Authorised representative",
        ].map((x) => ({ value: x, label: x })),
        required: true,
      },
      {
        name: "applicability",
        label: "Applicability decision",
        options: [
          "applicable",
          "readiness",
          "not_applicable",
          "needs_information",
        ].map((x) => ({ value: x, label: label(x) })),
        required: true,
      },
      {
        name: "rationale",
        label: "Actor, trigger facts and scope rationale",
        multiline: true,
        required: true,
      },
      {
        name: "periodAnalysis",
        label: "Application date, transitional and sector analysis",
        multiline: true,
        required: true,
      },
      {
        name: "evidenceId",
        label: "Accepted supporting evidence",
        options: artifactOptions(),
      },
      {
        name: "assessment",
        label: "Evidence sufficiency and unresolved gaps",
        multiline: true,
        required: true,
      },
      {
        name: "outcome",
        label: "Proposed assessment",
        options: ["unassessed", "supported", "qualified", "unsupported"].map(
          (x) => ({ value: x, label: label(x) }),
        ),
        required: true,
      },
    ],

    exportBriefing: [
      {
        name: "processingDestination",
        label: "Approved processing destination identity",
        required: true,
        help: "Must match the independently approved provider configuration. Export does not send data to the provider.",
      },
      {
        name: "governanceArtifactId",
        label: "Accepted processing / privacy decision",
        options: artifactOptions("Governance"),
        required: true,
      },
      {
        name: "reason",
        label: "Scope, data minimization and export rationale",
        multiline: true,
        required: true,
      },
    ],

    importBriefing: [
      {
        name: "artifactId",
        label: "Accepted cited briefing JSON",
        options: artifactOptions().filter((x) =>
          x.label.toLowerCase().endsWith(".json"),
        ),
        required: true,
      },
      {
        name: "assessment",
        label: "Origin and citation assessment",
        multiline: true,
        required: true,
      },
    ],

    registerSystem: [
      { name: "name", label: "AI system name", required: true },
      { name: "version", label: "System revision", required: true },
      {
        name: "intendedUse",
        label: "Intended use and decision boundary",
        multiline: true,
        required: true,
      },
      {
        name: "population",
        label: "Population and period",
        multiline: true,
        required: true,
      },
      {
        name: "modelId",
        label: "Primary model version",
        options: models,
        required: true,
      },
      {
        name: "pipelineArtifactId",
        label: "Preprocessing / pipeline evidence",
        options: artifactOptions("Pipeline code"),
      },
      {
        name: "deploymentArtifactId",
        label: "Deployment manifest",
        options: artifactOptions(),
      },
      { name: "semantics", label: "Output meaning", required: true },
      {
        name: "classOrder",
        label: "Ordered output classes",
        help: "Comma-separated class labels in the adapter output order. Leave empty for regression.",
      },
      {
        name: "threshold",
        label: "Decision threshold",
        type: "number",
        help: "Optional probability threshold from 0 to 1.",
      },
      {
        name: "humanDecision",
        label: "How people use, override and stop the system",
        multiline: true,
        required: true,
      },
      { name: "runtime", label: "Expected runtime / adapter", required: true },
      {
        name: "limitations",
        label: "Compatibility limitations",
        multiline: true,
      },
    ],

    registerPrediction: [
      {
        name: "systemId",
        label: "System revision",
        options: options("system"),
        required: true,
      },
      {
        name: "modelId",
        label: "Producing model",
        options: models,
        required: true,
      },
      {
        name: "datasetId",
        label: "Prediction evidence",
        options: artifactOptions("Dataset"),
        required: true,
      },
      {
        name: "sourceDatasetId",
        label: "Source population evidence",
        options: artifactOptions("Dataset"),
        required: true,
      },
      {
        name: "producedAt",
        label: "Prediction generation time (UTC)",
        type: "datetime-local",
        required: true,
      },
      {
        name: "producingRun",
        label: "Producing run / transaction identity",
        required: true,
      },
      {
        name: "inferenceConfiguration",
        label: "Pipeline, threshold and generation configuration",
        multiline: true,
        required: true,
      },
      {
        name: "mode",
        label: "Origin",
        options: ["provided_predictions", "auditor_model", "client_local"].map(
          (x) => ({ value: x, label: label(x) }),
        ),
        required: true,
      },
      {
        name: "limitations",
        label: "What is verified and what is still declared",
        multiline: true,
        required: true,
      },
    ],

    queueExternal: [
      {
        name: "systemId",
        label: "Pinned system revision",
        options: options("system"),
        required: true,
      },
      {
        name: "procedureId",
        label: "Approved procedure",
        options: procedures,
        required: true,
        help: "The model, dataset and protocol must match the approved procedure.",
      },
      {
        name: "modelId",
        label: "Model version",
        options: models,
        required: true,
      },
      {
        name: "datasetId",
        label: "Input dataset",
        options: artifactOptions("Dataset"),
        required: true,
      },
      {
        name: "profileId",
        label: "Evaluation protocol",
        options: profiles,
        required: true,
      },
      {
        name: "mode",
        label: "Execution mode",
        options: [
          { value: "provided_predictions", label: "Supplied predictions" },
          {
            value: "client_local",
            label: "Client-local prediction evaluation",
          },
          ...(lead
            ? [
                {
                  value: "auditor_model",
                  label: "Independent portable model inference",
                },
              ]
            : []),
        ],
        required: true,
        initial: "provided_predictions",
      },
      {
        name: "predictionId",
        label: "Prediction lineage (prediction modes)",
        options: options("prediction"),
      },
      {
        name: "securityReviewId",
        label: "Accepted adapter security review (model inference)",
        options: artifactOptions("Security"),
      },
      {
        name: "negativeLabel",
        label: "Other binary class label",
        initial: "0",
      },
      { name: "predictionOutput", label: "Named adapter output (ONNX / PMML)" },
      {
        name: "predictionKind",
        label: "Adapter output type",
        options: [
          { value: "label", label: "Class label" },
          { value: "probability", label: "Probability" },
        ],
        initial: "label",
      },
    ],

    addLocation: [
      {
        name: "artifactId",
        label: "Accepted source",
        options: artifactOptions(),
        required: true,
      },
      { name: "label", label: "Location title", required: true },
      {
        name: "kind",
        label: "Source type",
        options: ["document", "table", "code", "log", "dataset"].map((x) => ({
          value: x,
          label: label(x),
        })),
        required: true,
      },
      {
        name: "locator",
        label: "Exact location",
        help: "For example: page 12, paragraph 3; commit/path/lines; row IDs; UTC log interval.",
        required: true,
      },
      {
        name: "excerpt",
        label: "Source observation / exact excerpt",
        multiline: true,
        required: true,
      },
      {
        name: "quality",
        label: "Extraction quality and limitations",
        multiline: true,
        required: true,
      },
    ],

    addAssertion: [
      {
        name: "statement",
        label: "Claimed fact",
        multiline: true,
        required: true,
      },
      {
        name: "criterion",
        label: "Criterion / obligation subitem",
        options: obligations.items.map((o) => ({
          value: o.code,
          label: o.article + " · " + o.title,
        })),
        required: true,
      },
      {
        name: "procedureId",
        label: "Actual audit procedure",
        options: procedures,
      },
      {
        name: "paperId",
        label: "Working paper",
        options: e.papers.map((p) => ({
          value: p.id,
          label: p.templateId + " · " + p.title,
        })),
      },
      {
        name: "locationId",
        label: "Precise source location",
        options: options("location"),
      },
      {
        name: "relation",
        label: "Source relationship",
        options: ["supports", "contradicts", "superseded"].map((x) => ({
          value: x,
          label: label(x),
        })),
      },
      {
        name: "relationReason",
        label: "Why this source is relevant",
        multiline: true,
      },
      {
        name: "missingEvidence",
        label: "Missing support / unresolved evidence",
        multiline: true,
      },
      {
        name: "assessment",
        label: "Auditor judgment of sufficiency and contradictions",
        multiline: true,
        required: true,
      },
      {
        name: "conclusion",
        label: "Proposed assessment",
        options: ["unassessed", "supported", "qualified", "unsupported"].map(
          (x) => ({ value: x, label: label(x) }),
        ),
        required: true,
      },
    ],

    sample: [
      {
        name: "procedureId",
        label: "Related audit procedure",
        options: procedures,
      },
      {
        name: "datasetId",
        label: "Accepted population snapshot",
        options: artifactOptions("Dataset"),
        required: true,
      },
      { name: "idColumn", label: "Unique record-ID column", required: true },
      {
        name: "method",
        label: "Sampling method",
        options: [
          { value: "simple_random", label: "Simple random" },
          { value: "stratified", label: "Stratified — size per stratum" },
        ],
        required: true,
      },
      { name: "stratumColumn", label: "Stratum column (stratified only)" },
      {
        name: "size",
        label: "Requested sample size",
        type: "number",
        initial: "30",
        required: true,
      },
      {
        name: "seed",
        label: "Reproducible seed",
        type: "number",
        initial: "42",
        required: true,
      },
      {
        name: "rationale",
        label: "Population completeness, suitability and sampling rationale",
        multiline: true,
        required: true,
      },
    ],

    impact: [
      {
        name: "sourceType",
        label: "Change type",
        options: [
          "system",
          "legal_source",
          "evidence",
          "protocol",
          "operational_change",
        ].map((x) => ({ value: x, label: label(x) })),
        required: true,
      },
      {
        name: "previousId",
        label: "Previous source / revision",
        required: true,
      },
      { name: "newId", label: "New source / revision", required: true },
      {
        name: "description",
        label: "What changed",
        multiline: true,
        required: true,
      },
      {
        name: "assessment",
        label: "Affected claims, risks and audit work",
        multiline: true,
        required: true,
      },
      {
        name: "decision",
        label: "Proposed action",
        options: ["review_required", "retest_required", "no_effect"].map(
          (x) => ({ value: x, label: label(x) }),
        ),
        required: true,
      },
      {
        name: "reason",
        label: "Decision rationale",
        multiline: true,
        required: true,
      },
    ],

    enrollWorker: [
      { name: "name", label: "Runner name", required: true },
      {
        name: "imageDigest",
        label: "Approved container image digest",
        help: "sha256: followed by 64 hexadecimal characters.",
        required: true,
      },
      {
        name: "securityReview",
        label: "Isolation, egress, resource limits and adapter validation",
        multiline: true,
        required: true,
      },
    ],

    setAccess: [
      {
        name: "userId",
        label: "Internal practice member",
        options: (snapshot?.eligibleMembers ?? data.people)
          .filter((p) =>
            ["Auditor", "Lead Auditor", "Reviewer"].includes(p.role),
          )
          .map((p) => ({
            value: p.user_id,
            label: p.display_name + " · " + p.role,
          })),
        required: true,
      },
      {
        name: "active",
        label: "Engagement access",
        options: [
          { value: "true", label: "Grant access" },
          { value: "false", label: "Revoke access" },
        ],
        required: true,
      },
      { name: "reason", label: "Reason", multiline: true, required: true },
    ],

    importPacket: [
      {
        name: "artifactId",
        label: "Accepted external assurance JSON",
        options: artifactOptions().filter((x) =>
          x.label.toLowerCase().endsWith(".json"),
        ),
        required: true,
      },
      {
        name: "assessment",
        label: "Origin, scope and completeness assessment",
        multiline: true,
        required: true,
      },
    ],
  };

  fields.addAssertion = fields.addAssertion.filter(
    (f) => !["locationId", "relation", "relationReason"].includes(f.name),
  );

  fields.revokeWorker = [
    {
      name: "workerId",
      label: "Runner",
      options: (snapshot?.workers ?? [])
        .filter((w) => w.active)
        .map((w) => ({ value: w.id, label: w.name })),
      required: true,
    },
    {
      name: "reason",
      label: "Revocation rationale",
      multiline: true,
      required: true,
    },
  ];
  fields.cancelJob = [
    {
      name: "jobId",
      label: "Execution",
      options: (snapshot?.jobs ?? [])
        .filter((j) => ["queued", "running"].includes(j.state))
        .map((j) => ({ value: j.id, label: j.system_name + " · " + j.id })),
      required: true,
    },
    {
      name: "reason",
      label: "Cancellation rationale",
      multiline: true,
      required: true,
    },
  ];

  const titles: Record<string, string> = {
    cancelJob: "Cancel execution",
    revokeWorker: "Revoke runner",
    registerSystem: "Register a system revision",
    registerPrediction: "Link prediction lineage",
    queueExternal: "Freeze external execution",
    addLocation: "Locate evidence precisely",
    addAssertion: "Record an assertion",
    sample: "Select a reproducible sample",
    impact: "Assess a change",
    enrollWorker: "Enroll a scoped runner",
    setAccess: "Manage engagement access",
    importPacket: "Import an assurance packet",
    obligationDecision: "Assess an obligation subitem",
    exportBriefing: "Export authorized briefing sources",
    importBriefing: "Import a cited model draft",
  };

  function open(
    op: string,
    previous: AssuranceRecord | null = null,
    defaults: Record<string, string> = {},
  ) {
    setPreset(defaults);
    setExecutionMode(defaults.mode ?? "provided_predictions");
    setRevision(previous);
    setRelations(
      previous?.body.relations?.map((r: any) => ({
        locationId: r.locationId,
        relation: r.relation,
        rationale: r.rationale,
      })) ?? [{ locationId: "", relation: "supports", rationale: "" }],
    );
    setExclusions([{ recordId: "", reason: "" }]);
    if (op === "impact") setAffectedIds(previous?.body.affectedIds ?? []);
    setForm(op);
    setDirty(false);
    setError("");
    setFeatures([
      {
        name: "",
        type: "number",
        unit: "",
        nullable: false,
        nullHandling: "reject",
        categories: [],
      },
    ]);
  }

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const raw = Object.fromEntries(new FormData(ev.currentTarget)) as Record<
      string,
      string
    >;
    let values: Record<string, unknown> = { ...raw };
    for (const [k, v] of Object.entries(raw))
      if (!v && !fields[form]?.find((f) => f.name === k)?.required)
        delete values[k];

    if (form === "obligationDecision") {
      const { evidenceId, ...rest } = raw;
      values = { ...rest, evidenceIds: evidenceId ? [evidenceId] : [] };
    }

    if (form === "exportBriefing")
      values = {
        ...raw,
        sourceIds: sourceIds.filter((id) =>
          kind("location").some((r) => r.id === id),
        ),
      };

    if (form === "registerSystem") {
      const { modelId, semantics, classOrder, threshold, ...rest } = raw;
      values = {
        ...rest,
        pipelineArtifactId: raw.pipelineArtifactId || undefined,
        deploymentArtifactId: raw.deploymentArtifactId || undefined,
        modelIds: [modelId],
        features,
        outputs: {
          semantics,
          classOrder: classOrder
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          threshold: threshold ? Number(threshold) : null,
        },
      };
    }

    if (form === "registerPrediction")
      values = {
        ...raw,
        producedAt: new Date(raw.producedAt + "Z").toISOString(),
      };

    if (form === "addAssertion")
      values = {
        ...values,
        missingEvidence: raw.missingEvidence ?? "",
        procedureId: raw.procedureId || undefined,
        paperId: raw.paperId || undefined,
        relations: relations.filter((r) => r.locationId),
      };

    if (form === "addLocation")
      values = { ...raw, parser: "manual-transcription" };

    if (form === "queueExternal")
      values = {
        ...values,
        ...(preset.datasetCardRecordId
          ? { datasetCardRecordId: preset.datasetCardRecordId }
          : {}),
      };

    if (form === "sample")
      values = {
        ...raw,
        procedureId: raw.procedureId || undefined,
        size: Number(raw.size),
        seed: Number(raw.seed),
        exclusions: exclusions.filter((x) => x.recordId || x.reason),
      };

    if (form === "impact") values = { ...raw, affectedIds };

    if (form === "setAccess")
      values = { ...raw, active: raw.active === "true" };

    if (form === "enrollWorker")
      values = {
        ...raw,
        formats: [...new FormData(ev.currentTarget).getAll("formats")],
      };

    if (revision) values.supersedesId = revision.id;

    try {
      const result = await act(form, values);
      if (result.token)
        setToken({ workerId: result.workerId, token: result.token });
      if (result.packet) {
        for (const [name, value] of [
          ["authorized-source-packet.json", result.packet],
          ["exporter-trust.json", result.trust],
        ]) {
          const url = URL.createObjectURL(
              new Blob([JSON.stringify(value, null, 2)], {
                type: "application/json",
              }),
            ),
            a = document.createElement("a");
          a.href = url;
          a.download = String(name);
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
      if (result.record) {
        setDetailSection("overview");
        onLocation({ ...location, recordId: result.record.id });
      }
      setDirty(false);
      setForm("");
    } catch {}
  }

  const person = (id: string) =>
    id === data.identity.id
      ? data.identity.name
      : (data.people.find((p) => p.user_id === id)?.display_name ??
        "Practice member");

  const clearFilters = () =>
    onLocation({ ...location, search: "", review: "all" });
  const selectSection = (section: string) =>
    onLocation({ section, search: "", review: "all", recordId: "" });
  const setSelected = (
    record: AssuranceRecord | null,
    section: "overview" | "review" = "overview",
  ) => {
    if (busy || (dirty && !window.confirm("Discard unsaved review?"))) return;
    setDirty(false);
    setError("");
    setDetailSection(section);
    onLocation({ ...location, recordId: record?.id ?? "" });
  };
  const list = (
    rows: AssuranceRecord[],
    empty: string,
    emptyAction?: ReactNode,
  ) => {
    const filteredRows = selectWorkbenchRecords(
      rows,
      all,
      query,
      reviewFilter,
      recordTitle,
      person,
    );
    return (
      <AssuranceRegister
        rows={filteredRows}
        all={all}
        onOpen={(r) => setSelected(r)}
        empty={empty}
        filtered={rows.length > 0 && (!!query.trim() || reviewFilter !== "all")}
        person={person}
        onReset={clearFilters}
        emptyAction={emptyAction}
      />
    );
  };
  const nextAssessment =
    queue.reviewable[0] ??
    queue.revisable[0] ??
    queue.awaiting[0] ??
    queue.returned[0];
  const nextAction = queue.reviewable.length
    ? "Review next assessment"
    : queue.revisable.length
      ? "Revise returned assessment"
      : "View next assessment";
  const canLinkPredictions =
    kind("system").length > 0 &&
    models.length > 0 &&
    artifactOptions("Dataset").length > 0;
  const openLinkedSource = (action: () => void) => {
    if (dirty || busy) return;
    setSelected(null);
    action();
  };

  const saveLabels: Record<string, string> = {
    registerSystem: "Register system",
    registerPrediction: "Link predictions",
    queueExternal: "Freeze execution request",
    addLocation: "Record source location",
    addAssertion: "Save assertion",
    sample: "Generate sample manifest",
    impact: "Save change assessment",
    enrollWorker: "Enroll runner",
    setAccess: "Save access decision",
    importPacket: "Import packet",
    obligationDecision: "Save obligation assessment",
    exportBriefing: "Export selected sources",
    importBriefing: "Import cited draft",
    cancelJob: "Cancel execution",
    revokeWorker: "Revoke runner",
  };

  const formGroups: Record<string, { title: string; names: string[] }[]> = {
    registerSystem: [
      {
        title: "System identity & purpose",
        names: ["name", "version", "modelId", "intendedUse", "population"],
      },
      {
        title: "Input contract",
        names: ["pipelineArtifactId", "deploymentArtifactId"],
      },
      {
        title: "Outputs & decisions",
        names: ["semantics", "classOrder", "threshold"],
      },
      {
        title: "Human oversight & runtime",
        names: ["humanDecision", "runtime", "limitations"],
      },
    ],

    registerPrediction: [
      {
        title: "System & source evidence",
        names: ["systemId", "modelId", "datasetId", "sourceDatasetId"],
      },
      {
        title: "Prediction origin",
        names: ["mode", "producedAt", "producingRun", "inferenceConfiguration"],
      },
      { title: "Verification limits", names: ["limitations"] },
    ],

    queueExternal: [
      {
        title: "Approved audit context",
        names: ["systemId", "procedureId", "modelId", "datasetId", "profileId"],
      },
      {
        title: "Execution method",
        names: ["mode", "predictionId", "securityReviewId"],
      },
      {
        title: "Output configuration",
        names: ["negativeLabel", "predictionOutput", "predictionKind"],
      },
    ],

    addAssertion: [
      {
        title: "Claim & audit criterion",
        names: ["criterion", "statement", "procedureId", "paperId"],
      },
      {
        title: "Auditor assessment",
        names: ["missingEvidence", "assessment", "conclusion"],
      },
    ],

    obligationDecision: [
      {
        title: "Scope & applicability",
        names: [
          "code",
          "actor",
          "applicability",
          "rationale",
          "periodAnalysis",
        ],
      },
      {
        title: "Evidence & assessment",
        names: ["evidenceId", "assessment", "outcome"],
      },
    ],

    impact: [
      {
        title: "Changed source",
        names: ["sourceType", "previousId", "newId", "description"],
      },
      {
        title: "Impact & proposed action",
        names: ["assessment", "decision", "reason"],
      },
    ],
  };

  const visibleField = (f: Field) =>
    form !== "queueExternal" ||
    (f.name === "predictionId"
      ? executionMode !== "auditor_model"
      : ["securityReviewId", "predictionOutput", "predictionKind"].includes(
            f.name,
          )
        ? executionMode === "auditor_model"
        : true);

  function renderField(f: Field) {
    const value = revision?.body[f.name] ?? preset[f.name] ?? f.initial ?? "",
      required =
        f.required ||
        (form === "queueExternal" &&
          ["predictionId", "securityReviewId"].includes(f.name)),
      id = "assurance-field-" + f.name;

    return (
      <label
        className={
          "workbench-field " +
          (f.multiline ||
          [
            "modelId",
            "systemId",
            "procedureId",
            "profileId",
            "criterion",
            "code",
            "paperId",
          ].includes(f.name)
            ? "wide"
            : "")
        }
        key={f.name}
        htmlFor={id}
      >
        <span className="workbench-field-label">
          <span>{f.label}</span>
          {!required && <span className="field-optional">Optional</span>}
        </span>
        {f.options ? (
          <select
            id={id}
            aria-label={f.label}
            aria-describedby={f.help ? id + "-help" : undefined}
            name={f.name}
            required={required}
            defaultValue={value}
            onChange={
              form === "queueExternal" && f.name === "mode"
                ? (ev) => setExecutionMode(ev.target.value)
                : undefined
            }
          >
            <option value="">Choose…</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : f.multiline ? (
          <Textarea
            id={id}
            aria-label={f.label}
            aria-describedby={f.help ? id + "-help" : undefined}
            name={f.name}
            required={required}
            defaultValue={value}
          />
        ) : (
          <Input
            id={id}
            aria-label={f.label}
            aria-describedby={f.help ? id + "-help" : undefined}
            name={f.name}
            type={f.type ?? "text"}
            required={required}
            defaultValue={value}
            step={f.type === "number" ? "any" : undefined}
          />
        )}{" "}
        {f.help && <small id={id + "-help"}>{f.help}</small>}
      </label>
    );
  }

  return (
    <div className="assurance-workbench">
      <div className="workbench-bar">
        <label className="workbench-section-picker">
          Workbench section
          <select value={tab} onChange={(ev) => selectSection(ev.target.value)}>
            {workbenchSections.map(([value, title]) => (
              <option key={value} value={value}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <Tabs value={tab} onValueChange={selectSection}>
          <TabsList aria-label="Assurance workbench sections">
            {workbenchSections.map(([value, title]) => (
              <TabsTrigger key={value} value={value}>
                {title}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || refreshing}
          aria-label="Refresh workbench"
          onClick={() => void load()}
        >
          <RefreshCw
            size={15}
            aria-hidden="true"
            className={refreshing ? "animate-spin" : ""}
          />
        </Button>
      </div>
      {snapshot && (queue.awaiting.length > 0 || queue.returned.length > 0) && (
        <section
          className="workbench-review-queue"
          aria-label="Assessment review queue"
        >
          <div className="workbench-queue-head">
            <h2>Assessment review</h2>
            {queue.canReview && (
              <span className="subtle">
                {queue.reviewable.length} available for your independent review
              </span>
            )}
          </div>
          <div className="workbench-queue-counts">
            {queue.awaiting.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    queue.reviewable[0] ?? queue.awaiting[0],
                    queue.reviewable.length ? "review" : "overview",
                  )
                }
              >
                <b>{queue.awaiting.length}</b>
                <span>Awaiting review</span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            )}
            {queue.returned.length > 0 && (
              <button
                type="button"
                onClick={() => setSelected(queue.returned[0], "review")}
              >
                <b>{queue.returned.length}</b>
                <span>Returned for revision</span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          {nextAssessment && (
            <button
              type="button"
              className="workbench-next-review"
              onClick={() => setSelected(nextAssessment, "review")}
            >
              <span>
                <small>{nextAction}</small>
                <b>{recordTitle(nextAssessment)}</b>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
        </section>
      )}
      {(loadError || error) && (
        <div className="workbench-load-error" role="alert">
          <p>{loadError || error}</p>
          {!form && !selected && (
            <Button
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => void load()}
            >
              Retry loading records
            </Button>
          )}
          {snapshot && loadError && !form && !selected && (
            <small>Showing the last loaded records.</small>
          )}
        </div>
      )}
      {!snapshot && refreshing && (
        <div className="workbench-load-state" role="status">
          <RefreshCw size={18} className="animate-spin" aria-hidden="true" />
          <p>Loading assurance records…</p>
        </div>
      )}
      {snapshot && !loadError && location.recordId && !selected && (
        <div className="workbench-load-error" role="alert">
          <p>This assurance record is unavailable in this engagement.</p>
          <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
            Back to records
          </Button>
        </div>
      )}
      {snapshot && !["execution", "access"].includes(tab) && (
        <div className="assurance-filters">
          <div className="search-field">
            <Search size={15} aria-hidden="true" />
            <Input
              name="assurance-search"
              autoComplete="off"
              aria-label="Search assurance records"
              placeholder="Search records, references or people…"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
            />
          </div>
          {["evidence", "impact"].includes(tab) && (
            <select
              aria-label="Filter by review status"
              value={reviewFilter}
              onChange={(ev) => setReviewFilter(ev.target.value)}
            >
              {workbenchReviewStates.map((value) => (
                <option value={value} key={value}>
                  {value === "all"
                    ? "All review states"
                    : value === "Returned"
                      ? "Returned for revision"
                      : value}
                </option>
              ))}
            </select>
          )}
          {(query || reviewFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear record filters"
              onClick={clearFilters}
            >
              <X size={14} aria-hidden="true" />
              Clear
            </Button>
          )}
        </div>
      )}
      {snapshot && (
        <div className="workbench-section-content" aria-busy={refreshing}>
          {tab === "systems" && (
            <>
              <div className="section-toolbar">
                <div>
                  <h2>Test the complete system</h2>
                  <p className="subtle">
                    Version the pipeline, inputs, outputs and human decision
                    process together.
                  </p>
                </div>
                {writer && (
                  <Button
                    disabled={!models.length}
                    onClick={() => open("registerSystem")}
                  >
                    <Plus size={15} />
                    Register system
                  </Button>
                )}
              </div>
              {writer && !models.length && (
                <div className="workbench-notice">
                  <div>
                    <b>Register a model first</b>
                    <p>
                      A system revision needs a model version and its supporting
                      artifact.
                    </p>
                    <Button
                      variant="ghost"
                      onClick={() => onNavigate("Testing lab")}
                    >
                      Open model registry
                    </Button>
                  </div>
                </div>
              )}
              {list(
                kind("system"),
                "Register a system to define its inputs, outputs and decision process.",
              )}
              <div className="section-toolbar">
                <h2>Prediction lineage</h2>
                {writer && (
                  <Button
                    variant="outline"
                    disabled={!canLinkPredictions}
                    onClick={() => open("registerPrediction")}
                  >
                    Link predictions
                  </Button>
                )}
              </div>
              {list(
                kind("prediction"),
                canLinkPredictions
                  ? "No prediction lineage recorded"
                  : "Linking predictions requires a system revision, model version and accepted dataset.",
                writer && !artifactOptions("Dataset").length ? (
                  <button
                    type="button"
                    onClick={() => onNavigate("Evidence vault")}
                  >
                    Open evidence vault
                  </button>
                ) : undefined,
              )}
              <div className="section-toolbar">
                <h2>Registry snapshots</h2>
                {writer && (
                  <Button
                    variant="outline"
                    onClick={() => open("importPacket")}
                  >
                    Import MLflow / Hub snapshot
                  </Button>
                )}
              </div>
              {list(kind("registry"), "No registry snapshots imported")}
            </>
          )}

          {tab === "execution" && (
            <>
              <ExecutionPlanner
                onNavigate={onNavigate}
                onSystems={() => selectSection("systems")}
                key={initialProcedure ?? "choose"}
                engagement={e}
                role={data.identity.role}
                records={all}
                workers={snapshot?.workers ?? []}
                onPlan={(v) => {
                  const { mode, ...values } = v;
                  open("queueExternal", null, { ...values, mode });
                  setExecutionMode(mode);
                }}
                onHosted={onHosted}
                initialProcedure={initialProcedure}
              />
              <div className="section-toolbar">
                <h2>Execution requests</h2>
                <span className="subtle">
                  {snapshot?.telemetry.queued ?? 0} queued ·{" "}
                  {snapshot?.telemetry.stalled ?? 0} expired leases
                </span>
              </div>
              <div className="assurance-register">
                {snapshot?.jobs.map((j) => (
                  <div className="execution-row" key={j.id}>
                    <div>
                      <b>{j.system_name}</b>
                      <small className="block subtle">
                        {label(j.mode)} · attempt {j.fence} ·{" "}
                        {new Date(j.created_at).toLocaleString()}
                      </small>
                      {j.error && <p className="form-error">{j.error}</p>}
                    </div>
                    <span
                      className={
                        "badge " +
                        (j.state === "succeeded"
                          ? "green"
                          : j.state === "failed"
                            ? "red"
                            : "neutral")
                      }
                    >
                      {label(j.state)}
                    </span>
                    <div className="row-actions">
                      {writer && ["queued", "running"].includes(j.state) && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            open("cancelJob", null, { jobId: j.id })
                          }
                        >
                          Cancel
                        </Button>
                      )}
                      {writer &&
                        j.state === "succeeded" &&
                        !kind("execution_compilation").some(
                          (r) => r.body.jobId === j.id,
                        ) && (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void act("importJob", { jobId: j.id })
                                .then((result) => {
                                  if (result.record?.body.paperId)
                                    onPaper(result.record.body.paperId);
                                })
                                .catch(() => {})
                            }
                          >
                            <FileCheck2 size={15} />
                            Compile draft paper
                          </Button>
                        )}
                    </div>
                  </div>
                ))}
              </div>
              {!snapshot?.jobs.length && (
                <p className="empty-result">No external execution requests.</p>
              )}
            </>
          )}

          {tab === "evidence" && (
            <>
              <div className="section-toolbar">
                <div>
                  <h2>Claims and precise sources</h2>
                  <p className="subtle">
                    Keep source observations, contradictions and auditor
                    judgment distinct.
                  </p>
                </div>
                {writer && (
                  <div className="row-actions">
                    <Button
                      variant="outline"
                      disabled={!artifacts.length}
                      onClick={() => open("addLocation")}
                    >
                      <Link2 size={15} />
                      Locate evidence
                    </Button>
                    <Button onClick={() => open("addAssertion")}>
                      Record assertion
                    </Button>
                  </div>
                )}
              </div>
              {list(kind("assertion"), "No assertions recorded")}
              <h2 className="workbench-subhead">Source locations</h2>
              {list(
                kind("location"),
                artifacts.length
                  ? "No source locations recorded"
                  : "Accept source evidence in the vault before locating it.",
                writer && !artifacts.length ? (
                  <button
                    type="button"
                    onClick={() => onNavigate("Evidence vault")}
                  >
                    Open evidence vault
                  </button>
                ) : undefined,
              )}
            </>
          )}

          {tab === "sampling" && (
            <>
              <div className="section-toolbar">
                <div>
                  <h2>Population, sampling and operation</h2>
                  <p className="subtle">
                    Reconcile completeness before interpreting a sample or
                    statistical result.
                  </p>
                </div>
                {writer && (
                  <div className="row-actions">
                    <Button
                      variant="outline"
                      onClick={() => open("importPacket")}
                    >
                      Import collection / statistics
                    </Button>
                    <Button
                      disabled={!artifactOptions("Dataset").length}
                      onClick={() => open("sample")}
                    >
                      Select sample
                    </Button>
                  </div>
                )}
              </div>
              {list(
                all.filter((r) =>
                  ["sample", "operational", "statistics"].includes(r.kind),
                ),
                "No reproducible samples or collection packets yet",
              )}
              <details className="help-panel">
                <summary>External tools and assumptions</summary>
                <p>
                  The portable engine supports read-only operational JSONL
                  reconciliation, replay comparison against independently
                  obtained outputs, entity/split leakage checks, intersectional
                  slices, IID and clustered bootstrap. It records missing
                  events, duplicates and limitations. Import permitted aggregate
                  packets after assessing their origin.
                </p>
                <p>
                  Interactive sampling supports 1 MB and 10,000 rows. Stratified
                  sample size is requested per stratum; selection does not
                  establish representativeness. Larger populations use the
                  portable assurance CLI.
                </p>
              </details>
            </>
          )}

          {tab === "assistant" && (
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
                <span>
                  {
                    sourceIds.filter((id) =>
                      all.some(
                        (r) =>
                          r.id === id &&
                          ["location", "assertion"].includes(r.kind),
                      ),
                    ).length
                  }{" "}
                  of 30 sources selected
                </span>
                {sourceIds.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSourceIds([])}
                  >
                    Clear selection
                  </Button>
                )}
              </div>
              <div className="briefing-sources">
                {all
                  .filter((r) => ["location", "assertion"].includes(r.kind))
                  .map((r) => (
                    <label className="check-row" key={r.id}>
                      <input
                        type="checkbox"
                        checked={sourceIds.includes(r.id)}
                        disabled={
                          busy ||
                          (!sourceIds.includes(r.id) && sourceIds.length >= 30)
                        }
                        onChange={(ev) =>
                          setSourceIds(
                            ev.target.checked
                              ? [...sourceIds, r.id]
                              : sourceIds.filter((x) => x !== r.id),
                          )
                        }
                      />
                      <span>
                        {r.body.label ?? r.body.statement}
                        <small className="block subtle">
                          {r.body.locator ?? r.body.criterion}
                        </small>
                      </span>
                    </label>
                  ))}
              </div>
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
                        .then((v) => setSelected(v.record))
                        .catch(() => {})
                    }
                  >
                    {title}
                  </Button>
                ))}
              </div>
              {list(
                kind("assistant"),
                "No evidence briefings prepared yet",
                !all.some((r) => ["location", "assertion"].includes(r.kind)) ? (
                  <button
                    type="button"
                    onClick={() => selectSection("evidence")}
                  >
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
                        !sourceIds.some((id) =>
                          kind("location").some((r) => r.id === id),
                        )
                      }
                      onClick={() => open("exportBriefing")}
                    >
                      Export selected locations
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => open("importBriefing")}
                    >
                      Import cited model draft
                    </Button>
                  </div>
                )}
                <p>
                  The available assistant uses deterministic extraction and
                  recorded relationships. Client content is data; embedded
                  instructions do not execute. It preserves exact citations and
                  does not review, sign or release work. The optional portable
                  model service requires an approved destination and provider
                  credentials. Exported source packets are scoped, expiring and
                  signed; returned drafts are checked against their exact pins.
                </p>
              </details>
            </>
          )}

          {tab === "impact" && (
            <>
              <div className="section-toolbar">
                <div>
                  <h2>Change impact</h2>
                  <p className="subtle">
                    Keep historical decisions fixed and open targeted review for
                    changed dependencies.
                  </p>
                </div>
                {writer && (
                  <div className="row-actions">
                    <Button
                      variant="outline"
                      onClick={() => open("obligationDecision")}
                    >
                      Assess obligation
                    </Button>
                    <Button onClick={() => open("impact")}>
                      Assess change
                    </Button>
                  </div>
                )}
              </div>
              {list(kind("impact"), "No change assessments recorded")}
              <h2 className="workbench-subhead">Obligation assessments</h2>
              {list(kind("obligation"), "No subitem assessments recorded")}
              <details className="help-panel">
                <summary>
                  Obligation subitems · {obligations.items.length} review
                  prompts
                </summary>
                <p>{obligations.scope}</p>
                <p>{obligations.decisionPolicy.providerResponsibility}</p>
                <a
                  className="source-link"
                  href={obligations.source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Reviewed legal source · {obligations.source.version}
                </a>
                <div className="obligation-list">
                  {obligations.items.map((o) => (
                    <div key={o.code}>
                      <b>
                        {o.article} · {o.title}
                      </b>
                      <small className="block subtle">
                        {o.actor.join(", ")} · {o.code} ·{" "}
                        {o.evidenceCategories.join(", ")}
                      </small>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}

          {tab === "access" && (
            <>
              <div className="section-toolbar">
                <div>
                  <h2>Engagement team</h2>
                  <p className="subtle">
                    Practice membership and engagement access are separate
                    permissions.
                  </p>
                </div>
                {lead && (
                  <Button onClick={() => open("setAccess")}>
                    Manage access
                  </Button>
                )}
              </div>
              <div className="assurance-register">
                {snapshot?.access.map((a) => (
                  <div className="execution-row" key={a.user_id}>
                    <div>
                      <b>{a.display_name}</b>
                      <small className="block subtle">{a.role}</small>
                    </div>
                    <span
                      className={
                        "badge " +
                        (a.active && a.status === "active"
                          ? "green"
                          : "neutral")
                      }
                    >
                      {a.active && a.status === "active"
                        ? "Granted"
                        : "Revoked"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="section-toolbar">
                <h2>Runner connections</h2>
                {lead && (
                  <Button
                    variant="outline"
                    onClick={() => open("enrollWorker")}
                  >
                    Enroll runner
                  </Button>
                )}
              </div>
              {snapshot?.workers.map((w) => (
                <div key={w.id} className="execution-row">
                  <div>
                    <b>{w.name}</b>
                    <small className="block subtle">
                      {w.last_seen
                        ? "Last attempt connection " +
                          new Date(w.last_seen).toLocaleString()
                        : "Awaiting first connection"}{" "}
                      · {JSON.parse(w.capabilities).join(", ")}
                    </small>
                    <details>
                      <summary className="subtle">Image pin</summary>
                      <code>{w.image_digest}</code>
                    </details>
                  </div>
                  <span className="badge neutral">
                    {w.active ? "Enrolled" : "Revoked"}
                  </span>
                  {lead && !!w.active && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        open("revokeWorker", null, { workerId: w.id })
                      }
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
              <div className="row-actions">
                <a
                  className="download-link"
                  href="/tools/assurance-runtime.zip"
                >
                  Download portable runtime &amp; operator guides
                </a>
                <a
                  className="download-link"
                  href="/tools/assurance-verifier.py"
                >
                  Download standalone verifier
                </a>
              </div>
              <details className="help-panel">
                <summary>Deployment and verification readiness</summary>
                {Object.entries(snapshot?.capabilities ?? {}).map(([k, v]) => (
                  <p key={k}>
                    <b>{label(k)}:</b> {v}
                  </p>
                ))}
                <p>
                  Deploy the portable worker with a read-only isolated compute
                  container, an approved model-hash allowlist and separate
                  platform service credentials. Service enrollment authenticates
                  origin; it is not remote runtime attestation.
                </p>
              </details>
            </>
          )}
        </div>
      )}

      <Dialog
        open={!!form}
        onOpenChange={(v) => {
          if (
            !v &&
            !busy &&
            (!dirty || window.confirm("Discard unsaved setup?"))
          ) {
            setForm("");
            setDirty(false);
          }
        }}
      >
        <DialogContent className="audit-dialog workbench-dialog">
          <DialogHeader>
            <DialogTitle>{titles[form]}</DialogTitle>
            <DialogDescription>
              {form === "registerSystem"
                ? "Define the complete system around a registered model version."
                : form === "queueExternal"
                  ? "Pin an approved procedure and its inputs for reproducible external evaluation."
                  : form === "addAssertion"
                    ? "Record a claim, link precise sources, and explain your assessment."
                    : form === "cancelJob"
                      ? "Stop this execution and retain the cancellation reason in its history."
                      : form === "revokeWorker"
                        ? "Revoke this runner’s engagement access and record why."
                        : "Saved to this engagement with your name and a version history."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} onChange={() => setDirty(true)}>
            <fieldset disabled={busy}>
              {(
                formGroups[form] ?? [
                  { title: "", names: fields[form]?.map((f) => f.name) ?? [] },
                ]
              ).map((group) => (
                <section className="workbench-form-group" key={group.title}>
                  {group.title && <h3>{group.title}</h3>}
                  <div className="workbench-form-grid">
                    {fields[form]
                      ?.filter(
                        (f) => group.names.includes(f.name) && visibleField(f),
                      )
                      .map(renderField)}
                  </div>
                  {form === "registerSystem" &&
                    group.title === "Input contract" && (
                      <section className="feature-editor">
                        <h4>Ordered feature contract</h4>
                        {features.map((f, i) => (
                          <div className="feature-row" key={i}>
                            <Input
                              aria-label={"Feature " + (i + 1) + " name"}
                              placeholder="Column name"
                              required
                              value={f.name}
                              onChange={(ev) =>
                                setFeatures(
                                  features.map((x, j) =>
                                    j === i
                                      ? { ...x, name: ev.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <select
                              aria-label={"Feature " + (i + 1) + " type"}
                              value={f.type}
                              onChange={(ev) =>
                                setFeatures(
                                  features.map((x, j) =>
                                    j === i
                                      ? { ...x, type: ev.target.value }
                                      : x,
                                  ),
                                )
                              }
                            >
                              {[
                                "number",
                                "integer",
                                "category",
                                "text",
                                "boolean",
                              ].map((t) => (
                                <option key={t}>{t}</option>
                              ))}
                            </select>
                            <Input
                              aria-label={"Feature " + (i + 1) + " unit"}
                              placeholder="Units"
                              value={f.unit}
                              onChange={(ev) =>
                                setFeatures(
                                  features.map((x, j) =>
                                    j === i
                                      ? { ...x, unit: ev.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={features.length === 1}
                              onClick={() =>
                                setFeatures(features.filter((_, j) => j !== i))
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setFeatures([
                              ...features,
                              {
                                name: "",
                                type: "number",
                                unit: "",
                                nullable: false,
                                nullHandling: "reject",
                                categories: [],
                              },
                            ]);
                            setDirty(true);
                          }}
                        >
                          Add feature
                        </Button>
                        <p className="subtle">
                          This input contract rejects nulls. Portable native
                          adapters currently accept complete numeric
                          preprocessed columns; text and nullable pipelines
                          require validated adapters.
                        </p>
                      </section>
                    )}
                </section>
              ))}
              {revision && (
                <p className="workbench-notice">
                  Revises {revision.id}. The prior assessment and its review
                  remain in the audit history.
                </p>
              )}
              {form === "addAssertion" && (
                <section>
                  <h3>Source relationships</h3>
                  {relations.map((r, i) => (
                    <div className="record-item" key={i}>
                      <label className="workbench-field">
                        Precise source
                        <select
                          required
                          value={r.locationId}
                          onChange={(ev) =>
                            setRelations(
                              relations.map((x, j) =>
                                j === i
                                  ? { ...x, locationId: ev.target.value }
                                  : x,
                              ),
                            )
                          }
                        >
                          <option value="">Choose…</option>
                          {options("location").map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="workbench-field">
                        Relationship
                        <select
                          value={r.relation}
                          onChange={(ev) =>
                            setRelations(
                              relations.map((x, j) =>
                                j === i
                                  ? { ...x, relation: ev.target.value }
                                  : x,
                              ),
                            )
                          }
                        >
                          {["supports", "contradicts", "superseded"].map(
                            (v) => (
                              <option key={v}>{v}</option>
                            ),
                          )}
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
                                j === i
                                  ? { ...x, rationale: ev.target.value }
                                  : x,
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
                          setDirty(true);
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
                      setRelations([
                        ...relations,
                        { locationId: "", relation: "supports", rationale: "" },
                      ]);
                      setDirty(true);
                    }}
                  >
                    Add source relationship
                  </Button>
                </section>
              )}
              {form === "sample" && (
                <details>
                  <summary>Population exclusions</summary>
                  <p className="subtle">
                    Each exclusion must identify an actual unique record and
                    retain its reason.
                  </p>
                  {exclusions.map((x, i) => (
                    <div className="feature-row" key={i}>
                      <Input
                        aria-label="Excluded record ID"
                        placeholder="Record ID"
                        value={x.recordId}
                        onChange={(ev) =>
                          setExclusions(
                            exclusions.map((r, j) =>
                              i === j ? { ...r, recordId: ev.target.value } : r,
                            ),
                          )
                        }
                      />
                      <Input
                        aria-label="Exclusion reason"
                        placeholder="Reason"
                        value={x.reason}
                        onChange={(ev) =>
                          setExclusions(
                            exclusions.map((r, j) =>
                              i === j ? { ...r, reason: ev.target.value } : r,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setExclusions([
                        ...exclusions,
                        { recordId: "", reason: "" },
                      ]);
                      setDirty(true);
                    }}
                  >
                    Add exclusion
                  </Button>
                </details>
              )}
              {form === "impact" && (
                <section>
                  <h3>Affected assurance records</h3>
                  {all
                    .filter((r) =>
                      [
                        "system",
                        "assertion",
                        "obligation",
                        "location",
                      ].includes(r.kind),
                    )
                    .map((r) => (
                      <label key={r.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={affectedIds.includes(r.id)}
                          onChange={(ev) =>
                            setAffectedIds(
                              ev.target.checked
                                ? [...affectedIds, r.id]
                                : affectedIds.filter((x) => x !== r.id),
                            )
                          }
                        />
                        {r.body.name ??
                          r.body.statement ??
                          r.body.label ??
                          r.body.code}
                      </label>
                    ))}
                </section>
              )}
              {form === "enrollWorker" && (
                <section>
                  <h3>Approved adapter scope</h3>
                  {[
                    "provided_predictions",
                    "ONNX",
                    "XGBoost",
                    "LightGBM",
                    "PMML",
                  ].map((f) => (
                    <label className="check-row" key={f}>
                      <input
                        type="checkbox"
                        name="formats"
                        value={f}
                        defaultChecked={f === "provided_predictions"}
                      />
                      {label(f)}
                    </label>
                  ))}
                </section>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="ml-footer">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (!dirty || window.confirm("Discard unsaved setup?")) {
                      setForm("");
                      setDirty(false);
                    }
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {busy ? "Saving…" : (saveLabels[form] ?? "Save assessment")}
                </Button>
              </div>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        <DialogContent className="audit-dialog workbench-dialog">
          <DialogHeader>
            <DialogTitle>
              {selected ? recordTitle(selected) : "Assurance record"}
            </DialogTitle>
            <DialogDescription>
              Saved assessment and source history
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <AssuranceRecordDetails
              key={selected.id}
              record={selected}
              records={all}
              engagement={e}
              person={person}
              initialSection={detailSection}
              linksDisabled={dirty || busy}
              onRecord={(r) => setSelected(r)}
              onPaper={(id) => openLinkedSource(() => onPaper(id))}
              onEvidence={(id) => openLinkedSource(() => onEvidence(id))}
              review={
                <fieldset disabled={busy}>
                  {dirty && (
                    <p className="subtle">
                      Save your review or close this record before opening
                      linked evidence.
                    </p>
                  )}
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  {["assertion", "impact", "obligation"].includes(
                    selected.kind,
                  ) && (
                    <>
                      <h3>Independent review</h3>
                      {!all.some(
                        (r) =>
                          r.kind === selected.kind + "_review" &&
                          (r.body.assertionId ??
                            r.body.impactId ??
                            r.body.obligationId) === selected.id,
                      ) && (
                        <p className="subtle">
                          No independent review has been recorded.
                        </p>
                      )}
                      {all
                        .filter(
                          (r) =>
                            r.kind === selected.kind + "_review" &&
                            (r.body.assertionId ??
                              r.body.impactId ??
                              r.body.obligationId) === selected.id,
                        )
                        .map((r) => (
                          <div className="record-item" key={r.id}>
                            <b>{label(r.body.decision)}</b>
                            <p>{r.body.reason}</p>
                            <small className="subtle">
                              {person(r.actor)} ·{" "}
                              {new Date(r.createdAt).toLocaleString()}
                            </small>
                          </div>
                        ))}
                      {all.some((r) => r.body.supersedesId === selected.id) ? (
                        <p className="subtle">
                          A successor revision replaces this assessment for
                          current review gates.
                        </p>
                      ) : (
                        <>
                          {writer && (
                            <Button
                              variant="outline"
                              onClick={() => {
                                if (
                                  dirty &&
                                  !window.confirm("Discard unsaved review?")
                                )
                                  return;
                                onLocation({ ...location, recordId: "" });
                                open(
                                  selected.kind === "assertion"
                                    ? "addAssertion"
                                    : selected.kind === "obligation"
                                      ? "obligationDecision"
                                      : "impact",
                                  selected,
                                );
                              }}
                            >
                              Create successor revision
                            </Button>
                          )}
                          {reviewer && selected.actor !== data.identity.id && (
                            <form
                              onSubmit={(ev) => {
                                ev.preventDefault();
                                const v = Object.fromEntries(
                                    new FormData(ev.currentTarget),
                                  ),
                                  k = selected.kind;
                                void act(
                                  k === "assertion"
                                    ? "reviewAssertion"
                                    : k === "impact"
                                      ? "reviewImpact"
                                      : "reviewObligation",
                                  { [k + "Id"]: selected.id, ...v },
                                )
                                  .then(() => {
                                    setDirty(false);
                                    onLocation({ ...location, recordId: "" });
                                  })
                                  .catch(() => {});
                              }}
                              onChange={() => setDirty(true)}
                            >
                              <label className="workbench-field">
                                Independent decision
                                <select
                                  name="decision"
                                  aria-label="Independent decision"
                                  required
                                >
                                  <option value="">Choose…</option>
                                  <option
                                    value={
                                      selected.kind === "assertion"
                                        ? "approve"
                                        : "confirmed"
                                    }
                                  >
                                    Confirm assessment
                                  </option>
                                  <option
                                    value={
                                      selected.kind === "assertion"
                                        ? "return"
                                        : "returned"
                                    }
                                  >
                                    Return for revision
                                  </option>
                                </select>
                              </label>
                              <label className="workbench-field">
                                Review reasoning
                                <Textarea
                                  name="reason"
                                  aria-label="Review reasoning"
                                  required
                                  placeholder="Explain source sufficiency, contradictions and the basis for your decision."
                                />
                              </label>
                              <Button type="submit" disabled={busy}>
                                {busy
                                  ? "Recording review…"
                                  : "Record independent review"}
                              </Button>
                            </form>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {selected.kind === "assistant" && writer && (
                    <form
                      onChange={() => setDirty(true)}
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        const v = Object.fromEntries(
                          new FormData(ev.currentTarget),
                        );
                        void act("acceptAssistant", {
                          assistantId: selected.id,
                          ...v,
                        })
                          .then(() => {
                            setDirty(false);
                            onLocation({ ...location, recordId: "" });
                          })
                          .catch(() => {});
                      }}
                    >
                      <label className="workbench-field">
                        Auditor-edited draft
                        <Textarea
                          name="editedText"
                          required
                          defaultValue={(selected.body.items ?? [])
                            .map((i: any) => i.text)
                            .join("\n\n")}
                        />
                      </label>
                      <label className="workbench-field">
                        Supplementary draft paper
                        <select name="paperId" required>
                          <option value="">Choose…</option>
                          {e.papers
                            .filter(
                              (p) =>
                                p.status === "draft" &&
                                !e.workflow?.procedures.some(
                                  (q) => q.paperId === p.id,
                                ),
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.templateId} · {p.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <Button disabled={busy} type="submit">
                        Adopt edited draft
                      </Button>
                    </form>
                  )}
                </fieldset>
              }
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!token}
        onOpenChange={(v) => {
          if (!v) setToken(null);
        }}
      >
        <DialogContent className="audit-dialog">
          <DialogHeader>
            <DialogTitle>Runner credential</DialogTitle>
            <DialogDescription>
              This scoped credential is shown once. Store it outside source and
              browser storage.
            </DialogDescription>
          </DialogHeader>
          <p>Worker: {token?.workerId}</p>
          <Input
            aria-label="Runner token"
            readOnly
            type="password"
            value={token?.token ?? ""}
          />
          <Button
            onClick={() =>
              void navigator.clipboard.writeText(token?.token ?? "")
            }
          >
            <Copy size={15} />
            Copy credential
          </Button>
          <p className="subtle">
            Set ASSURANCE_WORKER_TOKEN on the service. Private Site dispatch
            access uses a separately provisioned platform credential. No service
            has been launched by enrollment.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
