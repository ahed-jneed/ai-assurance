"use client";
// One saved evaluation protocol: its criteria, frozen plan and dataset
// context, with the commands to reuse or revise it.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { protocolConfigKeys } from "@/lib/evaluation";
import { describePlan } from "@/lib/hosted-statistics";
import { planSha256 } from "@/lib/statistics";
import { profileDraft } from "./drafts";
import type { LabSetup } from "./use-lab-setup";

export function ProtocolDialog({
  writer,
  busy,
  setup,
}: {
  writer: boolean;
  busy: boolean;
  setup: LabSetup;
}) {
  const { selectedProtocol, setSelectedProtocol, runnable } = setup;
  return (
    <Dialog
      open={!!selectedProtocol}
      onOpenChange={(v) => {
        if (!v) setSelectedProtocol(null);
      }}
    >
      {selectedProtocol && (
        <DialogContent className="audit-dialog ml-dialog">
          <DialogHeader>
            <DialogTitle>
              {selectedProtocol.name} · {selectedProtocol.version}
            </DialogTitle>
            <DialogDescription>Immutable evaluation protocol</DialogDescription>
          </DialogHeader>
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
              .filter(([k]) =>
                protocolConfigKeys(
                  selectedProtocol.task,
                  selectedProtocol.suite,
                ).includes(k),
              )
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
                Plan SHA-256 {planSha256(selectedProtocol.statistics)}. Frozen:
                a change needs a new protocol version.
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
                runnable.some((m) => m.task === selectedProtocol.task) && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      const p = selectedProtocol;
                      setSelectedProtocol(null);
                      setup.startWizard(
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
                    !runnable.some((m) => m.task === selectedProtocol.task)
                  }
                  onClick={() => {
                    const p = selectedProtocol;
                    setSelectedProtocol(null);
                    setup.startWizard(runnable.find((m) => m.task === p.task));
                    setup.setDraft({ ...profileDraft(p), version: "" });
                    setup.setStep(1);
                    setup.setSaveOnly(true);
                  }}
                >
                  Create revised protocol
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
