"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { Engagement, EvidenceRequest } from "@/lib/domain";
export function EvidenceRequestForm({
  mode,
  request: r,
  engagement: e,
  choices,
  checks,
  onChoice,
  onCheck,
}: {
  mode: string;
  request?: EvidenceRequest;
  engagement: Engagement;
  choices: Record<string, string>;
  checks: Record<string, boolean>;
  onChoice: (key: string, value: string) => void;
  onCheck: (key: string, value: boolean) => void;
}) {
  const [paperQuery, setPaperQuery] = useState(""),
    [fileQuery, setFileQuery] = useState("");
  const paperCount = Object.keys(checks).filter(
    (key) => key.startsWith("paper:") && checks[key],
  ).length;
  const accepted =
    !!r?.evidenceIds.length &&
    r.evidenceIds.every((id) =>
      e.artifacts.some((a) => a.id === id && a.status === "accepted"),
    );
  const select = (
    label: string,
    key: string,
    values: { value: string; label: string }[],
  ) => (
    <label>
      {label}
      <Select
        value={choices[key] || ""}
        onValueChange={(v) => onChoice(key, v)}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder="Choose a decision" />
        </SelectTrigger>
        <SelectContent>
          {values.map((v) => (
            <SelectItem key={v.value} value={v.value}>
              {v.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
  if (["request", "requestEdit"].includes(mode))
    return (
      <>
        <label>
          Requested evidence
          <Input
            name="subject"
            required
            maxLength={300}
            defaultValue={r?.subject}
          />
        </label>
        <label>
          Expected deliverable, purpose & coverage
          <Textarea
            name="description"
            required
            maxLength={5000}
            defaultValue={r?.description}
            placeholder="What should be provided, and which procedure will it support?"
          />
        </label>
        <div className="field-grid">
          <label>
            Responsible party
            <Input
              name="responsibleParty"
              required
              maxLength={300}
              defaultValue={r?.responsibleParty}
              placeholder="Client model owner, data team…"
            />
          </label>
          <label>
            Due date
            <Input
              name="dueDate"
              type="date"
              required
              defaultValue={r?.dueDate || e.dueDate}
            />
          </label>
        </div>
        <label>
          Population period / model version
          <Input
            name="periodVersion"
            required
            maxLength={300}
            defaultValue={r?.periodVersion}
            placeholder="Assessment period and relevant system or model version"
          />
        </label>
        <label>
          Confidentiality & collection instructions
          <Textarea
            name="handling"
            required
            maxLength={5000}
            defaultValue={r?.handling}
            placeholder="Approved collection channel, permitted content and access restrictions"
          />
        </label>
        <label>
          Find working paper
          <Input
            value={paperQuery}
            onChange={(ev) => setPaperQuery(ev.target.value)}
            placeholder="Reference or paper title"
          />
        </label>
        <fieldset className="request-selection">
          <legend>Working papers supported ({paperCount} / 20)</legend>
          {e.papers
            .filter((p) =>
              (p.templateId + " " + p.title)
                .toLowerCase()
                .includes(paperQuery.trim().toLowerCase()),
            )
            .map((p) => (
              <label key={p.id} className="check-row">
                <Checkbox
                  disabled={paperCount >= 20 && !checks["paper:" + p.id]}
                  checked={!!checks["paper:" + p.id]}
                  onCheckedChange={(v) => onCheck("paper:" + p.id, !!v)}
                />
                <span>
                  {p.templateId} · {p.title}
                </span>
              </label>
            ))}
        </fieldset>
        <p className="request-note">
          Resolve the request before Reporting, either with assessed evidence or
          a Lead-approved limitation/scope memo.
        </p>
      </>
    );
  if (mode === "requestResponse")
    return (
      <>
        <p className="body-copy">{r?.subject}</p>
        <label>
          Receipt & provenance notes
          <Textarea
            name="response"
            required
            maxLength={5000}
            defaultValue={r?.response}
            placeholder="Who provided the material, when, how and any known gaps"
          />
        </label>
        {select("Delivery completeness", "deliveryComplete", [
          { value: "true", label: "Complete · all requested items received" },
          { value: "false", label: "Partial · outstanding items remain" },
        ])}
        <label>
          Outstanding items / resolution notes
          <Textarea
            name="remainingItems"
            required={choices.deliveryComplete === "false"}
            maxLength={5000}
            defaultValue={r?.remainingItems}
          />
        </label>
        <label>
          Find received file
          <Input
            value={fileQuery}
            onChange={(ev) => setFileQuery(ev.target.value)}
            placeholder="File name"
          />
        </label>
        <fieldset className="request-selection">
          <legend>Received files</legend>
          {e.artifacts
            .filter((a) =>
              a.name.toLowerCase().includes(fileQuery.trim().toLowerCase()),
            )
            .map((a) => (
              <label key={a.id} className="check-row">
                <Checkbox
                  checked={!!checks["evidence:" + a.id]}
                  onCheckedChange={(v) => onCheck("evidence:" + a.id, !!v)}
                />
                <span>
                  {a.name}
                  <small>
                    {a.status === "accepted"
                      ? "Accepted for handling"
                      : a.status === "unverified"
                        ? "Awaiting acceptance"
                        : "Quarantined"}
                  </small>
                </span>
              </label>
            ))}
          {!e.artifacts.length && (
            <p className="subtle">
              Upload the received files to the evidence vault, then record the
              response.
            </p>
          )}
        </fieldset>
        <p className="request-note">
          Receipt is recorded by the auditor. Linking a file does not assess its
          sufficiency.
        </p>
      </>
    );
  if (mode === "requestAssess")
    return (
      <>
        <p className="body-copy">{r?.subject}</p>
        {select("Evidence decision", "decision", [
          { value: "accepted", label: "Sufficient for the planned procedure" },
          { value: "returned", label: "More evidence / clarification needed" },
        ])}
        <label>
          Relevance, reliability, coverage & limitations
          <Textarea
            name="assessment"
            required
            maxLength={5000}
            placeholder="Explain why the received evidence supports the procedure, or what is still missing"
          />
        </label>
        {!accepted && (
          <p className="request-warning">
            Received files must be accepted for handling before a
            sufficient-evidence decision. You can record a follow-up decision
            now.
          </p>
        )}
        <p className="request-note">
          This assessment does not approve the working paper or determine legal
          compliance.
        </p>
      </>
    );
  if (mode === "requestClose")
    return (
      <>
        <p className="body-copy">{r?.subject}</p>
        {select("Disposition", "disposition", [
          { value: "unobtainable", label: "Evidence cannot be obtained" },
          {
            value: "no_longer_required",
            label: "No longer requested after a scope change",
          },
        ])}
        <label>
          Rationale & impact on the audit
          <Textarea
            name="assessment"
            required
            maxLength={5000}
            placeholder="Explain the attempts made, scope decision and effect on the planned procedures or opinion"
          />
        </label>
        <p className="request-note">
          Creates a required limitation/scope memo for human evaluation and
          independent review. Link accepted correspondence, documented
          collection attempts or the approved scope decision to the memo before
          submitting it. This does not waive a legal obligation.
        </p>
      </>
    );
  if (mode === "requestReopen")
    return (
      <>
        <p className="body-copy">{r?.subject}</p>
        <label>
          Reason for reopening
          <Textarea name="reason" required maxLength={5000} />
        </label>
        <p className="request-note">
          The previous decision stays in history. Signed papers and captured
          reports remain fixed.
        </p>
      </>
    );
  return null;
}
