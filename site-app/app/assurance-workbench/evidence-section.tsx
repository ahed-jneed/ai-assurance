"use client";

import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OpenForm, RegisterList } from "./types";

/** Evidence: assertions and the precise source locations they cite. */
export function EvidenceSection({
  writer,
  hasArtifacts,
  open,
  list,
  onNavigate,
}: {
  writer: boolean;
  // Whether the engagement has accepted evidence to locate.
  hasArtifacts: boolean;
  open: OpenForm;
  list: RegisterList;
  onNavigate: (s: string) => void;
}) {
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Claims and precise sources</h2>
          <p className="subtle">
            Keep source observations, contradictions and auditor judgment
            distinct.
          </p>
        </div>
        {writer && (
          <div className="row-actions">
            <Button
              variant="outline"
              disabled={!hasArtifacts}
              onClick={() => open("addLocation")}
            >
              <Link2 size={15} />
              Locate evidence
            </Button>
            <Button onClick={() => open("addAssertion")}>
              Record assertion
            </Button>
          </div>
        )}
      </div>
      {list(["assertion"], "No assertions recorded")}
      <h2 className="workbench-subhead">Source locations</h2>
      {list(
        ["location"],
        hasArtifacts
          ? "No source locations recorded"
          : "Accept source evidence in the vault before locating it.",
        writer && !hasArtifacts ? (
          <button type="button" onClick={() => onNavigate("Evidence vault")}>
            Open evidence vault
          </button>
        ) : undefined,
      )}
    </>
  );
}
