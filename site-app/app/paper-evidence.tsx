"use client";
import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { requestLabel } from "@/lib/evidence-requests";
import { paperEvidenceReferences } from "@/lib/auditor-workflow";
import type { Artifact, Paper, EvidenceRequest } from "@/lib/domain/types";
export function PaperEvidence({
  paper,
  artifacts,
  editable,
  busy,
  setDraft,
  onVault,
  onEvidence,
  onRequest,
  requests,
  onRequestRecord,
}: {
  paper: Paper;
  artifacts: Artifact[];
  editable: boolean;
  busy: boolean;
  setDraft: React.Dispatch<React.SetStateAction<Paper | null>>;
  onVault: () => void;
  onEvidence: (id: string) => void;
  onRequest: () => void;
  requests: EvidenceRequest[];
  onRequestRecord: (r: EvidenceRequest) => void;
}) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [view, setView] = useState(paper.evidenceIds.length ? "linked" : "all"),
    [shownPaper, setShownPaper] = useState(paper.id);
  // Another paper opens with fresh filters; the initial view is chosen only
  // then, not when the open paper's evidence links change.
  if (shownPaper !== paper.id) {
    setShownPaper(paper.id);
    setQuery("");
    setCategory("all");
    setView(paper.evidenceIds.length ? "linked" : "all");
  }
  const accepted = artifacts.filter((a) => a.status === "accepted"),
    linked = paperEvidenceReferences(paper, artifacts),
    blocked = linked.filter((r) => r.artifact?.status !== "accepted");
  const candidates =
    view === "linked" || !editable
      ? linked
      : accepted.map((artifact) => ({ id: artifact.id, artifact }));
  const shown = candidates.filter(
    (r) =>
      (category === "all" || r.artifact?.category === category) &&
      (r.artifact?.name ?? r.id)
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  function toggle(id: string, value: boolean) {
    setDraft((p) =>
      p
        ? {
            ...p,
            evidenceIds: value
              ? [...new Set([...p.evidenceIds, id])]
              : p.evidenceIds.filter((ref) => ref !== id),
          }
        : p,
    );
  }
  function evidenceRow(r: (typeof linked)[number]) {
    const unavailable = r.artifact?.status !== "accepted",
      status = r.artifact?.status ?? "missing";
    return (
      <div
        className={
          "check-row evidence-choice " +
          (unavailable ? "evidence-unavailable" : "")
        }
        key={r.id}
      >
        <Checkbox
          aria-label={
            (paper.evidenceIds.includes(r.id) ? "Unlink " : "Link ") +
            (r.artifact?.name ?? r.id)
          }
          disabled={!editable || busy}
          checked={paper.evidenceIds.includes(r.id)}
          onCheckedChange={(value) => toggle(r.id, !!value)}
        />
        <span>
          {r.artifact?.name ?? "Evidence reference unavailable"}
          <small>{r.artifact?.category ?? r.id}</small>
        </span>
        <span className={"badge " + (unavailable ? "amber" : "neutral")}>
          {status === "missing"
            ? "Unavailable"
            : status === "unverified"
              ? "Awaiting acceptance"
              : status === "quarantined"
                ? "Quarantined"
                : "Accepted"}
        </span>
        {r.artifact && (
          <Button
            type="button"
            className="paper-evidence-open"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={"View evidence: " + r.artifact.name}
            onClick={() => onEvidence(r.id)}
          >
            View evidence
          </Button>
        )}
      </div>
    );
  }
  return (
    <section
      className="document-section paper-evidence"
      data-paper-target="evidence"
      tabIndex={-1}
    >
      <h3>
        Linked evidence <span className="count-label">{linked.length}</span>
        {editable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="paper-request-button"
            disabled={busy}
            onClick={onRequest}
          >
            Request evidence
          </Button>
        )}
      </h3>
      {!!requests.length && (
        <div className="paper-evidence-requests">
          {requests.map((r) => (
            <button
              type="button"
              className="linked-record"
              key={r.id}
              onClick={() => onRequestRecord(r)}
            >
              <span>
                <b>{r.subject}</b>
                <small>
                  Evidence request · {requestLabel(r)} · Due {r.dueDate}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      {!!blocked.length && (
        <div className="linked-evidence-alert">
          <AlertCircle size={16} />
          <span>
            {blocked.length} linked{" "}
            {blocked.length === 1 ? "reference needs" : "references need"}{" "}
            attention before submission.
          </span>
          {editable && (
            <Button type="button" variant="ghost" size="sm" onClick={onVault}>
              Open vault
            </Button>
          )}
        </div>
      )}
      {editable && !!accepted.length && (
        <div className="evidence-picker-tools">
          <div className="evidence-views" aria-label="Evidence selection views">
            {[
              ["linked", "Linked"],
              ["all", "All accepted"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <Input
            aria-label="Find evidence"
            placeholder="Find a file…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label="Evidence category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {[
                ...new Set(
                  candidates
                    .map((r) => r.artifact?.category)
                    .filter((c): c is string => !!c),
                ),
              ].map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {editable && view === "all" && blocked.map(evidenceRow)}
      {shown.map(evidenceRow)}
      {!shown.length && (
        <div className="evidence-selection-empty">
          <p className="subtle">
            {query || category !== "all"
              ? "No files match these filters."
              : view === "linked"
                ? "No evidence linked yet."
                : !accepted.length
                  ? "Upload and accept evidence before linking it."
                  : "No evidence included."}
          </p>
          {editable &&
            (!accepted.length ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onVault}
              >
                Open evidence vault
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setView("all");
                  setQuery("");
                  setCategory("all");
                }}
              >
                Browse accepted evidence
              </Button>
            ))}
        </div>
      )}
      {!!linked.length && (
        <p className="evidence-judgement-note">
          File acceptance covers handling. Assess relevance, sufficiency and
          limitations in the paper.
        </p>
      )}
    </section>
  );
}
