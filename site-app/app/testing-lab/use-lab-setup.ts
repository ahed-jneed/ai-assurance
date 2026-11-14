"use client";
// The testing lab's state: the open records, the model registration form and
// the evaluation setup (its dataset inspection, protocol draft and the
// commands that save and run it).
import { useEffect, useEffectEvent, useState } from "react";
import { useAssuranceQuery } from "@/hooks/use-assurance-query";
import { fetchJson } from "@/lib/fetch-json";
import { recordsQuery } from "@/lib/assurance-query";
import type { AssuranceRecord } from "@/lib/assurance-core";
import { datasetCardFor } from "@/lib/dataset-card";
import { tests, fairnessSelected } from "@/lib/evaluation";
import type {
  Engagement,
  EvaluationConfig,
  EvaluationProfile,
  Model,
  ModelCard,
  Run,
} from "@/lib/domain/types";
import type { PlanForm } from "@/lib/hosted-statistics";
import {
  basisFor,
  type SpecialCategoryDeclarationInput,
} from "@/lib/special-category";
import { declarationFor } from "../special-category";
import {
  resolveLabIntent,
  type PendingLabIntent,
} from "../workspace/lab-intent";
import {
  draftPlan,
  emptyCard,
  emptyDraft,
  profileDraft,
  profileRequest,
  type Draft,
  type Inspection,
  type LabAct,
  type ProcedureBinding,
} from "./drafts";
import { modelCapability } from "./model-helpers";
import { stepError } from "./step-error";

const datasetCards = recordsQuery("dataset"),
  noCards: AssuranceRecord[] = [];

export type LabSetupOptions = {
  intent: PendingLabIntent | null;
  onIntentUsed: (intent: PendingLabIntent) => void;
  engagement: Engagement;
  tenantId: string;
  busy: boolean;
  onView: (view: string) => void;
  onEditorOpen: (open: boolean) => void;
  act: LabAct;
};
export type LabSetup = ReturnType<typeof useLabSetup>;

export function useLabSetup({
  intent,
  onIntentUsed,
  engagement: e,
  tenantId,
  busy,
  onView,
  onEditorOpen,
  act,
}: LabSetupOptions) {
  const [register, setRegister] = useState<Partial<Model> | null>(null),
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
  // Belongs to the open setup only: every other evaluation starts unbound.
  const [binding, setBinding] = useState<ProcedureBinding | null>(null);
  // The dataset cards, shared with the dataset registry (one read per
  // engagement version).
  const cards =
    useAssuranceQuery(
      { tenantId, engagementId: e.id, version: e.version },
      datasetCards,
    ).data ?? noCards;
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
  // Applies each hand-off once, when it arrives, against the engagement as it
  // is then; an engagement refresh does not apply it again.
  const applyIntent = useEffectEvent((next: NonNullable<typeof intent>) => {
    const action = resolveLabIntent(next, e);
    if (action.kind === "evaluate")
      startWizard(action.model, action.profile, false, {
        procedureId: action.procedureId,
        datasetCardRecordId: action.datasetCardRecordId,
      });
    else if (action.kind === "showRun") {
      onView("runs");
      setSelectedRun(action.run);
    }
    onIntentUsed(next);
  });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a hand-off is a one-time event from another view; it is consumed (onIntentUsed) in the parent, which cannot happen during this render
    if (intent) applyIntent(intent);
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
  // Another model (or reopening the setup) clears the previous inspection
  // while the model's dataset is read, in the render that switches.
  const artifactId = model?.artifactId,
    inspectKey =
      wizard && artifactId !== undefined
        ? JSON.stringify([modelId, artifactId, e.id, tenantId])
        : "",
    [inspectedFor, setInspectedFor] = useState("");
  if (inspectedFor !== inspectKey) {
    setInspectedFor(inspectKey);
    if (inspectKey) {
      setInspect(null);
      setInspecting(true);
    }
  }
  // Applies an inspection with the profile chosen when it arrives; picking a
  // profile does not inspect the dataset again.
  const applyInspection = useEffectEvent((value: Inspection) => {
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
  });
  const engagementId = e.id;
  useEffect(() => {
    if (!wizard || artifactId === undefined) return;
    let active = true;
    const controller = new AbortController();
    fetchJson<Inspection>(
      "/api/evaluation/dataset?" +
        new URLSearchParams({
          tenantId,
          engagementId,
          artifactId,
        }),
      { signal: controller.signal },
    )
      .then((value) => {
        if (active) applyInspection(value);
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
  }, [wizard, modelId, artifactId, engagementId, tenantId]);
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
  function currentStepError() {
    return stepError({
      step,
      model,
      draft,
      inspect,
      fair,
      locked,
      planned,
      saveOnly,
      special,
      hostedRoute,
      acknowledged,
    });
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
  const runnable = e.models.filter(
    (m) => modelCapability(m) === "Saved predictions ready",
  );
  // The selected run as the engagement now holds it, so starting, cancelling
  // or completing it updates the open dialog.
  const shownRun =
    selectedRun && (e.runs.find((r) => r.id === selectedRun.id) ?? selectedRun);
  return {
    // Records open in a dialog.
    selectedModel,
    setSelectedModel,
    selectedRun,
    setSelectedRun,
    shownRun,
    selectedProtocol,
    setSelectedProtocol,
    // The model registration form.
    register,
    setRegister,
    card,
    setCard,
    startRegistration,
    registerVersion,
    // Shared by both setups.
    error,
    setError,
    setTouched,
    discard,
    setDiscard,
    closeSetup,
    setWizard,
    // The evaluation setup.
    wizard,
    step,
    setStep,
    modelId,
    setModelId,
    profileId,
    setProfileId,
    draft,
    setDraft,
    config,
    planForm,
    inspect,
    inspecting,
    saveOnly,
    setSaveOnly,
    declaration,
    setDeclaration,
    acknowledged,
    setAcknowledged,
    binding,
    startWizard,
    runEvaluation,
    stepError: currentStepError,
    // Derived from the engagement and the draft.
    model,
    profiles,
    locked,
    runnable,
    planned,
    selectedTests,
    fair,
    savedDeclaration,
    special,
    cols,
  };
}
