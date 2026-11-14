"use client";
// The testing lab: its tabs (datasets, model registry, protocols, evaluations,
// test catalog and GenAI evidence) and the dialogs they open. The state lives
// in useLabSetup.
import { Plus, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { can } from "@/lib/permissions";
import { isClientRole } from "@/lib/workflow-state";
import type { Engagement, Paper, Role } from "@/lib/domain/types";
import { DatasetRegistry } from "../dataset-registry";
import { GenaiEvidence } from "../genai-evidence";
import {
  ClientDatasetPins,
  SpecialCategoryRegister,
} from "../special-category";
import type { PendingLabIntent } from "../workspace/lab-intent";
import type { LabAct } from "./drafts";
import { useLabSetup } from "./use-lab-setup";
import { ModelRegistry } from "./model-registry";
import { ProtocolRegister } from "./protocol-register";
import { EvaluationRegister } from "./evaluation-register";
import { TestCatalog } from "./test-catalog";
import { RegistrationDialog } from "./registration-dialog";
import { EvaluationWizard } from "./evaluation-wizard";
import { ModelCardDialog } from "./model-card-dialog";
import { ProtocolDialog } from "./protocol-dialog";
import { RunDialog } from "./run-dialog";
import { DiscardDialog } from "./discard-dialog";

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
  act: LabAct;
};

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
  const writer = can(role, "queueRun"),
    internal = !isClientRole(role);
  const setup = useLabSetup({
    intent,
    onIntentUsed,
    engagement: e,
    tenantId,
    busy,
    onView,
    onEditorOpen,
    act,
  });
  const { runnable, startWizard } = setup;
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
            {internal && (
              <TabsTrigger value="genai">GenAI evidence</TabsTrigger>
            )}
          </TabsList>
          <div className="row-actions">
            {view === "models" && writer && (
              <>
                <Button variant="ghost" onClick={onEvidence}>
                  Evidence vault
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setup.startRegistration()}
                >
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
          />
        </TabsContent>
        <TabsContent value="models">
          <ModelRegistry
            engagement={e}
            writer={writer}
            busy={busy}
            resolve={resolve}
            onEvidence={onEvidence}
            setup={setup}
          />
        </TabsContent>
        <TabsContent value="protocols">
          <ProtocolRegister
            writer={writer}
            busy={busy}
            onView={onView}
            setup={setup}
          />
        </TabsContent>
        <TabsContent value="runs">
          <EvaluationRegister
            engagement={e}
            role={role}
            writer={writer}
            busy={busy}
            resolve={resolve}
            act={act}
            setup={setup}
          />
        </TabsContent>
        <TabsContent value="catalog">
          <TestCatalog />
        </TabsContent>
        {internal && (
          <TabsContent value="genai">
            {view === "genai" && (
              <GenaiEvidence
                engagement={e}
                tenantId={tenantId}
                role={role}
                onRefresh={onRefresh}
                onEditing={onEditorOpen}
              />
            )}
          </TabsContent>
        )}
      </Tabs>
      <RegistrationDialog engagement={e} busy={busy} setup={setup} />
      <EvaluationWizard
        engagement={e}
        tenantId={tenantId}
        busy={busy}
        resolve={resolve}
        setup={setup}
      />
      <ModelCardDialog
        engagement={e}
        writer={writer}
        busy={busy}
        resolve={resolve}
        setup={setup}
      />
      <ProtocolDialog writer={writer} busy={busy} setup={setup} />
      <RunDialog
        engagement={e}
        writer={writer}
        busy={busy}
        resolve={resolve}
        act={act}
        onView={onView}
        onPaper={onPaper}
        setup={setup}
      />
      <DiscardDialog setup={setup} />
    </div>
  );
}
