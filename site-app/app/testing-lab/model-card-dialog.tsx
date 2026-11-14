"use client";
// The registered model card of one version: its declarations, evidence pins,
// version history and evaluations.
import { Download, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Engagement } from "@/lib/domain/types";
import { State } from "./lab-ui";
import { download, modelCapability, modelMarkdown } from "./model-helpers";
import type { LabSetup } from "./use-lab-setup";

const cardSections = {
  outputSemantics: "Output meaning",
  population: "Population",
  outOfScope: "Out-of-scope use",
  limitations: "Limitations",
  inputSchema: "Input schema",
  preprocessing: "Preprocessing",
  license: "Usage rights",
} as const;

export function ModelCardDialog({
  engagement: e,
  writer,
  busy,
  resolve,
  setup,
}: {
  engagement: Engagement;
  writer: boolean;
  busy: boolean;
  resolve: (id: string) => string;
  setup: LabSetup;
}) {
  const { selectedModel, setSelectedModel } = setup;
  return (
    <Dialog
      open={!!selectedModel}
      onOpenChange={(v) => {
        if (!v) setSelectedModel(null);
      }}
    >
      {selectedModel && (
        <DialogContent className="audit-dialog ml-dialog">
          <DialogHeader>
            <DialogTitle>
              {selectedModel.name} · {selectedModel.version}
            </DialogTitle>
            <DialogDescription>
              Registered model card · {modelCapability(selectedModel)}
            </DialogDescription>
          </DialogHeader>
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
              <dd>{selectedModel.card?.framework ?? selectedModel.format}</dd>
            </div>
          </dl>
          <section className="readable-section">
            <h3>Intended use</h3>
            <p>{selectedModel.intendedPurpose}</p>
          </section>
          {selectedModel.card &&
            (Object.keys(cardSections) as (keyof typeof cardSections)[]).map(
              (key) =>
                selectedModel.card![key] && (
                  <section key={key} className="readable-section">
                    <h3>{cardSections[key]}</h3>
                    <p className="record-text">{selectedModel.card![key]}</p>
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
                  m.name.toLowerCase() === selectedModel.name.toLowerCase(),
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
                    setup.setSelectedRun(r);
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
                  selectedModel.name + "-" + selectedModel.version + "-card.md",
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
                    setup.startRegistration(m);
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
                      setup.startWizard(m);
                    }}
                  >
                    <Play size={15} />
                    Evaluate this version
                  </Button>
                )}
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
