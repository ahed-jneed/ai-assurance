"use client";
import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Paper } from "@/lib/domain/types";
import type { Procedure } from "@/lib/workflow-types";
import { revisionWarnings } from "@/lib/workflow-state";
import { can } from "@/lib/permissions";
import type { WorkspaceData } from "../workspace-types";
import { AcceptancePanel } from "./acceptance-panel";
import { art50Suggestions } from "./art50-suggestion";
import { BriefPanel } from "./brief-panel";
import { FollowupPanel } from "./followup-panel";
import { ProcedureSheet } from "./procedure-sheet";
import { programForms } from "./program-forms";
import { ProgramPanel } from "./program-panel";
import type { ProgramScope } from "./program-scope";
import { ReviewInbox } from "./review-inbox";
import { useProgramLocation } from "./use-program-location";
import { WorkflowDialog, type Form, type WorkflowAct } from "./workflow-dialog";
import { WorkflowSpine } from "./workflow-spine";

export function AuditProgram({
  data,
  busy,
  act,
  onPaper,
  onRequest,
  onNavigate,
  onEditing,
  initialProcedure,
  initialSection,
  onLocation,
  onRecord,
  onFollowup,
  onContext,
  onFinding,
  onQueuedRun,
}: {
  onFinding: (p: Procedure) => void;
  onContext: (id: string) => void;
  /** A planned evaluation of the procedure was queued as `runId`. */
  onQueuedRun: (procedureId: string, runId: string) => void;
  data: WorkspaceData;
  busy: boolean;
  act: WorkflowAct;
  onPaper: (p: Paper) => void;
  onRequest: (p: Paper) => void;
  onNavigate: (v: string) => void;
  onEditing: (v: boolean) => void;
  initialProcedure?: string;
  initialSection?: string;
  onLocation: (id: string | undefined, section: string) => void;
  onRecord: (title: string, value: unknown) => void;
  onFollowup: (id: string) => void;
}) {
  const e = data.engagement!,
    w = e.workflow,
    uid = data.identity.id,
    role = data.identity.role,
    // Coarse flags for the program's sections; decisions check their own op.
    writer = can(role, "recordProcedureExecution"),
    lead = can(role, "approveAcceptance"),
    reviewer = can(role, "reviewProcedure");
  const [form, setForm] = useState<Form | null>(null),
    [batchIds, setBatchIds] = useState<string[]>([]);
  const {
    tab,
    setTab,
    query,
    setQuery,
    filter,
    setFilter,
    selected,
    setSelected,
    section,
    setSection,
  } = useProgramLocation({
    memoryKey: data.tenantId + ":" + uid + ":" + e.id,
    w,
    initialProcedure,
    initialSection,
    onLocation,
    editing: !!form,
  });
  const p = w?.procedures.find((p) => p.id === selected);
  const name = (id: string) =>
    data.people.find((m) => m.user_id === id)?.display_name ??
    (id ? "Unknown or inactive member" : "Unassigned");
  // The applicability the classification suggests for an Art 50 paper
  // (#120), dated against the engagement period (#152); never applied
  // without the auditor saving the plan.
  const suggestionFor = art50Suggestions(data, e),
    catalogItem = (templateId: string) =>
      data.catalog?.items.find((i) => i.id === templateId),
    art50Suggestion = (p: Procedure) => suggestionFor(p.templateId);
  const forms = programForms({ data, act, setForm, batchIds, setBatchIds });
  if (!w)
    return (
      <section className="workflow-start">
        <ClipboardList size={30} />
        <h2>Set up the audit program</h2>
        <p>
          Review scope, select the procedures that apply, then carry each
          procedure through execution and independent review.
        </p>
        <p className="subtle">
          Existing papers and signatures stay in their history. Adoption links
          them to draft methodology candidates for a fresh scope review.
        </p>
        {lead ? (
          <Button
            disabled={busy}
            onClick={() => void act("adoptWorkflow", {}).catch(() => {})}
          >
            Adopt workflow
          </Button>
        ) : (
          <p>A Lead Auditor can adopt the workflow for this engagement.</p>
        )}
      </section>
    );
  const warnings = revisionWarnings(w, data.metadataBytes);
  const warningCards = (show: (id: string) => boolean) =>
    warnings
      .filter((x) => show(x.recordId ?? x.id))
      .map((x) => (
        <p className="warning-card" role="status" key={x.id}>
          {x.message}
        </p>
      ));
  const scope: ProgramScope = {
    data,
    e,
    w,
    uid,
    role,
    busy,
    act,
    writer,
    lead,
    reviewer,
    name,
    forms,
    warningCards,
    art50Suggestion,
    catalogItem,
  };
  const open = (id: string, at: string) => {
    setSelected(id);
    setSection(at);
  };
  return (
    <>
      <WorkflowSpine
        scope={scope}
        onTab={setTab}
        onFilter={setFilter}
        onNavigate={onNavigate}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="program">Program</TabsTrigger>
          <TabsTrigger value="acceptance">Acceptance</TabsTrigger>
          <TabsTrigger value="brief">Engagement brief</TabsTrigger>
          <TabsTrigger value="review">Review inbox</TabsTrigger>
          <TabsTrigger value="followup">Follow-up</TabsTrigger>
        </TabsList>
        <TabsContent value="acceptance">
          <AcceptancePanel data={data} busy={busy} act={act} onForm={setForm} />
        </TabsContent>
        <TabsContent value="brief">
          <BriefPanel scope={scope} />
        </TabsContent>
        <TabsContent value="program">
          <ProgramPanel
            scope={scope}
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
            batchIds={batchIds}
            onBatch={setBatchIds}
            onOpen={open}
          />
        </TabsContent>
        <TabsContent value="review">
          <ReviewInbox
            scope={scope}
            onTab={setTab}
            onOpen={open}
            onPaper={onPaper}
          />
        </TabsContent>
        <TabsContent value="followup">
          <FollowupPanel scope={scope} onFollowup={onFollowup} />
        </TabsContent>
      </Tabs>
      <ProcedureSheet
        scope={scope}
        p={p}
        editing={!!form}
        section={section}
        onSection={setSection}
        onLeave={() => setSelected(undefined)}
        onLocation={onLocation}
        onRecord={onRecord}
        onContext={onContext}
        onPaper={onPaper}
        onRequest={onRequest}
        onFinding={onFinding}
        onQueuedRun={onQueuedRun}
      />
      <WorkflowDialog
        form={form}
        onClose={() => setForm(null)}
        busy={busy}
        onEditing={onEditing}
      />
    </>
  );
}
