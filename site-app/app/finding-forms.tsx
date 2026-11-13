"use client";
import { useState } from "react";
import { Search } from "lucide-react";
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
import type { CriterionOption } from "@/lib/criteria/types";
import { risk, type Artifact, type Finding } from "@/lib/domain";
import { findingReference, humanLabel } from "@/lib/presentation";

type Choices = Record<string, string>;
type FieldProps = {
  choices: Choices;
  onChoice: (name: string, value: string) => void;
};
function Choice({
  name,
  label,
  values,
  choices,
  onChoice,
}: FieldProps & {
  name: string;
  label: string;
  values: { value: string; label: string }[];
}) {
  return (
    <Select value={choices[name]} onValueChange={(v) => onChoice(name, v)}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map((v) => (
          <SelectItem key={v.value} value={v.value}>
            {v.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
const numbers = ["1", "2", "3", "4", "5"].map((value) => ({
  value,
  label: value,
}));
/**
 * Whether a finding on this pack names a clause of its primary criteria as
 * its primary reference instead of an AI Act article (#144): a pack none of
 * whose primary criteria sets is the AI Act, such as ISO/IEC 42001.
 */
export const citesPackClauses = (
  primary: readonly { id: string }[],
  criteria: CriterionOption[] | undefined,
) =>
  !!primary.length &&
  !primary.some((f) => f.id === "eu-ai-act") &&
  !!criteria?.length;

/** The pack's criteria with those of its primary frameworks first. */
export function primaryCriteriaFirst(
  criteria: CriterionOption[],
  primary: readonly { id: string }[],
) {
  const rank = (c: CriterionOption) =>
    primary.some((f) => f.id === c.reference.split(":")[0]) ? 0 : 1;
  return [...criteria].sort((a, b) => rank(a) - rank(b));
}

export function NewFindingForm({
  choices,
  onChoice,
  criteria,
  primary,
}: FieldProps & {
  /** The criteria of the engagement's pack a finding may reference. */
  criteria?: CriterionOption[];
  /** The pack's primary criteria sets. */
  primary?: readonly { id: string; shortTitle: string }[];
}) {
  const rating = risk(
    Number(choices.likelihood || 3),
    Number(choices.impact || 3),
  );
  const criterion = criteria?.find((c) => c.reference === choices.criterion);
  const primaries = primary ?? [],
    clauses = citesPackClauses(primaries, criteria);
  return (
    <div className="finding-form">
      <section className="finding-form-section">
        <h3>Observation</h3>
        <label>
          Finding title
          <Input
            name="title"
            defaultValue={choices.title}
            required
            maxLength={300}
          />
        </label>
        {!!criteria?.length && (
          <label>
            <span className="finding-field-label">
              {clauses ? "Primary reference" : "Criterion"}
              <small>
                {clauses
                  ? "A clause of " +
                    primaries.map((f) => f.shortTitle).join(" or ")
                  : "Optional; sets the article"}
              </small>
            </span>
            <Choice
              name="criterion"
              label={clauses ? "Primary reference" : "Criterion"}
              values={[
                ...(clauses && !choices.procedureId
                  ? [{ value: "none", label: "Choose a clause" }]
                  : [
                      {
                        value: "none",
                        label: choices.procedureId
                          ? "The criteria of the procedure's working paper"
                          : "No criterion (article only)",
                      },
                    ]),
                ...primaryCriteriaFirst(criteria, primaries).map((c) => ({
                  value: c.reference,
                  label: c.citation + (c.title ? " · " + c.title : ""),
                })),
              ]}
              choices={{ ...choices, criterion: choices.criterion || "none" }}
              onChoice={onChoice}
            />
          </label>
        )}
        {criterion ? (
          <p className="subtle">
            {findingReference(criterion.article ?? criterion.citation)}, from
            the chosen criterion
          </p>
        ) : clauses ? (
          <p className="subtle">
            {choices.procedureId
              ? "The finding cites the first criterion of the procedure's working paper."
              : "Findings on this pack cite its clauses rather than AI Act articles."}
          </p>
        ) : (
          <label>
            Primary article
            <Choice
              name="article"
              label="Article"
              values={[
                "4",
                "5",
                "6",
                "9",
                "10",
                "11",
                "12",
                "13",
                "14",
                "15",
                "16",
                "17",
                "18",
                "19",
                "25",
                "26",
                "27",
                "43",
                "49",
                "50",
                "72",
                "73",
              ].map((value) => ({ value, label: "Article " + value }))}
              choices={choices}
              onChoice={onChoice}
            />
          </label>
        )}
        {[
          ["condition", "Observed condition"],
          ["criteria", "Criteria & expectation"],
          ["effect", "Effect & affected persons"],
          ["cause", "Root cause / hypothesis"],
        ].map(([name, label]) => (
          <label key={name}>
            <span className="finding-field-label">
              {label}
              {name === "cause" && <small>Optional</small>}
            </span>
            <Textarea
              name={name}
              defaultValue={choices[name]}
              required={name !== "cause"}
            />
          </label>
        ))}
      </section>
      <section className="finding-form-section">
        <h3>Risk assessment</h3>
        <div className="field-grid">
          <label>
            Likelihood (1–5)
            <Choice
              name="likelihood"
              label="Likelihood"
              values={numbers}
              choices={choices}
              onChoice={onChoice}
            />
          </label>
          <label>
            Impact (1–5)
            <Choice
              name="impact"
              label="Impact"
              values={numbers}
              choices={choices}
              onChoice={onChoice}
            />
          </label>
        </div>
        <output className="finding-risk-preview" aria-live="polite">
          <span>Calculated risk</span>
          <b>{rating.riskScore} / 25</b>
          <span
            className={
              "badge " +
              (["High", "Critical"].includes(rating.severity)
                ? "red"
                : rating.severity === "Medium"
                  ? "amber"
                  : "neutral")
            }
          >
            {rating.severity}
          </span>
        </output>
      </section>
      <section className="finding-form-section">
        <h3>Ownership & visibility</h3>
        <div className="field-grid">
          <label>
            Remediation owner
            <Input name="owner" required />
          </label>
          <label>
            Due date
            <Input name="dueDate" type="date" required />
          </label>
        </div>
        <label>
          Visibility
          <Choice
            name="visibility"
            label="Visibility"
            values={[
              { value: "internal", label: "Internal audit team" },
              { value: "client", label: "Shared with client" },
            ]}
            choices={choices}
            onChoice={onChoice}
          />
        </label>
      </section>
    </div>
  );
}

export function RemediationForm({
  finding,
  artifacts,
  choices,
  onChoice,
  checks,
  onCheck,
}: FieldProps & {
  finding: Finding;
  artifacts: Artifact[];
  checks: Record<string, boolean>;
  onCheck: (id: string, checked: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const accepted = artifacts.filter((a) => a.status === "accepted"),
    matching = accepted.filter((a) =>
      (a.name + " " + a.category)
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
    );
  const selected = accepted.filter((a) => checks[a.id]).length;
  return (
    <div className="finding-form">
      <p className="finding-form-context">{finding.title}</p>
      <section className="finding-form-section">
        <h3>Remediation update</h3>
        <label>
          Status
          <Choice
            name="status"
            label="Remediation status"
            values={["open", "in_progress", "ready_for_retest"].map(
              (value) => ({ value, label: humanLabel(value) }),
            )}
            choices={choices}
            onChoice={onChoice}
          />
        </label>
        <label>
          <span className="finding-field-label">
            Management response<small>Optional</small>
          </span>
          <Textarea name="response" defaultValue={finding.response} />
        </label>
        <label>
          Remediation & retest procedures
          <Textarea name="remediation" defaultValue={finding.remediation} />
        </label>
      </section>
      <section className="finding-form-section">
        <div className="finding-evidence-heading">
          <h3>Accepted retest evidence</h3>
          <span>{selected} selected</span>
        </div>
        {accepted.length ? (
          <>
            <div className="finding-evidence-search">
              <Search size={15} />
              <Input
                aria-label="Search accepted retest evidence"
                placeholder="Search files or categories…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear evidence search"
                  onClick={() => setQuery("")}
                >
                  ×
                </button>
              )}
            </div>
            <div className="finding-evidence-options">
              {matching.map((a) => (
                <label className="check-row" key={a.id}>
                  <Checkbox
                    checked={!!checks[a.id]}
                    onCheckedChange={(v) => onCheck(a.id, !!v)}
                  />
                  <span>
                    {a.name}
                    <small>{a.category}</small>
                  </span>
                </label>
              ))}
              {!matching.length && (
                <p className="subtle">No accepted files match this search.</p>
              )}
            </div>
          </>
        ) : (
          <p className="finding-evidence-empty">
            No accepted evidence is available. Upload and accept supporting
            files in Evidence vault before requesting retest.
          </p>
        )}
        <p className="finding-evidence-note">
          Closure requires an independent reviewer’s retest assessment supported
          by accepted evidence.
        </p>
      </section>
    </div>
  );
}
