"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Play,
  ArrowLeft,
  ArrowRight,
  Download,
  FileCheck2,
  FlaskConical,
  Layers3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { assuranceRecords } from "@/lib/assurance-store-client";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { datasetCardFor } from "@/lib/dataset-card";
import {
  tasks,
  tests,
  fairnessSelected,
  protocolConfigKeys,
} from "@/lib/evaluation";
import type {
  Engagement,
  Model,
  ModelCard,
  EvaluationConfig,
  EvaluationProfile,
  Paper,
  Role,
  Run,
} from "@/lib/domain";
import { legacyConfig } from "@/lib/domain";
import {
  defaultPlanForm,
  describePlan,
  formFromPlan,
  planFromForm,
  validateHostedPlan,
  type PlanForm,
} from "@/lib/hosted-statistics";
import { planSha256, type Plan } from "@/lib/statistics";
import { PowerCheck, powerShortfalls } from "./power-check";
import { RunDetails } from "./record-details";
import { DatasetRegistry } from "./dataset-registry";
import {
  ClientDatasetPins,
  declarationFor,
  ProtocolDeclaration,
  SpecialCategoryRegister,
} from "./special-category";
import {
  basisFor,
  specialCategoryGroupFloor,
  type SpecialCategoryDeclarationInput,
} from "@/lib/special-category";
import {
  resolveLabIntent,
  type PendingLabIntent,
} from "./workspace/lab-intent";
import type { AssuranceRecord } from "@/lib/assurance-core";
type Props = {
  /** Work handed to the lab; it opens with it once. */
  intent: PendingLabIntent | null;
  /** The lab has applied `intent` and must not reopen with it. */
  onIntentUsed: (intent: PendingLabIntent) => void;
  onRefresh: () => Promise<unknown>;
  engagement: Engagement;
  tenantId: string;
  role: Role;
  busy: boolean;
  view: string;
  onView: (view: string) => void;
  /** The lab's own model and evaluation setup dialogs report here. */
  onEditorOpen: (open: boolean) => void;
  /** The dataset registry's card form reports here, separately. */
  onDatasetEditing: (open: boolean) => void;
  /** The special-category basis form reports here, separately. */
  onBasisEditing: (open: boolean) => void;
  onEvidence: () => void;
  onPaper: (p: Paper) => void;
  resolve: (id: string) => string;
  act: (
    op: string,
    data: Record<string, unknown>,
    override?: Engagement,
  ) => Promise<{
    engagement: Engagement;
    details?: Record<string, string>;
  }>;
};
type Inspection = {
  artifactId: string;
  sha256: string;
  rowCount: number;
  columns: {
    name: string;
    type: string;
    missing: number;
    uniqueCount: number;
  }[];
};
/** The protocol form: legacy-style threshold fields plus the plan options; saving pre-registers a plan (schemaVersion 1.1). */
type Draft = Omit<
  EvaluationProfile,
  "id" | "schemaVersion" | "createdAt" | "createdBy" | "config" | "statistics"
