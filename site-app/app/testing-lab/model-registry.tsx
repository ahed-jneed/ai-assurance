"use client";
// The Model registry tab: every registered model version and what it can do.
import { Play, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import type { Engagement } from "@/lib/domain";
import { modelCapability } from "./model-helpers";
import type { LabSetup } from "./use-lab-setup";

export function ModelRegistry({
  engagement: e,
  writer,
  busy,
  resolve,
  onEvidence,
  setup,
}: {
  engagement: Engagement;
  writer: boolean;
  busy: boolean;
  resolve: (id: string) => string;
  onEvidence: () => void;
  setup: LabSetup;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Model versions</h2>
        <span className="subtle">
          {e.models.length} {e.models.length === 1 ? "version" : "versions"}
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
                    onClick={() => setup.setSelectedModel(m)}
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
                  <span className="badge neutral">{modelCapability(m)}</span>
                </TableCell>
                <TableCell>
                  {writer &&
                    modelCapability(m) === "Saved predictions ready" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setup.startWizard(m)}
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
            Accept a prediction CSV in Evidence, then register its model card.
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
  );
}
