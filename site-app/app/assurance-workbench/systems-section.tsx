"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OpenForm, RegisterList } from "./types";

/** Systems: system revisions, prediction lineage and registry snapshots. */
export function SystemsSection({
  writer,
  hasModels,
  hasDatasets,
  canLinkPredictions,
  open,
  list,
  onNavigate,
}: {
  writer: boolean;
  hasModels: boolean;
  // Whether the engagement has an accepted dataset.
  hasDatasets: boolean;
  canLinkPredictions: boolean;
  open: OpenForm;
  list: RegisterList;
  onNavigate: (s: string) => void;
}) {
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Test the complete system</h2>
          <p className="subtle">
            Version the pipeline, inputs, outputs and human decision process
            together.
          </p>
        </div>
        {writer && (
          <Button disabled={!hasModels} onClick={() => open("registerSystem")}>
            <Plus size={15} />
            Register system
          </Button>
        )}
      </div>
      {writer && !hasModels && (
        <div className="workbench-notice">
          <div>
            <b>Register a model first</b>
            <p>
              A system revision needs a model version and its supporting
              artifact.
            </p>
            <Button variant="ghost" onClick={() => onNavigate("Testing lab")}>
              Open model registry
            </Button>
          </div>
        </div>
      )}
      {list(
        ["system"],
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
        ["prediction"],
        canLinkPredictions
          ? "No prediction lineage recorded"
          : "Linking predictions requires a system revision, model version and accepted dataset.",
        writer && !hasDatasets ? (
          <button type="button" onClick={() => onNavigate("Evidence vault")}>
            Open evidence vault
          </button>
        ) : undefined,
      )}
      <div className="section-toolbar">
        <h2>Registry snapshots</h2>
        {writer && (
          <Button variant="outline" onClick={() => open("importPacket")}>
            Import MLflow / Hub snapshot
          </Button>
        )}
      </div>
      {list(["registry"], "No registry snapshots imported")}
    </>
  );
}
