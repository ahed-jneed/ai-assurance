"use client";
// The Evaluations tab: every run of the engagement, newest first, with the
// commands its state allows.
import { Download, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { can } from "@/lib/permissions";
import type { Engagement, Role } from "@/lib/domain";
import type { LabAct } from "./drafts";
import { State } from "./lab-ui";
import { download } from "./model-helpers";
import type { LabSetup } from "./use-lab-setup";

export function EvaluationRegister({
  engagement: e,
  role,
  writer,
  busy,
  resolve,
  act,
  setup,
}: {
  engagement: Engagement;
  role: Role;
  writer: boolean;
  busy: boolean;
  resolve: (id: string) => string;
  act: LabAct;
  setup: LabSetup;
}) {
  return (
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
                      onClick={() => setup.setSelectedRun(r)}
                    >
                      {r.manifest?.model.name ?? resolve(r.modelId)} ·{" "}
                      {r.manifest?.model.version ?? "legacy"}
                    </button>
                    <small className="block subtle">
                      {r.manifest?.profile?.name ?? "Explicit configuration"} ·{" "}
                      {r.suite.length} procedures
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
                        onClick={() => setup.setSelectedRun(r)}
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
                      {can(role, "recoverRun") && r.state === "running" && (
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
            {setup.runnable.length
              ? "Choose a registered version, map its data and review the criteria before running."
              : "Register a saved-prediction model to start testing."}
          </p>
        </div>
      )}
    </section>
  );
}