> & { config: EvaluationConfig; plan: PlanForm };
const initialConfig: EvaluationConfig = {
  labelColumn: "",
  predictionColumn: "",
  groupColumn: "",
  positiveLabel: "1",
  negativeLabel: "0",
  performancePositiveLabel: "",
  // The statistics 1.0.0 floors (section 7): a plan may raise them, never lower them.
  minimumSampleSize: 30,
  minimumClassCount: 10,
  // A fairness group column is special-category data unless declared
  // otherwise, and such protocols need at least this many rows (#134).
  minimumGroupSize: specialCategoryGroupFloor,
  maximumParityGap: 0.1,
  maximumOddsGap: 0.1,
  minimumImpactRatio: 0.8,
  minimumAccuracy: 0.8,
  minimumRecall: 0.7,
  minimumMacroF1: 0.7,
  maximumRmse: 1,
};
/** A form for a saved protocol: a revision starts from its plan, or from a legacy protocol's thresholds raised to the floors. */
const profileDraft = (p: EvaluationProfile): Draft => {
  const legacy = legacyConfig(p.config);
  const base = {
    name: p.name,
    version: p.version,
    task: p.task,
    suite: [...p.suite],
    datasetContext: { ...p.datasetContext },
    rationale: p.rationale,
  };
  if (legacy || !p.statistics)
    return {
      ...base,
      config: {
        ...initialConfig,
        ...p.config,
        minimumSampleSize: Math.max(30, legacy?.minimumSampleSize ?? 20),
        minimumClassCount: Math.max(10, legacy?.minimumClassCount ?? 5),
        minimumGroupSize: Math.max(30, legacy?.minimumGroupSize ?? 30),
      },
      plan: { ...defaultPlanForm, powerAssumptions: {} },
    };
  const { thresholds, form } = formFromPlan(p.statistics);
  return {
    ...base,
    config: { ...initialConfig, ...p.config, ...thresholds },
    plan: form,
  };
};
/** The createEvaluationProfile request for a form: its mappings, labels and pre-registered plan. */
function profileRequest(d: Draft, classCount: number | null) {
  const c = d.config;
  return {
    name: d.name,
    version: d.version,
    task: d.task,
    suite: d.suite,
    config: {
      labelColumn: c.labelColumn,
      predictionColumn: c.predictionColumn,
      groupColumn: c.groupColumn,
      positiveLabel: c.positiveLabel,
      performancePositiveLabel: c.performancePositiveLabel ?? "",
      negativeLabel: c.negativeLabel ?? "",
    },
    statistics: planFromForm(d.task, d.suite, c, d.plan, classCount),
    datasetContext: d.datasetContext,
    rationale: d.rationale,
  };
}
/** The normalised plan a form pre-registers, or the reason it is not valid. */
function draftPlan(
  d: Draft,
  classCount: number | null,
): { plan: Plan; error: "" } | { plan: null; error: string } {
  try {
    return {
      plan: validateHostedPlan(
        d.task,
        planFromForm(d.task, d.suite, d.config, d.plan, classCount),
      ),
      error: "",
    };
  } catch (err) {
    return { plan: null, error: (err as Error).message };
  }
}
const emptyDraft = (task = "Binary classification"): Draft => ({
  name: "",
  version: "1.0",
  task,
  suite: [task === "Regression" ? "regression" : "performance"],
  config: { ...initialConfig },
  plan: { ...defaultPlanForm, powerAssumptions: {} },
  datasetContext: {
    split: "unknown",
    population: "",
    predictionProvenance: "",
    independence: "",
    sensitiveDataBasis: "",
  },
  rationale: "",
});
const emptyCard: ModelCard = {
  schemaVersion: "1.0",
  owner: "",
  framework: "",
  license: "",
  population: "",
  outOfScope: "",
  limitations: "",
  inputSchema: "",
  outputSemantics: "",
  preprocessing: "",
  source: { kind: "internal", repoId: "", revision: "", filename: "" },
};
function download(name: string, value: unknown, markdown = false) {
  const url = URL.createObjectURL(
      new Blob([markdown ? String(value) : JSON.stringify(value, null, 2)], {
        type: markdown ? "text/markdown" : "application/json",
      }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function State({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " +
        (["succeeded", "registered", "pass"].includes(value)
          ? "green"
          : ["failed", "fail"].includes(value)
            ? "red"
            : "neutral")
      }
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: React.ReactNode;
  help?: string;
}) {
  return (
    <label className="ml-field">
      <span>{label}</span>
      {children}
      {help && <small className="subtle">{help}</small>}
    </label>
  );
}
function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: {
    value: string;
    label: string;
  }[];
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
function modelCapability(m: Model) {
  return m.format === "Prediction file" &&
    m.status === "registered" &&
    m.task !== "Classical NLP"
    ? "Saved predictions ready"
    : m.task === "Classical NLP"
      ? "Define a classification task to evaluate predictions"
      : "External adapter required";
}
/** An evaluation set up for an approved procedure, with its dataset card. */
type ProcedureBinding = { procedureId: string; datasetCardRecordId: string };
export function TestingLab({
  intent,
  onIntentUsed,
  onRefresh,
  engagement: e,
  tenantId,
  role,
  busy,
  view,
  onView,
  onEditorOpen,
  onDatasetEditing,
  onBasisEditing,
  onEvidence,
  onPaper,
  resolve,
  act,
}: Props) {
  const writer = ["Auditor", "Lead Auditor"].includes(role),
    [register, setRegister] = useState<Partial<Model> | null>(null),
    [card, setCard] = useState<ModelCard>(structuredClone(emptyCard)),
    [selectedModel, setSelectedModel] = useState<Model | null>(null),
    [selectedRun, setSelectedRun] = useState<Run | null>(null),
    [selectedProtocol, setSelectedProtocol] =
      useState<EvaluationProfile | null>(null);
  const [wizard, setWizard] = useState(false),
    [step, setStep] = useState(0),
    [modelId, setModelId] = useState(""),
    [profileId, setProfileId] = useState(""),
    [draft, setDraft] = useState<Draft>(emptyDraft()),
    [inspect, setInspect] = useState<Inspection | null>(null),
    [inspecting, setInspecting] = useState(false),
    [error, setError] = useState(""),
    [saveOnly, setSaveOnly] = useState(false),
    [discard, setDiscard] = useState<null | "registration" | "wizard">(null),
    [touched, setTouched] = useState(false),
    // A new fairness protocol's special-category declaration (#60), and the
    // acknowledgement a hosted run on special-category data needs.
    [declaration, setDeclaration] = useState<SpecialCategoryDeclarationInput>(
      {},
    ),
    [acknowledged, setAcknowledged] = useState(false);
  const [cards, setCards] = useState<AssuranceRecord[]>([]),
    // Belongs to the open setup only: every other evaluation starts unbound.
    [binding, setBinding] = useState<ProcedureBinding | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void assuranceRecords(
      { tenantId, engagementId: e.id, kind: "dataset" },
      { signal: controller.signal },
    )
      .then(setCards)
      .catch(() => {});
    return () => controller.abort();
  }, [tenantId, e.id, e.version]);
  const model = e.models.find((m) => m.id === modelId),
    profiles = e.evaluationProfiles ?? [],
    locked = !!profileId;
  useEffect(() => {
    onEditorOpen(!!register || wizard);
  }, [register, wizard, onEditorOpen]);
  useEffect(() => () => onEditorOpen(false), [onEditorOpen]);
  function closeSetup(kind: "registration" | "wizard") {
    if (busy) return;
    if (touched) setDiscard(kind);
    else if (kind === "registration") setRegister(null);
    else setWizard(false);
  }
  function startWizard(
    m?: Model,
    p?: EvaluationProfile,
    only = false,
    bound: ProcedureBinding | null = null,
  ) {
    setBinding(bound);
    setTouched(false);
    const chosen =
      m ??
      e.models.find((m) => modelCapability(m) === "Saved predictions ready");
    setError("");
    setInspect(null);
    setModelId(chosen?.id ?? "");
    setProfileId(p?.id ?? "");
    setDraft(p ? profileDraft(p) : emptyDraft(chosen?.task));
    setDeclaration({});
    setAcknowledged(false);
    setStep(0);
    setSaveOnly(only);
    setWizard(true);
  }
  useEffect(() => {
    if (!intent) return;
    const action = resolveLabIntent(intent, e);
    if (action.kind === "evaluate")
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opens the setup a hand-off asks for, once
      startWizard(action.model, action.profile, false, {
        procedureId: action.procedureId,
        datasetCardRecordId: action.datasetCardRecordId,
      });
    else if (action.kind === "showRun") {
      onView("runs");
      setSelectedRun(action.run);
    }
    onIntentUsed(intent);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applies each hand-off once, when it arrives, not when the engagement refreshes
  }, [intent]);
  function startRegistration(m?: Model) {
    setTouched(false);
    setError("");
    setRegister(
      m
        ? { ...m, version: "", artifactId: "" }
        : {
            format: "Prediction file",
            task: "Binary classification",
            name: "",
            version: "1.0",
            intendedPurpose: "",
            artifactId: "",
          },
    );
    setCard(m?.card ? structuredClone(m.card) : structuredClone(emptyCard));
  }
  useEffect(() => {
    if (!wizard || !model) return;
    let active = true;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the previous inspection while the selected model's dataset is fetched
    setInspect(null);
    setInspecting(true);
    fetch(
      "/api/evaluation/dataset?" +
        new URLSearchParams({
          tenantId,
          engagementId: e.id,
          artifactId: model.artifactId,
        }),
      { signal: controller.signal },
    )
      .then(async (r) => {
        const value = (await r.json()) as Inspection & {
          error?: string;
        };
        if (!r.ok) throw Error(value.error ?? "Dataset inspection failed");
        return value as Inspection;
      })
      .then((value) => {
        if (active) {
          setInspect(value);
          if (!profileId)
            setDraft((d) => {
              const names = value.columns.map((c) => c.name),
                pick = (choices: string[]) =>
                  choices.find((c) => names.includes(c)) ?? "";
              return {
                ...d,
                config: {
                  ...d.config,
                  labelColumn:
                    d.config.labelColumn ||
                    pick(["actual", "label", "target", "y_true"]),
                  predictionColumn:
                    d.config.predictionColumn ||
                    pick(["predicted", "prediction", "y_pred"]),
                  groupColumn:
                    d.config.groupColumn || pick(["group", "protected_group"]),
                },
              };
            });
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setInspecting(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modelId identifies model; picking a profile must not re-inspect the dataset
  }, [wizard, modelId, e.id, tenantId]);
  async function registerVersion(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    try {
      await act("createModel", {
        name: register!.name,
        version: register!.version,
        format: register!.format,
        task: register!.task,
        intendedPurpose: register!.intendedPurpose,
        artifactId: register!.artifactId,
        card,
      });
      setRegister(null);
      onView("models");
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const classCount =
      inspect?.columns.find((c) => c.name === draft.config.labelColumn)
        ?.uniqueCount ?? null,
    groupCount =
      inspect?.columns.find((c) => c.name === draft.config.groupColumn)
        ?.uniqueCount ?? 2,
    // A saved protocol keeps its frozen plan; a new one pre-registers the form's.
    lockedProfile = profiles.find((p) => p.id === profileId),
    planned = lockedProfile?.statistics
      ? { plan: lockedProfile.statistics, error: "" as const }
      : draftPlan(draft, classCount);
  function planForm(change: Partial<PlanForm>) {
    setDraft((d) => ({ ...d, plan: { ...d.plan, ...change } }));
  }
  const selectedTests = tests.filter((t) => draft.suite.includes(t.id)),
    fair = fairnessSelected(draft.suite),
    savedDeclaration = profiles.find(
      (p) => p.id === profileId,
    )?.specialCategory,
    // Special-category fairness tests run client-side unless the protocol
    // takes the hosted route with a recorded basis.
    special =
      fair &&
      (locked
        ? (savedDeclaration?.specialCategory ?? true)
        : (declaration.specialCategory ?? true)),
    hostedRoute = locked
      ? savedDeclaration?.route === "hosted" && !!savedDeclaration.basis
      : declaration.route === "hosted" &&
        !!basisFor(e, draft.config.groupColumn),
    cols =
      inspect?.columns.map((c) => ({
        value: c.name,
        label: c.name + " · " + c.type,
      })) ?? [];
  function stepError() {
    if (step === 0)
      return !model
        ? "Choose a registered saved-prediction model."
        : modelCapability(model) !== "Saved predictions ready"
          ? modelCapability(model)
          : draft.task !== model.task
            ? "Protocol and model tasks must match."
            : "";
    if (step === 1) {
      if (!inspect) return "Inspect the dataset before continuing.";
      const required = [
        draft.config.labelColumn,
        draft.config.predictionColumn,
        ...(fair ? [draft.config.groupColumn] : []),
      ];
      if (required.some((c) => !inspect.columns.some((x) => x.name === c)))
        return "Map each required column.";
      if (new Set(required).size !== required.length)
        return "Target, prediction and group must use different columns.";
      if (
        required.some((c) => inspect.columns.find((x) => x.name === c)!.missing)
      )
        return "Mapped columns contain missing values. Correct and register a new prediction artifact.";
      if (
        model?.task === "Regression" &&
        required
          .slice(0, 2)
          .some(
            (c) =>
              inspect.columns.find((x) => x.name === c)?.type !== "numeric",
          )
      )
        return "Regression requires numeric target and prediction columns.";
      if (
        !draft.datasetContext.population.trim() ||
        !draft.datasetContext.predictionProvenance.trim() ||
        !draft.datasetContext.independence.trim()
      )
        return "Record population, prediction provenance and independence.";
      if (
        model?.task === "Binary classification" &&
        !draft.config.positiveLabel.trim()
      )
        return "Record the favourable class label.";
      if (
        !locked &&
        model?.task === "Binary classification" &&
        (!draft.config.negativeLabel?.trim() ||
          draft.config.negativeLabel === draft.config.positiveLabel)
      )
        return "Record the other class label, distinct from the favourable label.";
    }
    if (step === 2) {
      if (fair) {
        const required = [
          draft.config.labelColumn,
          draft.config.predictionColumn,
          draft.config.groupColumn,
        ];
        if (new Set(required).size !== 3)
          return "Target, prediction and protected-group columns must be distinct.";
        if (
          required.some(
            (c) =>
              !inspect?.columns.some((x) => x.name === c) ||
              inspect?.columns.find((x) => x.name === c)?.missing,
          )
        )
          return "Fairness mappings need present, nonmissing columns.";
      }
      if (!draft.suite.length)
        return "Choose at least one available procedure.";
      if (
        !draft.name.trim() ||
        !draft.version.trim() ||
        !draft.rationale.trim()
      )
        return "Name the protocol, version and rationale for its criteria.";
      if (
        fair &&
        (!draft.config.groupColumn ||
          !draft.datasetContext.sensitiveDataBasis.trim())
      )
        return "Fairness requires a protected-group column and handling basis.";
      if (!locked && planned.error) return planned.error;
      if (
        !locked &&
        draft.plan.minimumCoverage < 1 &&
        !draft.plan.coverageRationale.trim()
      )
        return "Record why a coverage below 100% is acceptable.";
      if (special && !saveOnly && !hostedRoute)
        return "Special-category fairness tests run client-side by default: save the protocol only and queue it for the external worker or the runtime package, or choose the hosted route with the client's recorded basis.";
    }
    if (
      step === 3 &&
      !locked &&
      planned.plan &&
      powerShortfalls(planned.plan).length &&
      !draft.plan.acknowledgement.trim()
    )
      return "Acknowledge the power shortfall before saving the protocol.";
    if (step === 3 && special && !saveOnly && !acknowledged)
      return "Acknowledge that this run processes special-category data on the platform.";
    return "";
  }
  async function runEvaluation() {
    setError("");
    try {
      let source = e,
        currentProfile = profileId;
      if (!currentProfile) {
        const created = await act("createEvaluationProfile", {
          ...profileRequest(draft, classCount),
          ...(fair && draft.config.groupColumn
            ? {
                specialCategory: declarationFor(
                  e,
                  draft.config.groupColumn,
                  declaration,
                ),
              }
            : {}),
        });
        source = created.engagement;
        currentProfile = created.details!.profileId;
        setProfileId(currentProfile);
      }
      if (saveOnly) {
        setWizard(false);
        onView("protocols");
        return;
      }
      // The card must describe the exact accepted bytes this run evaluates.
      const card = datasetCardFor(
        cards,
        source.artifacts.find(
          (a) => a.id === model!.artifactId && a.status === "accepted",
        ),
        binding?.datasetCardRecordId,
      );
      const queued = await act(
        "queueRun",
        {
          modelId: model!.id,
          datasetId: model!.artifactId,
          profileId: currentProfile,
          ...(binding ? { procedureId: binding.procedureId } : {}),
          ...(card ? { datasetCardRecordId: card.id } : {}),
          ...(special ? { acknowledgeSpecialCategory: true } : {}),
        },
        source,
      );
      setBinding(null);
      setWizard(false);
      onView("runs");
      await act(
        "executeRun",
        { runId: queued.details!.runId },
        queued.engagement,
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function config(key: keyof EvaluationConfig, value: string | number) {
    setDraft((d) => ({ ...d, config: { ...d.config, [key]: value } }));
  }
  function numeric(
    key: keyof EvaluationConfig,
    label: string,
    min: number,
    max: number,
    help?: string,
  ) {
    return (
      <Field key={key} label={label} help={help}>
        <Input
          type="number"
          min={min}
          max={max}
          step={
            key.startsWith("minimum") &&
            [
              "minimumSampleSize",
              "minimumGroupSize",
              "minimumClassCount",
            ].includes(key)
              ? 1
              : "any"
          }
          value={draft.config[key] ?? ""}
          onChange={(ev) => config(key, Number(ev.target.value))}
          required
          disabled={locked}
        />
      </Field>
    );
  }
  const runnable = e.models.filter(
    (m) => modelCapability(m) === "Saved predictions ready",
  );
  // The selected run as the engagement now holds it, so starting, cancelling
  // or completing it updates the open dialog.
  const shownRun =
    selectedRun && (e.runs.find((r) => r.id === selectedRun.id) ?? selectedRun);
  return (
    <div className="ml-lab">
      <Tabs value={view} onValueChange={onView}>
        <div className="ml-tabbar">
          <TabsList>
            <TabsTrigger value="datasets">Datasets</TabsTrigger>
            <TabsTrigger value="models">Model registry</TabsTrigger>
            <TabsTrigger value="protocols">Protocols</TabsTrigger>
            <TabsTrigger value="runs">Evaluations</TabsTrigger>
            <TabsTrigger value="catalog">Test catalog</TabsTrigger>
          </TabsList>
          <div className="row-actions">
            {view === "models" && writer && (
              <>
                <Button variant="ghost" onClick={onEvidence}>
                  Evidence vault
                </Button>
                <Button disabled={busy} onClick={() => startRegistration()}>
                  <Plus size={15} />
                  Register version
                </Button>
              </>
            )}
            {view === "protocols" && writer && runnable.length > 0 && (
              <Button
                disabled={busy}
                onClick={() => startWizard(undefined, undefined, true)}
              >
                <Plus size={15} />
                New protocol
              </Button>
            )}
            {view === "runs" && writer && (
              <Button
                disabled={busy}
                onClick={() =>
                  runnable.length ? startWizard() : onView("models")
                }
              >
                {runnable.length ? (
                  <>
                    <Play size={15} />
                    New evaluation
                  </>
                ) : (
                  "Open model registry"
                )}
              </Button>
            )}
          </div>
        </div>
        <TabsContent value="datasets">
          <SpecialCategoryRegister
            engagement={e}
            writer={writer}
            busy={busy}
            act={act}
            onEditing={onBasisEditing}
          />
          <ClientDatasetPins
            engagement={e}
            writer={writer}
            busy={busy}
            act={act}
          />
          <DatasetRegistry
            engagement={e}
            tenantId={tenantId}
            role={role}
            onEditing={onDatasetEditing}
            onRefresh={onRefresh}
            onCards={setCards}
          />
        </TabsContent>
        <TabsContent value="models">
          <section className="panel">
            <div className="panel-head">
              <h2>Model versions</h2>
              <span className="subtle">
                {e.models.length}{" "}
                {e.models.length === 1 ? "version" : "versions"}
              </span>
            </div>
            {e.models.length ? (
              <Table className="model-registry-table">
                <TableHeader>
                  <TableRow>
                    {[
                      "Model / version",
                      "Task",
                      "Source",
                      "Testing capability",
                      "Actions",
                    ].map((s) => (
                      <TableHead key={s}>{s}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.models.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <button
                          className="paper-link"
                          onClick={() => setSelectedModel(m)}
                        >
                          {m.name}
                        </button>
                        <small className="block subtle">
                          Version {m.version} · {m.card?.framework ?? m.format}
                        </small>
                      </TableCell>
                      <TableCell>{m.task}</TableCell>
                      <TableCell data-label="Source">
                        {resolve(m.artifactId)}
                      </TableCell>
                      <TableCell>
                        <span className="badge neutral">
                          {modelCapability(m)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {writer &&
                          modelCapability(m) === "Saved predictions ready" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => startWizard(m)}
                            >
                              <Play size={13} />
                              Evaluate
                            </Button>
                          )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="ml-empty">
                <Layers3 size={25} />
                <h3>Start with a model version</h3>
                <p>
                  Accept a prediction CSV in Evidence, then register its model
                  card.
                </p>
                {writer && (
                  <Button variant="outline" onClick={onEvidence}>
                    Open evidence vault
                  </Button>
                )}
                <a download href="/example-predictions.csv">
                  Download sample CSV
                </a>
              </div>
            )}
          </section>
        </TabsContent>
        <TabsContent value="protocols">
          <section className="panel">
            <div className="panel-head">
              <h2>Reusable evaluation protocols</h2>
              <span className="subtle">{profiles.length} saved</span>
            </div>
            {profiles.length ? (
              <Table className="protocol-register-table">
                <TableHeader>
                  <TableRow>
                    {[
                      "Protocol / version",
                      "Task",
                      "Procedures",
                      "Actions",
                    ].map((s) => (
                      <TableHead key={s}>{s}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <button
                          className="paper-link"
                          onClick={() => setSelectedProtocol(p)}
                        >
                          {p.name}
                        </button>
                        <small className="block subtle">
                          Version {p.version}
                        </small>
                      </TableCell>
                      <TableCell>{p.task}</TableCell>
                      <TableCell data-label="Procedures">
                        {p.suite.length}
                      </TableCell>
                      <TableCell>
                        {writer && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              busy || !runnable.some((m) => m.task === p.task)
                            }
                            onClick={() =>
                              startWizard(
                                runnable.find((m) => m.task === p.task),
                                p,
                              )
                            }
                          >
                            Use protocol
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="ml-empty">
                <FileCheck2 size={25} />
                <h3>No protocols yet</h3>
                <p>
                  {runnable.length
                    ? "Save a protocol to reuse its data mappings and acceptance criteria."
                    : "Register a saved-prediction model before creating a protocol."}
                </p>
                {!runnable.length && (
                  <Button variant="outline" onClick={() => onView("models")}>
                    Open model registry
                  </Button>
                )}
              </div>
            )}
          </section>
        </TabsContent>
        <TabsContent value="runs">
          <section className="panel">
            <div className="panel-head">
              <h2>Evaluations</h2>
              <span className="subtle">{e.runs.length} runs</span>
            </div>
            {e.runs.length ? (
              <Table className="evaluation-register-table">
                <TableHeader>
                  <TableRow>
                    {[
                      "Model / protocol",
                      "Created",
                      "Execution",
                      "Criterion outcome",
                      "Actions",
                    ].map((s) => (
                      <TableHead key={s}>{s}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.runs
                    .slice()
                    .reverse()
                    .map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <button
                            className="paper-link"
                            onClick={() => setSelectedRun(r)}
                          >
                            {r.manifest?.model.name ?? resolve(r.modelId)} ·{" "}
                            {r.manifest?.model.version ?? "legacy"}
                          </button>
                          <small className="block subtle">
                            {r.manifest?.profile?.name ??
                              "Explicit configuration"}{" "}
                            · {r.suite.length} procedures
                          </small>
                        </TableCell>
                        <TableCell>
                          {new Date(r.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <State value={r.state} />
                        </TableCell>
                        <TableCell>
                          <State value={r.outcome ?? "pending"} />
                        </TableCell>
                        <TableCell>
                          <div className="row-actions">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedRun(r)}
                            >
                              Results
                            </Button>
                            {writer && r.state === "queued" && (
                              <>
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    void act("executeRun", {
                                      runId: r.id,
                                    }).catch(() => {})
                                  }
                                >
                                  Start
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() =>
                                    void act("cancelRun", {
                                      runId: r.id,
                                    }).catch(() => {})
                                  }
                                >
                                  Cancel
                                </Button>
                              </>
                            )}
                            {role === "Lead Auditor" &&
                              r.state === "running" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    void act("recoverRun", {
                                      runId: r.id,
                                    }).catch(() => {})
                                  }
                                >
                                  Recover
                                </Button>
                              )}
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Export evaluation manifest and results"
                              onClick={() => download(r.id + ".json", r)}
                            >
                              <Download size={14} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : (
              <div className="ml-empty">
                <FlaskConical size={25} />
                <h3>No evaluations yet</h3>
                <p>
                  {runnable.length
                    ? "Choose a registered version, map its data and review the criteria before running."
                    : "Register a saved-prediction model to start testing."}
                </p>
              </div>
            )}
          </section>
        </TabsContent>
        <TabsContent value="catalog">
          <section className="panel">
            <div className="panel-head">
              <h2>Testing capabilities</h2>
            </div>
            {tests.map((t) => (
              <div className="ml-capability" key={t.id}>
                <div>
                  <b>{t.label}</b>
                  <p className="subtle">{t.requires}</p>
                  <small className="subtle">{t.tasks.join(" · ")}</small>
                </div>
                <span className="badge neutral">
                  {t.mode === "interactive"
                    ? "Available here"
                    : t.mode === "external"
                      ? "External Python runner"
                      : "Integration required"}
                </span>
              </div>
            ))}
          </section>
        </TabsContent>
      </Tabs>
      <Dialog
        open={!!register}
        onOpenChange={(v) => {
          if (!v) closeSetup("registration");
        }}
      >
        {!!register && (
          <DialogContent className="audit-dialog ml-dialog">
            <DialogHeader>
              <DialogTitle>Register model version</DialogTitle>
              <DialogDescription>
                Cards and artifact pins are immutable. Corrections use a new
                version.
              </DialogDescription>
            </DialogHeader>
            {register && (
              <form
                onChange={() => setTouched(true)}
                onSubmit={registerVersion}
              >
                <fieldset disabled={busy}>
                  <div className="ml-form-grid">
                    <Field label="Model name">
                      <Input
                        required
                        value={register.name ?? ""}
                        onChange={(ev) =>
                          setRegister({ ...register, name: ev.target.value })
                        }
                      />
                    </Field>
                    <Field label="Version">
                      <Input
                        required
                        value={register.version ?? ""}
                        onChange={(ev) =>
                          setRegister({ ...register, version: ev.target.value })
                        }
                      />
                    </Field>
                    <SelectField
                      label="Artifact format"
                      value={register.format ?? ""}
                      onChange={(v) =>
                        setRegister({ ...register, format: v, artifactId: "" })
                      }
                      options={[
                        "Prediction file",
                        "Scikit-learn",
                        "XGBoost",
                        "LightGBM",
                        "ONNX",
                        "PMML",
                        "Other model binary",
                      ].map((v) => ({
                        value: v,
                        label:
                          v === "Prediction file"
                            ? "Saved predictions (CSV)"
                            : v,
                      }))}
                    />
                    <SelectField
                      label="Evaluation task"
                      value={register.task ?? ""}
                      onChange={(v) => setRegister({ ...register, task: v })}
                      options={tasks.map((v) => ({ value: v, label: v }))}
                    />
                  </div>
                  <SelectField
                    label={
                      register.format === "Prediction file"
                        ? "Accepted prediction dataset"
                        : "Quarantined model artifact"
                    }
                    value={register.artifactId ?? ""}
                    onChange={(v) =>
                      setRegister({ ...register, artifactId: v })
                    }
                    options={e.artifacts
                      .filter((a) =>
                        register.format === "Prediction file"
                          ? a.category === "Dataset" &&
                            a.status === "accepted" &&
                            a.name.toLowerCase().endsWith(".csv")
                          : a.category === "Model",
                      )
                      .map((a) => ({ value: a.id, label: a.name }))}
                  />
                  <div className="ml-form-grid">
                    <Field label="Provider / model owner">
                      <Input
                        required
                        value={card.owner}
                        onChange={(ev) =>
                          setCard({ ...card, owner: ev.target.value })
                        }
                      />
                    </Field>
                    <Field label="Algorithm / framework">
                      <Input
                        required
                        placeholder="e.g. LightGBM classifier"
                        value={card.framework}
                        onChange={(ev) =>
                          setCard({ ...card, framework: ev.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <Field label="Intended use">
                    <Textarea
                      required
                      value={register.intendedPurpose ?? ""}
                      onChange={(ev) =>
                        setRegister({
                          ...register,
                          intendedPurpose: ev.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Output meaning"
                    help="State what each class or numeric prediction represents."
                  >
                    <Textarea
                      required
                      value={card.outputSemantics}
                      onChange={(ev) =>
                        setCard({ ...card, outputSemantics: ev.target.value })
                      }
                    />
                  </Field>
                  <details className="ml-more">
                    <summary>Population, schema & source provenance</summary>
                    {(
                      [
                        "population",
                        "outOfScope",
                        "limitations",
                        "inputSchema",
                        "preprocessing",
                        "license",
                      ] as const
                    ).map((key) => (
                      <Field
                        key={key}
                        label={
                          {
                            population: "Intended population",
                            outOfScope: "Out-of-scope uses",
                            limitations: "Known limitations",
                            inputSchema: "Ordered input features / types",
                            preprocessing: "Preprocessing version / evidence",
                            license: "License / usage rights",
                          }[key]
                        }
                      >
                        <Textarea
                          value={card[key]}
                          onChange={(ev) =>
                            setCard({ ...card, [key]: ev.target.value })
                          }
                        />
                      </Field>
                    ))}
                    <SelectField
                      label="Source reference"
                      value={card.source.kind}
                      onChange={(v) =>
                        setCard({
                          ...card,
                          source: {
                            ...card.source,
                            kind: v as "internal" | "huggingface",
                          },
                        })
                      }
                      options={[
                        { value: "internal", label: "Internal evidence" },
                        {
                          value: "huggingface",
                          label: "Hugging Face provenance reference",
                        },
                      ]}
                    />
                    {card.source.kind === "huggingface" && (
                      <>
                        <p className="subtle">
                          Reference only. Files are supplied through the
                          evidence vault; no Hub download or upload occurs.
                        </p>
                        {(["repoId", "revision", "filename"] as const).map(
                          (key) => (
                            <Field
                              key={key}
                              label={
                                {
                                  repoId: "Repository (owner/name)",
                                  revision: "Full commit hash (40 characters)",
                                  filename: "Relative source filename",
                                }[key]
                              }
                            >
                              <Input
                                required
                                value={card.source[key]}
                                onChange={(ev) =>
                                  setCard({
                                    ...card,
                                    source: {
                                      ...card.source,
                                      [key]: ev.target.value,
                                    },
                                  })
                                }
                              />
                            </Field>
                          ),
                        )}
                      </>
                    )}
                  </details>
                  {register.format !== "Prediction file" && (
                    <p className="ml-notice">
                      This registers inventory and provenance. Model bytes
                      remain quarantined; execution needs a trusted external
                      adapter.
                    </p>
                  )}
                  {register.task === "Classical NLP" && (
                    <p className="ml-notice">
                      For text classification predictions, choose Binary or
                      Multiclass classification. Other NLP tasks are
                      inventory-only here.
                    </p>
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
                      onClick={() => closeSetup("registration")}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        !register.artifactId ||
                        !register.task ||
                        !register.format
                      }
                    >
                      Register version
                    </Button>
                  </div>
                </fieldset>
              </form>
            )}
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={wizard}
        onOpenChange={(v) => {
          if (!v) closeSetup("wizard");
        }}
      >
        {wizard && (
          <DialogContent className="audit-dialog ml-dialog">
            <DialogHeader>
              <DialogTitle>
                {saveOnly
                  ? "Create evaluation protocol"
                  : "Configure evaluation"}
              </DialogTitle>
              <DialogDescription>
                {locked
                  ? "Reuse an immutable protocol. Create a new version to change its criteria."
                  : "Map evidence, choose procedures, then review the frozen request."}
              </DialogDescription>
            </DialogHeader>
            <ol className="ml-stepper">
              {["Model", "Data", "Procedures", "Review"].map((label, i) => (
                <li
                  className={step === i ? "active" : step > i ? "complete" : ""}
                  key={label}
                >
                  <span>{i + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
            <form
              onChange={() => setTouched(true)}
              onSubmit={(ev) => {
                ev.preventDefault();
                const message = stepError();
                if (message) setError(message);
                else if (step < 3) {
                  setError("");
                  setStep(step + 1);
                } else void runEvaluation();
              }}
            >
              <fieldset disabled={busy || inspecting}>
                {step === 0 && (
                  <>
                    {binding && (
                      <p className="ml-notice">
                        Planned procedure{" "}
                        {e.workflow?.procedures.find(
                          (p) => p.id === binding.procedureId,
                        )?.title ?? binding.procedureId}
                        : the approved audit program fixes this model version
                        and protocol.
                      </p>
                    )}
                    <SelectField
                      label="Registered model version"
                      value={modelId}
                      disabled={!!binding}
                      onChange={(v) => {
                        const m = e.models.find((x) => x.id === v);
                        setModelId(v);
                        setProfileId("");
                        setDraft(emptyDraft(m?.task));
                        setError("");
                      }}
                      options={runnable.map((m) => ({
                        value: m.id,
                        label: m.name + " · " + m.version + " · " + m.task,
                      }))}
                    />
                    <SelectField
                      label="Evaluation protocol"
                      value={profileId || "new"}
                      disabled={!!binding}
                      onChange={(v) => {
                        const p = profiles.find((x) => x.id === v);
                        setProfileId(p?.id ?? "");
                        setDraft(p ? profileDraft(p) : emptyDraft(model?.task));
                      }}
                      options={[
                        { value: "new", label: "Create a new protocol" },
                        ...profiles
                          .filter((p) => p.task === model?.task)
                          .map((p) => ({
                            value: p.id,
                            label: p.name + " · " + p.version,
                          })),
                      ]}
                    />
                    {model && (
                      <div className="ml-notice">
                        <b>{resolve(model.artifactId)}</b>
                        <p>
                          Evaluation is bound to this version’s registered
                          prediction file. Up to 1 MB, 10,000 rows and 200
                          columns.
                        </p>
                      </div>
                    )}
                  </>
                )}
                {step === 1 && (
                  <>
                    {inspect ? (
                      <>
                        <div className="ml-inspection">
                          <span>{inspect.rowCount.toLocaleString()} rows</span>
                          <span>{inspect.columns.length} columns</span>
                          <span>SHA-256 verified</span>
                        </div>
                        <div className="ml-form-grid">
                          <SelectField
                            label="Reference target"
                            value={draft.config.labelColumn}
                            disabled={locked}
                            onChange={(v) => config("labelColumn", v)}
                            options={cols}
                          />
                          <SelectField
                            label="Saved prediction"
                            value={draft.config.predictionColumn}
                            disabled={locked}
                            onChange={(v) => config("predictionColumn", v)}
                            options={cols}
                          />
                        </div>
                        {model?.task === "Binary classification" && (
                          <Field
                            label="Favourable class label"
                            help="The outcome fairness tests count as selection."
                          >
                            <Input
                              disabled={locked}
                              required
                              value={draft.config.positiveLabel}
                              onChange={(ev) =>
                                config("positiveLabel", ev.target.value)
                              }
                            />
                          </Field>
                        )}
                        {model?.task === "Binary classification" && (
                          <Field
                            label="Other class label"
                            help="Declaring both labels lets data in which only one occurs be evaluated; the statistics gates then decide."
                          >
                            <Input
                              disabled={locked}
                              required
                              value={draft.config.negativeLabel ?? ""}
                              onChange={(ev) =>
                                config("negativeLabel", ev.target.value)
                              }
                            />
                          </Field>
                        )}
                        <details className="ml-more">
                          <summary>Column profile (no raw row preview)</summary>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {["Column", "Type", "Missing", "Distinct"].map(
                                  (x) => (
                                    <TableHead key={x}>{x}</TableHead>
                                  ),
                                )}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {inspect.columns.map((c) => (
                                <TableRow key={c.name}>
                                  <TableCell>{c.name}</TableCell>
                                  <TableCell>{c.type}</TableCell>
                                  <TableCell>{c.missing}</TableCell>
                                  <TableCell>{c.uniqueCount}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </details>
                      </>
                    ) : (
                      <p className="subtle">
                        {inspecting
                          ? "Inspecting dataset…"
                          : "Dataset inspection is unavailable."}
                      </p>
                    )}
                    <SelectField
                      label="Declared dataset role"
                      value={draft.datasetContext.split}
                      disabled={locked}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          datasetContext: {
                            ...draft.datasetContext,
                            split: v as Draft["datasetContext"]["split"],
                          },
                        })
                      }
                      options={[
                        "test",
                        "validation",
                        "training",
                        "unknown",
                      ].map((v) => ({ value: v, label: v }))}
                    />
                    {(
                      [
                        "population",
                        "predictionProvenance",
                        "independence",
                      ] as const
                    ).map((key) => (
                      <Field
                        key={key}
                        label={
                          {
                            population: "Population / collection scope",
                            predictionProvenance:
                              "How these predictions were generated",
                            independence:
                              "Holdout independence / known leakage",
                          }[key]
                        }
                        help={
                          key === "independence"
                            ? "State what is verified and what remains unknown."
                            : undefined
                        }
                      >
                        <Textarea
                          disabled={locked}
                          required
                          value={draft.datasetContext[key]}
                          onChange={(ev) =>
                            setDraft({
                              ...draft,
                              datasetContext: {
                                ...draft.datasetContext,
                                [key]: ev.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                    ))}
                  </>
                )}
                {step === 2 && (
                  <>
                    <div className="ml-form-grid">
                      <Field label="Protocol name">
                        <Input
                          required
                          disabled={locked}
                          value={draft.name}
                          onChange={(ev) =>
                            setDraft({ ...draft, name: ev.target.value })
                          }
                        />
                      </Field>
                      <Field label="Protocol version">
                        <Input
                          required
                          disabled={locked}
                          value={draft.version}
                          onChange={(ev) =>
                            setDraft({ ...draft, version: ev.target.value })
                          }
                        />
                      </Field>
                    </div>
                    <div className="ml-procedures">
                      {tests
                        .filter(
                          (t) =>
                            t.mode === "interactive" &&
                            (t.tasks as readonly string[]).includes(draft.task),
                        )
                        .map((t) => (
                          <label key={t.id}>
                            <input
                              type="checkbox"
                              disabled={locked}
                              checked={draft.suite.includes(t.id)}
                              onChange={(ev) =>
                                setDraft({
                                  ...draft,
                                  suite: ev.target.checked
                                    ? [...draft.suite, t.id]
                                    : draft.suite.filter((x) => x !== t.id),
                                })
                              }
                            />
                            <span>
                              <b>{t.label}</b>
                              <small className="block subtle">
                                {t.requires}
                              </small>
                            </span>
                          </label>
                        ))}
                    </div>
                    <div className="ml-form-grid">
                      {numeric(
                        "minimumSampleSize",
                        "Minimum total rows",
                        30,
                        10000,
                        "At least 30, the platform floor.",
                      )}
                      {model?.task !== "Regression" &&
                        numeric(
                          "minimumClassCount",
                          "Minimum rows per class-conditional denominator",
                          10,
                          1000,
                          "At least 10, the platform floor.",
                        )}
                      <SelectField
                        label="Confidence level"
                        value={String(draft.plan.confidenceLevel)}
                        disabled={locked}
                        onChange={(v) =>
                          planForm({
                            confidenceLevel: Number(
                              v || 0.95,
                            ) as PlanForm["confidenceLevel"],
                          })
                        }
                        options={[0.9, 0.95, 0.99].map((v) => ({
                          value: String(v),
                          label: `${v * 100}% intervals`,
                        }))}
                      />
                      {draft.suite.includes("performance") && (
                        <>
                          {numeric(
                            "minimumAccuracy",
                            "Minimum accuracy (0–1)",
                            0,
                            1,
                          )}
                          {model?.task === "Binary classification" && (
                            <Field
                              label="Performance positive class"
                              help="Recall is measured on this class and specificity on the other. Leave empty to use the favourable label."
                            >
                              <Input
                                disabled={locked}
                                placeholder={draft.config.positiveLabel}
                                value={
                                  draft.config.performancePositiveLabel ?? ""
                                }
                                onChange={(ev) =>
                                  config(
                                    "performancePositiveLabel",
                                    ev.target.value,
                                  )
                                }
                              />
                            </Field>
                          )}
                          {numeric(
                            model?.task === "Binary classification"
                              ? "minimumRecall"
                              : "minimumMacroF1",
                            model?.task === "Binary classification"
                              ? "Minimum recall of the positive class"
                              : "Minimum macro F1",
                            0,
                            1,
                          )}
                        </>
                      )}
                      {draft.suite.includes("regression") &&
                        numeric(
                          "maximumRmse",
                          "Maximum RMSE",
                          0.000000001,
                          1e100,
                          "In the target’s original units.",
                        )}
                    </div>
                    {fair && (
                      <>
                        <SelectField
                          label="Protected-group column"
                          value={draft.config.groupColumn}
                          disabled={locked}
                          onChange={(v) => config("groupColumn", v)}
                          options={cols}
                        />
                        <ProtocolDeclaration
                          engagement={e}
                          column={draft.config.groupColumn}
                          value={declaration}
                          onChange={setDeclaration}
                          saved={
                            locked ? (savedDeclaration ?? null) : undefined
                          }
                        />
                        <Field label="Reviewed basis for protected-data handling">
                          <Textarea
                            disabled={locked}
                            required
                            value={draft.datasetContext.sensitiveDataBasis}
                            onChange={(ev) =>
                              setDraft({
                                ...draft,
                                datasetContext: {
                                  ...draft.datasetContext,
                                  sensitiveDataBasis: ev.target.value,
                                },
                              })
                            }
                          />
                        </Field>
                        <div className="ml-form-grid">
                          {numeric(
                            "minimumGroupSize",
                            "Minimum rows per group",
                            30,
                            1000,
                            "Smaller groups are reported but never decide. A special-category group column needs at least " +
                              specialCategoryGroupFloor +
                              ".",
                          )}
                          <Field
                            label="Minimum coverage (0.5–1)"
                            help="Share of rows the eligible groups must cover for a pass."
                          >
                            <Input
                              type="number"
                              min={0.5}
                              max={1}
                              step="any"
                              disabled={locked}
                              value={draft.plan.minimumCoverage}
                              onChange={(ev) =>
                                planForm({
                                  minimumCoverage: Number(ev.target.value),
                                })
                              }
                            />
                          </Field>
                          {draft.suite.includes("demographic_parity") &&
                            numeric(
                              "maximumParityGap",
                              "Maximum selection-rate gap (0–1)",
                              0,
                              1,
                            )}
                          {draft.suite.includes("disparate_impact") &&
                            numeric(
                              "minimumImpactRatio",
                              "Minimum selection-rate ratio",
                              0,
                              1,
                            )}
                          {draft.suite.includes("disparate_impact") && (
                            <SelectField
                              label="Ratio threshold basis"
                              value={draft.plan.impactBasis}
                              disabled={locked}
                              onChange={(v) =>
                                planForm({
                                  impactBasis: (v ||
                                    "policy.eu-aia.impact-ratio") as PlanForm["impactBasis"],
                                })
                              }
                              options={[
                                {
                                  value: "policy.eu-aia.impact-ratio",
                                  label:
                                    "Internal AI Act policy (no legal safe harbour)",
                                },
                                {
                                  value: "screen.us.four-fifths",
                                  label:
                                    "US four-fifths screen (a heuristic, not a legal test)",
                                },
                              ]}
                            />
                          )}
                          {draft.suite.includes("equalized_odds") &&
                            numeric(
                              "maximumOddsGap",
                              "Maximum TPR / FPR gap (0–1)",
                              0,
                              1,
                            )}
                        </div>
                        {draft.plan.minimumCoverage < 1 && (
                          <Field label="Why a coverage below 100% is acceptable">
                            <Textarea
                              disabled={locked}
                              required
                              value={draft.plan.coverageRationale}
                              onChange={(ev) =>
                                planForm({ coverageRationale: ev.target.value })
                              }
                            />
                          </Field>
                        )}
                      </>
                    )}
                    <Field
                      label="Why these acceptance criteria are appropriate"
                      help="Internal thresholds need context; they do not certify legal compliance."
                    >
                      <Textarea
                        required
                        disabled={locked}
                        value={draft.rationale}
                        onChange={(ev) =>
                          setDraft({ ...draft, rationale: ev.target.value })
                        }
                      />
                    </Field>
                  </>
                )}
                {step === 3 && (
                  <>
                    <dl className="record-fields">
                      <div>
                        <dt>Model version</dt>
                        <dd>
                          {model?.name} · {model?.version}
                        </dd>
                      </div>
                      <div>
                        <dt>Prediction evidence</dt>
                        <dd>
                          {model && resolve(model.artifactId)} ·{" "}
                          {inspect?.rowCount} rows
                        </dd>
                      </div>
                      <div>
                        <dt>Protocol</dt>
                        <dd>
                          {draft.name} · {draft.version} ·{" "}
                          {draft.datasetContext.split}
                        </dd>
                      </div>
                      <div>
                        <dt>Procedures</dt>
                        <dd>{selectedTests.map((t) => t.label).join(", ")}</dd>
                      </div>
                      <div>
                        <dt>Pre-registered plan</dt>
                        <dd>
                          {planned.plan ? (
                            <>
                              <ul className="record-list">
                                {describePlan(planned.plan).map((line) => (
                                  <li key={line}>{line}</li>
                                ))}
                              </ul>
                              <small className="subtle">
                                Plan SHA-256 {planSha256(planned.plan)}
                              </small>
                            </>
                          ) : (
                            planned.error
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Acceptance rationale</dt>
                        <dd>{draft.rationale}</dd>
                      </div>
                    </dl>
                    {planned.plan && !locked && inspect && (
                      <PowerCheck
                        plan={planned.plan}
                        rows={inspect.rowCount}
                        groups={fair ? groupCount : 1}
                        assumptions={draft.plan.powerAssumptions}
                        acknowledgement={draft.plan.acknowledgement}
                        disabled={busy}
                        onAssumptions={(powerAssumptions) =>
                          planForm({ powerAssumptions })
                        }
                        onAcknowledgement={(acknowledgement) =>
                          planForm({ acknowledgement })
                        }
                      />
                    )}
                    <p className="ml-notice">
                      Saving freezes the plan: the interval decides each
                      criterion against its band, and changing the plan later
                      needs a new protocol version. The run freezes the card,
                      artifact hash, protocol and runner definition. Supplied
                      predictions and independence declarations require audit
                      corroboration. Results create draft working papers for
                      human review.
                    </p>
                    {draft.datasetContext.split === "training" && (
                      <p className="ml-notice">
                        Training data measures fit; this run cannot establish
                        independent generalization.
                      </p>
                    )}
                    {special && !saveOnly && (
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(ev) => setAcknowledged(ev.target.checked)}
                        />{" "}
                        I acknowledge that this run processes the
                        special-category column {draft.config.groupColumn} on
                        this platform under the client&apos;s recorded basis,
                        which the run and the report will state.
                      </label>
                    )}
                  </>
                )}
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                {inspecting && (
                  <p role="status" className="subtle">
                    Validating dataset integrity…
                  </p>
                )}
                <div className="ml-footer">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      step ? setStep(step - 1) : closeSetup("wizard")
                    }
                  >
                    <ArrowLeft size={14} />
                    {step ? "Back" : "Cancel"}
                  </Button>
                  <Button type="submit" disabled={busy || inspecting}>
                    {step === 3
                      ? saveOnly
                        ? "Save protocol"
                        : locked
                          ? "Run evaluation"
                          : "Save protocol & run"
                      : "Continue"}
                    {step < 3 && <ArrowRight size={14} />}
                  </Button>
                </div>
              </fieldset>
            </form>
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={!!selectedModel}
        onOpenChange={(v) => {
          if (!v) setSelectedModel(null);
        }}
      >
        {!!selectedModel && (
          <DialogContent className="audit-dialog ml-dialog">
            <DialogHeader>
              <DialogTitle>
                {selectedModel?.name} · {selectedModel?.version}
              </DialogTitle>
              <DialogDescription>
                Registered model card ·{" "}
                {selectedModel && modelCapability(selectedModel)}
              </DialogDescription>
            </DialogHeader>
            {selectedModel && (
              <>
                <dl className="record-fields">
                  <div>
                    <dt>Task</dt>
                    <dd>{selectedModel.task}</dd>
                  </div>
                  <div>
                    <dt>Source artifact</dt>
                    <dd>{resolve(selectedModel.artifactId)}</dd>
                  </div>
                  <div>
                    <dt>Provider / owner</dt>
                    <dd>{selectedModel.card?.owner ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Algorithm</dt>
                    <dd>
                      {selectedModel.card?.framework ?? selectedModel.format}
                    </dd>
                  </div>
                </dl>
                <section className="readable-section">
                  <h3>Intended use</h3>
                  <p>{selectedModel.intendedPurpose}</p>
                </section>
                {selectedModel.card &&
                  (
                    [
                      "outputSemantics",
                      "population",
                      "outOfScope",
                      "limitations",
                      "inputSchema",
                      "preprocessing",
                      "license",
                    ] as const
                  ).map(
                    (key) =>
                      selectedModel.card![key] && (
                        <section key={key} className="readable-section">
                          <h3>
                            {
                              {
                                outputSemantics: "Output meaning",
                                population: "Population",
                                outOfScope: "Out-of-scope use",
                                limitations: "Limitations",
                                inputSchema: "Input schema",
                                preprocessing: "Preprocessing",
                                license: "Usage rights",
                              }[key]
                            }
                          </h3>
                          <p className="record-text">
                            {selectedModel.card![key]}
                          </p>
                        </section>
                      ),
                  )}
                {selectedModel.card?.source.kind === "huggingface" && (
                  <section className="readable-section">
                    <h3>Declared Hub provenance</h3>
                    <p>
                      {selectedModel.card.source.repoId} ·{" "}
                      {selectedModel.card.source.filename}
                    </p>
                    <p className="hash-text">
                      Commit: {selectedModel.card.source.revision}
                    </p>
                    <p className="subtle">
                      An uploaded artifact pin does not independently prove its
                      repository origin.
                    </p>
                  </section>
                )}
                <details className="provenance">
                  <summary>Version & evidence pins</summary>
                  <p className="hash-text">
                    SHA-256:{" "}
                    {selectedModel.sourceSha256 ??
                      e.artifacts.find((a) => a.id === selectedModel.artifactId)
                        ?.sha256}
                  </p>
                  <p>
                    {selectedModel.registeredAt
                      ? new Date(selectedModel.registeredAt).toLocaleString()
                      : "Legacy registration"}{" "}
                    · {resolve(selectedModel.registeredBy ?? "")}
                  </p>
                </details>
                <section className="readable-section">
                  <h3>Version history</h3>
                  {e.models
                    .filter(
                      (m) =>
                        (m.familyId ?? m.id) ===
                          (selectedModel.familyId ?? selectedModel.id) ||
                        m.name.toLowerCase() ===
                          selectedModel.name.toLowerCase(),
                    )
                    .map((m) => (
                      <button
                        className="attention-row"
                        key={m.id}
                        onClick={() => setSelectedModel(m)}
                      >
                        <span>Version {m.version}</span>
                        <span className="subtle">
                          {m.id === selectedModel.id ? "Current card" : "Open"}
                        </span>
                      </button>
                    ))}
                </section>
                <section className="readable-section">
                  <h3>Evaluations of this version</h3>
                  {e.runs
                    .filter((r) => r.modelId === selectedModel.id)
                    .map((r) => (
                      <button
                        key={r.id}
                        className="attention-row"
                        onClick={() => {
                          setSelectedModel(null);
                          setSelectedRun(r);
                        }}
                      >
                        <span>{new Date(r.createdAt).toLocaleString()}</span>
                        <State value={r.outcome ?? r.state} />
                      </button>
                    ))}
                  {!e.runs.some((r) => r.modelId === selectedModel.id) && (
                    <p className="subtle">No evaluations yet.</p>
                  )}
                </section>
                <div className="ml-footer">
                  <Button
                    variant="outline"
                    onClick={() =>
                      download(
                        selectedModel.name +
                          "-" +
                          selectedModel.version +
                          "-card.md",
                        modelMarkdown(selectedModel),
                        true,
                      )
                    }
                  >
                    <Download size={14} /> Export card
                  </Button>
                  <div className="row-actions">
                    {writer && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          const m = selectedModel;
                          setSelectedModel(null);
                          startRegistration(m);
                        }}
                      >
                        New version
                      </Button>
                    )}
                    {writer &&
                      modelCapability(selectedModel) ===
                        "Saved predictions ready" && (
                        <Button
                          disabled={busy}
                          onClick={() => {
                            const m = selectedModel;
                            setSelectedModel(null);
                            startWizard(m);
                          }}
                        >
                          <Play size={15} />
                          Evaluate this version
                        </Button>
                      )}
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={!!selectedProtocol}
        onOpenChange={(v) => {
          if (!v) setSelectedProtocol(null);
        }}
      >
        {!!selectedProtocol && (
          <DialogContent className="audit-dialog ml-dialog">
            <DialogHeader>
              <DialogTitle>
                {selectedProtocol?.name} · {selectedProtocol?.version}
              </DialogTitle>
              <DialogDescription>
                Immutable evaluation protocol
              </DialogDescription>
            </DialogHeader>
            {selectedProtocol && (
              <>
                <dl className="record-fields">
                  <div>
                    <dt>Task</dt>
                    <dd>{selectedProtocol.task}</dd>
                  </div>
                  <div>
                    <dt>Data role</dt>
                    <dd>{selectedProtocol.datasetContext.split}</dd>
                  </div>
                  {Object.entries(selectedProtocol.config)
                    .filter(([k]) => protocolKeys(selectedProtocol).includes(k))
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{k.replace(/([A-Z])/g, " $1")}</dt>
                        <dd>{String(v) || "Not required"}</dd>
                      </div>
                    ))}
                </dl>
                {selectedProtocol.statistics && (
                  <section className="readable-section">
                    <h3>Pre-registered statistics plan</h3>
                    <ul className="record-list">
                      {describePlan(selectedProtocol.statistics).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <p className="subtle">
                      Plan SHA-256 {planSha256(selectedProtocol.statistics)}.
                      Frozen: a change needs a new protocol version.
                    </p>
                  </section>
                )}
                <section className="readable-section">
                  <h3>Criteria rationale</h3>
                  <p>{selectedProtocol.rationale}</p>
                </section>
                {Object.entries(selectedProtocol.datasetContext)
                  .filter(([k, v]) => k !== "split" && v)
                  .map(([k, v]) => (
                    <section className="readable-section" key={k}>
                      <h3>{k.replace(/([A-Z])/g, " $1")}</h3>
                      <p>{v}</p>
                    </section>
                  ))}
                <div className="ml-footer">
                  <span />
                  <div className="row-actions">
                    {writer &&
                      runnable.some(
                        (m) => m.task === selectedProtocol.task,
                      ) && (
                        <Button
                          disabled={busy}
                          onClick={() => {
                            const p = selectedProtocol;
                            setSelectedProtocol(null);
                            startWizard(
                              runnable.find((m) => m.task === p.task),
                              p,
                            );
                          }}
                        >
                          Use protocol
                        </Button>
                      )}
                    {writer && (
                      <Button
                        variant="outline"
                        disabled={
                          busy ||
                          !runnable.some(
                            (m) => m.task === selectedProtocol.task,
                          )
                        }
                        onClick={() => {
                          const p = selectedProtocol;
                          setSelectedProtocol(null);
                          startWizard(runnable.find((m) => m.task === p.task));
                          setDraft({ ...profileDraft(p), version: "" });
                          setStep(1);
                          setSaveOnly(true);
                        }}
                      >
                        Create revised protocol
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={!!selectedRun}
        onOpenChange={(v) => {
          if (!v) setSelectedRun(null);
        }}
      >
        {!!selectedRun && (
          <DialogContent className="audit-dialog ml-dialog">
            <DialogHeader>
              <DialogTitle>Evaluation results</DialogTitle>
              <DialogDescription>
                {selectedRun?.manifest?.model.name ??
                  (selectedRun && resolve(selectedRun.modelId))}
                {selectedRun?.manifest
                  ? " · Version " + selectedRun.manifest.model.version
                  : ""}
              </DialogDescription>
            </DialogHeader>
            {shownRun &&
              writer &&
              ["failed", "cancelled"].includes(shownRun.state) && (
                <div className="row-actions">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act("retryRun", { runId: shownRun.id })
                        .then(() => {
                          setSelectedRun(null);
                          onView("runs");
                        })
                        .catch(() => {})
                    }
                  >
                    Queue retry with verified inputs
                  </Button>
                  <span className="subtle">
                    Creates a new run; the previous result stays preserved.
                  </span>
                </div>
              )}
            {shownRun && writer && shownRun.state === "queued" && (
              <div className="row-actions">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act("executeRun", { runId: shownRun.id }).catch(
                      () => {},
                    )
                  }
                >
                  <Play size={14} />
                  Start evaluation
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act("cancelRun", { runId: shownRun.id }).catch(
                      () => {},
                    )
                  }
                >
                  Cancel run
                </Button>
                <span className="subtle">
                  Queued with frozen inputs.
                  {shownRun.procedureBinding &&
                    " Start or cancel it before queueing another evaluation of the same procedure."}
                </span>
              </div>
            )}
            {shownRun?.retryOf && (
              <p className="subtle">Retry of {shownRun.retryOf}</p>
            )}
            {shownRun && (
              <RunDetails
                run={shownRun}
                engagement={e}
                resolve={resolve}
                onPaper={(p) => {
                  setSelectedRun(null);
                  onPaper(p);
                }}
              />
            )}
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={!!discard}
        onOpenChange={(v) => {
          if (!v) setDiscard(null);
        }}
      >
        {!!discard && (
          <DialogContent className="audit-dialog">
            <DialogHeader>
              <DialogTitle>Discard this setup?</DialogTitle>
              <DialogDescription>
                Unsaved fields will be lost. Registered cards and saved
                protocols remain in the workspace.
              </DialogDescription>
            </DialogHeader>
            <div className="ml-footer">
              <Button variant="outline" onClick={() => setDiscard(null)}>
                Keep editing
              </Button>
              <Button
                onClick={() => {
                  if (discard === "registration") setRegister(null);
                  else setWizard(false);
                  setDiscard(null);
                }}
              >
                Discard setup
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
function modelMarkdown(m: Model) {
  const source = m.card?.source;
  const sourceText = source
    ? "\n\n## Source\n\nKind: " +
      source.kind +
      (source.kind === "huggingface"
        ? "\n\nRepository: " +
          source.repoId +
          "\n\nCommit: " +
          source.revision +
          "\n\nFile: " +
          source.filename
        : "")
    : "";
  return (
    "# " +
    m.name +
    "\n\nVersion: " +
    m.version +
    "\n\nTask: " +
    m.task +
    "\n\n## Intended use\n\n" +
    m.intendedPurpose +
    "\n\n" +
    (m.card
      ? Object.entries(m.card)
          .filter(([key]) => !["schemaVersion", "source"].includes(key))
          .map(
            ([key, v]) => "## " + key.replace(/([A-Z])/g, " $1") + "\n\n" + v,
          )
          .join("\n\n")
      : "Legacy card; additional declarations not recorded.") +
    sourceText +
    "\n\n## Evidence pin\n\nArtifact: " +
    m.artifactId +
    "\n\nSHA-256: " +
    (m.sourceSha256 ?? "Not captured at registration") +
    "\n\nProvider declarations require independent corroboration.\n"
  );
}
function protocolKeys(p: { task: string; suite: string[] }) {
  return protocolConfigKeys(p.task, p.suite);
}
