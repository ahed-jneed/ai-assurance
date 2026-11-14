"use client";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Paper } from "@/lib/domain";
import type { Procedure } from "@/lib/workflow-types";
import { currentExecution, procedureLabel } from "@/lib/workflow-state";
import { ProcedureContext } from "../procedure-context";
import { label } from "./fields";
import { ProcedureExecute } from "./procedure-execute";
import { ProcedurePlan } from "./procedure-plan";
import { ProcedureReview } from "./procedure-review";
import type { ProgramScope } from "./program-scope";
/**
 * The selected procedure's sheet: plan, actual execution, evidence
 * assessment and independent review.
 */
export function ProcedureSheet({
  scope,
  p,
  editing,
  section,
  onSection: setSection,
  onLeave,
  onLocation,
  onRecord,
  onContext,
  onPaper,
  onRequest,
  onFinding,
  onQueuedRun,
}: {
  scope: ProgramScope;
  p: Procedure | undefined;
  /** A form is open over the sheet. */
  editing: boolean;
  section: string;
  onSection: (section: string) => void;
  /** Clears the selected procedure. */
  onLeave: () => void;
  onLocation: (id: string | undefined, section: string) => void;
  onRecord: (title: string, value: unknown) => void;
  onContext: (id: string) => void;
  onPaper: (p: Paper) => void;
  onRequest: (p: Paper) => void;
  onFinding: (p: Procedure) => void;
  onQueuedRun: (procedureId: string, runId: string) => void;
}) {
  const { data, e, w, busy, act, writer, warningCards } = scope,
    { evaluate } = scope.forms;
  return (
    <Sheet
      open={!!p}
      onOpenChange={(v) => {
        if (!v && !editing) {
          onLeave();
          onLocation(undefined, section);
        }
      }}
    >
      {p && (
        <SheetContent
          side="right"
          className="paper-sheet expanded workflow-procedure"
        >
          <SheetDescription className="sr-only">
            Procedure plan, actual execution, evidence assessment and
            independent review.
          </SheetDescription>
          <div className="peek-bar">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onLeave();
                onLocation(undefined, section);
              }}
            >
              <ArrowLeft size={14} />
              Back to program
            </Button>
            <span>
              {p.templateId} · plan revision {p.revision} · assignment{" "}
              {p.assignmentRevision ?? 1}
            </span>
          </div>
          <div className="sheet-scroll">
            <div className="document-page">
              <SheetTitle className="document-title">{p.title}</SheetTitle>
              <p className="subtle">{procedureLabel(e, p)}</p>
              {warningCards((id) => id === p.id)}
              <ProcedureContext
                tenantId={data.tenantId}
                engagement={e}
                procedure={p}
                onRecord={onRecord}
              />
              <Tabs value={section} onValueChange={setSection}>
                <TabsList>
                  <TabsTrigger value="plan">Plan</TabsTrigger>
                  <TabsTrigger value="execute">Execute</TabsTrigger>
                  <TabsTrigger value="evaluate">Evaluate</TabsTrigger>
                  <TabsTrigger value="review">Review</TabsTrigger>
                </TabsList>
                <TabsContent value="plan">
                  <ProcedurePlan scope={scope} p={p} />
                </TabsContent>
                <TabsContent value="execute">
                  <ProcedureExecute
                    scope={scope}
                    p={p}
                    onLeave={onLeave}
                    onContext={onContext}
                    onRequest={onRequest}
                    onQueuedRun={onQueuedRun}
                  />
                </TabsContent>
                <TabsContent value="evaluate">
                  {p.execution?.assessment ? (
                    Object.entries({
                      relevance: p.execution.assessment.relevance,
                      reliability: p.execution.assessment.reliability,
                      coverage: p.execution.assessment.coverage,
                      contradictions: p.execution.assessment.contradictions,
                      conclusion: p.execution.assessment.conclusion,
                    }).map(([k, v]) => (
                      <section className="readable-section" key={k}>
                        <h3>{label(k)}</h3>
                        <p className="record-text">{v}</p>
                      </section>
                    ))
                  ) : (
                    <p className="empty-result">
                      Evaluate relevance, reliability, coverage and
                      contradictory evidence before reaching a conclusion.
                    </p>
                  )}
                  <div className="row-actions">
                    {writer && (
                      <Button
                        disabled={
                          busy ||
                          !p.execution ||
                          !currentExecution(e, p) ||
                          p.state === "submitted" ||
                          w.program.status !== "approved"
                        }
                        onClick={() => evaluate(p)}
                      >
                        Evaluate evidence
                      </Button>
                    )}
                    {writer && p.state === "evaluated" && (
                      <Button
                        variant="outline"
                        disabled={busy || !currentExecution(e, p)}
                        onClick={() =>
                          void act("submitProcedure", { procedureId: p.id })
                            .then(() => setSection("review"))
                            .catch(() => {})
                        }
                      >
                        Compile paper & send for review
                      </Button>
                    )}
                  </div>
                  {writer && p.execution && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        onContext(p.id);
                        onLeave();
                        onFinding(p);
                      }}
                    >
                      Prepare finding from this procedure
                    </Button>
                  )}
                  <p className="subtle workflow-note">
                    Compilation creates a working-paper revision from this
                    execution and your evaluation. Existing signed revisions
                    remain preserved.
                  </p>
                </TabsContent>
                <TabsContent value="review">
                  <ProcedureReview
                    scope={scope}
                    p={p}
                    onLeave={onLeave}
                    onContext={onContext}
                    onPaper={onPaper}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}
