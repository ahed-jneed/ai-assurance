"use client";
// The evaluation setup dialog: a four-step stepper (model, data, procedures,
// review) that saves a protocol and, unless it only saves, queues and starts
// the run.
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Engagement } from "@/lib/domain/types";
import type { LabSetup } from "./use-lab-setup";
import { ModelStep } from "./wizard-model-step";
import { DataStep } from "./wizard-data-step";
import { ProceduresStep } from "./wizard-procedures-step";
import { ReviewStep } from "./wizard-review-step";

const steps = ["Model", "Data", "Procedures", "Review"];

export function EvaluationWizard({
  engagement,
  tenantId,
  busy,
  resolve,
  setup,
}: {
  engagement: Engagement;
  tenantId: string;
  busy: boolean;
  resolve: (id: string) => string;
  setup: LabSetup;
}) {
  const { wizard, step, setStep, saveOnly, locked, error, inspecting } = setup;
  return (
    <Dialog
      open={wizard}
      onOpenChange={(v) => {
        if (!v) setup.closeSetup("wizard");
      }}
    >
      {wizard && (
        <DialogContent className="audit-dialog ml-dialog">
          <DialogHeader>
            <DialogTitle>
              {saveOnly ? "Create evaluation protocol" : "Configure evaluation"}
            </DialogTitle>
            <DialogDescription>
              {locked
                ? "Reuse an immutable protocol. Create a new version to change its criteria."
                : "Map evidence, choose procedures, then review the frozen request."}
            </DialogDescription>
          </DialogHeader>
          <ol className="ml-stepper">
            {steps.map((label, i) => (
              <li
                className={step === i ? "active" : step > i ? "complete" : ""}
                aria-current={step === i ? "step" : undefined}
                key={label}
              >
                <span aria-hidden="true">{i + 1}</span>
                {label}
                {step > i && <span className="sr-only">, complete</span>}
              </li>
            ))}
          </ol>
          <form
            onChange={() => setup.setTouched(true)}
            onSubmit={(ev) => {
              ev.preventDefault();
              const message = setup.stepError();
              if (message) setup.setError(message);
              else if (step < 3) {
                setup.setError("");
                setStep(step + 1);
              } else void setup.runEvaluation();
            }}
          >
            <fieldset disabled={busy || inspecting}>
              {step === 0 && (
                <ModelStep
                  engagement={engagement}
                  resolve={resolve}
                  setup={setup}
                />
              )}
              {step === 1 && <DataStep setup={setup} />}
              {step === 2 && (
                <ProceduresStep engagement={engagement} setup={setup} />
              )}
              {step === 3 && (
                <ReviewStep
                  engagement={engagement}
                  tenantId={tenantId}
                  busy={busy}
                  resolve={resolve}
                  setup={setup}
                />
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
                    step ? setStep(step - 1) : setup.closeSetup("wizard")
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
  );
}
