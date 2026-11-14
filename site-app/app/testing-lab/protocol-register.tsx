"use client";
// The Protocols tab: the engagement's reusable evaluation protocols.
import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import type { LabSetup } from "./use-lab-setup";

export function ProtocolRegister({
  writer,
  busy,
  onView,
  setup,
}: {
  writer: boolean;
  busy: boolean;
  onView: (view: string) => void;
  setup: LabSetup;
}) {
  const { profiles, runnable } = setup;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Reusable evaluation protocols</h2>
        <span className="subtle">{profiles.length} saved</span>
      </div>
      {profiles.length ? (
        <Table className="protocol-register-table">
          <TableHeader>
            <TableRow>
              {["Protocol / version", "Task", "Procedures", "Actions"].map(
                (s) => (
                  <TableHead key={s}>{s}</TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <button
                    className="paper-link"
                    onClick={() => setup.setSelectedProtocol(p)}
                  >
                    {p.name}
                  </button>
                  <small className="block subtle">Version {p.version}</small>
                </TableCell>
                <TableCell>{p.task}</TableCell>
                <TableCell data-label="Procedures">{p.suite.length}</TableCell>
                <TableCell>
                  {writer && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        busy || !runnable.some((m) => m.task === p.task)
                      }
                      onClick={() =>
                        setup.startWizard(
                          runnable.find((m) => m.task === p.task),
                          p,
                        )
                      }
                    >
                      Use protocol
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="ml-empty">
          <FileCheck2 size={25} />
          <h3>No protocols yet</h3>
          <p>
            {runnable.length
              ? "Save a protocol to reuse its data mappings and acceptance criteria."
              : "Register a saved-prediction model before creating a protocol."}
          </p>
          {!runnable.length && (
            <Button variant="outline" onClick={() => onView("models")}>
              Open model registry
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
