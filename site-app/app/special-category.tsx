"use client";
// The special-category data controls of the testing lab (#60, D-11): the
// client's recorded bases, the declaration a fairness protocol makes about
// its group column, and the acknowledgement a hosted run needs. The Art 4a
// reading is pending legal review (LR-06).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Engagement } from "@/lib/domain";
import {
  art4aConditions,
  art4aLegalReview,
  art4aParagraph2Condition,
  art4aPoints,
  basisFor,
  basisSummary,
  gdprArt9Grounds,
  type SpecialCategoryAcknowledgement,
  type SpecialCategoryDeclaration,
  type SpecialCategoryDeclarationInput,
} from "@/lib/special-category";

type Act = (op: string, data: Record<string, unknown>) => Promise<unknown>;

export function PendingLegalReview() {
  return (
    <span className="badge amber" title="Pending qualified legal review">
      Art 4a reading pending legal review · {art4aLegalReview}
    </span>
  );
}

type BasisKind = "art4a-1" | "art4a-2" | "gdpr_art9";
const emptyForm = {
  kind: "gdpr_art9" as BasisKind,
  point: "",
  statement: "",
  conditions: {} as Record<string, string>,
  columns: "",
  confirmedBy: "",
  confirmedOn: "",
};

/**
 * The client's recorded bases for special-category columns, and the form to
 * record one. A dataset with such a column can be uploaded only once a basis
 * covers it, or as evidence declared free of special-category personal data.
 */
export function SpecialCategoryRegister({
  engagement: e,
  writer,
  busy,
  act,
  onEditing,
}: {
  engagement: Engagement;
  writer: boolean;
  busy: boolean;
  act: Act;
  /**
   * Reports whether the basis form is open, so the workspace navigation
   * guard keeps an unsaved basis from being dropped (#103).
   */
  onEditing: (editing: boolean) => void;
}) {
  const bases = e.specialCategoryBases ?? [],
    [form, setForm] = useState<typeof emptyForm | null>(null),
    [error, setError] = useState(""),
    open = form !== null;
  useEffect(() => onEditing(open), [open, onEditing]);
  useEffect(() => () => onEditing(false), [onEditing]);
  const paragraph = form?.kind === "art4a-2" ? "2" : "1",
    points = art4aPoints(paragraph),
    titles: Record<string, string> = Object.fromEntries([
      [art4aParagraph2Condition.point, art4aParagraph2Condition.title],
      ...art4aConditions.map((c) => [c.point, c.title]),
    ]);
  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setError("");
    const common = {
      columns: form.columns
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      confirmedBy: form.confirmedBy,
      confirmedOn: form.confirmedOn,
    };
    try {
      await act(
        "recordSpecialCategoryBasis",
        form.kind === "gdpr_art9"
          ? {
              kind: "gdpr_art9",
              point: form.point,
              statement: form.statement,
              ...common,
            }
          : {
              kind: "art4a",
              paragraph,
              conditions: Object.fromEntries(
                points.map((p) => [p, form.conditions[p] ?? ""]),
              ),
              ...common,
            },
      );
      setForm(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <section className="panel special-category-register">
      <div className="panel-head">
        <h2>Special-category data bases</h2>
        <PendingLegalReview />
        {writer && !form && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setForm({ ...emptyForm, conditions: {} })}
          >
            Record client basis
          </Button>
        )}
      </div>
      <p className="subtle">
        Fairness data on special categories (GDPR Art 9) stays with the client
        by default: the external worker or the runtime package computes the
        tests and returns approved aggregates. Before such columns reach this
        platform, record the client&apos;s AI Act Art 4a conditions or other
        GDPR Art 9(2) basis here. On its face, Art 4a(1)(d) bars access by other
        parties, so an Art 4a basis alone may not cover an upload to an external
        auditor. The upload gate reads the header of Dataset evidence only, the
        only category runs read; other categories are not gated.
      </p>
      {bases.length ? (
        <ul className="record-list">
          {bases.map((b) => (
            <li key={b.id}>
              <b>{b.columns.join(", ")}</b> · {basisSummary(b)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="subtle">No basis recorded.</p>
      )}
      {form && (
        <form onSubmit={submit} aria-label="Record client basis">
          <fieldset disabled={busy}>
            <label className="ml-field">
              <span>Basis</span>
              <select
                aria-label="Basis"
                value={form.kind}
                onChange={(ev) =>
                  setForm({ ...form, kind: ev.target.value as BasisKind })
                }
              >
                <option value="gdpr_art9">GDPR Art 9(2) ground</option>
                <option value="art4a-1">
                  AI Act Art 4a(1): providers of high-risk systems
                </option>
                <option value="art4a-2">
                  AI Act Art 4a(2): other systems and deployers
                </option>
              </select>
            </label>
            {form.kind === "gdpr_art9" ? (
              <>
                <label className="ml-field">
                  <span>GDPR Art 9(2) point</span>
                  <select
                    aria-label="GDPR Art 9(2) point"
                    required
                    value={form.point}
                    onChange={(ev) =>
                      setForm({ ...form, point: ev.target.value })
                    }
                  >
                    <option value="">Choose…</option>
                    {gdprArt9Grounds.map((g) => (
                      <option key={g.point} value={g.point}>
                        ({g.point}) {g.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ml-field">
                  <span>How the client meets this ground</span>
                  <Textarea
                    required
                    value={form.statement}
                    onChange={(ev) =>
                      setForm({ ...form, statement: ev.target.value })
                    }
                  />
                </label>
              </>
            ) : (
              points.map((p) => (
                <label className="ml-field" key={p}>
                  <span>
                    Condition ({p.replace(/^2/, "")}
                    {p === "2a" ? ", paragraph 2" : ""}): {titles[p]}
                  </span>
                  <Textarea
                    required
                    aria-label={"Condition " + p}
                    value={form.conditions[p] ?? ""}
                    onChange={(ev) =>
                      setForm({
                        ...form,
                        conditions: {
                          ...form.conditions,
                          [p]: ev.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))
            )}
            <div className="ml-form-grid">
              <label className="ml-field">
                <span>Columns covered (comma-separated)</span>
                <Input
                  required
                  value={form.columns}
                  onChange={(ev) =>
                    setForm({ ...form, columns: ev.target.value })
                  }
                />
              </label>
              <label className="ml-field">
                <span>Confirmed by (client name and role)</span>
                <Input
                  required
                  value={form.confirmedBy}
                  onChange={(ev) =>
                    setForm({ ...form, confirmedBy: ev.target.value })
                  }
                />
              </label>
              <label className="ml-field">
                <span>Confirmed on</span>
                <Input
                  type="date"
                  required
                  value={form.confirmedOn}
                  onChange={(ev) =>
                    setForm({ ...form, confirmedOn: ev.target.value })
                  }
                />
              </label>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="row-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setForm(null);
                  setError("");
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Record basis</Button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}

/** The declaration a new fairness protocol makes about its group column. */
export function ProtocolDeclaration({
  engagement: e,
  column,
  value,
  onChange,
  saved,
}: {
  engagement: Engagement;
  column: string;
  value: SpecialCategoryDeclarationInput;
  onChange: (v: SpecialCategoryDeclarationInput) => void;
  /** A saved protocol's declaration, shown read-only. */
  saved?: SpecialCategoryDeclaration | null;
}) {
  if (saved !== undefined)
    return (
      <div className="ml-notice">
        {saved
          ? saved.specialCategory
            ? "Group column " +
              saved.column +
              " is special-category data · " +
              (saved.route === "hosted"
                ? "hosted route"
                : "client-side route") +
              (saved.basis ? " · " + basisSummary(saved.basis) : "")
            : "Group column " +
              saved.column +
              " declared not special-category data."
          : "This protocol predates special-category declarations; its group column counts as special-category data."}{" "}
        <PendingLegalReview />
      </div>
    );
  const special = value.specialCategory ?? true,
    covering = column ? basisFor(e, column) : undefined,
    route = value.route ?? "client_side";
  return (
    <div className="special-category-declaration">
      <label className="check-row">
        <input
          type="checkbox"
          checked={special}
          onChange={(ev) =>
            onChange({ ...value, specialCategory: ev.target.checked })
          }
        />{" "}
        The group column{column ? " " + column : ""} holds special-category data
        (GDPR Art 9)
      </label>
      {special && (
        <>
          <label className="ml-field">
            <span>Where these fairness tests run</span>
            <select
              aria-label="Where these fairness tests run"
              value={route}
              onChange={(ev) =>
                onChange({
                  ...value,
                  route: ev.target.value as "client_side" | "hosted",
                })
              }
            >
              <option value="client_side">
                Client-side: external worker or runtime package (default)
              </option>
              <option value="hosted" disabled={!covering}>
                Hosted on this platform (needs a recorded basis)
              </option>
            </select>
          </label>
          <p className="subtle">
            {covering
              ? "Recorded basis: " + basisSummary(covering)
              : "No recorded basis covers " +
                (column || "this column") +
                ". Record the client's basis under Datasets to run it on this platform."}{" "}
            <PendingLegalReview />
          </p>
        </>
      )}
    </div>
  );
}

/** A run's frozen declaration, basis and acknowledgement, as evidence. */
export function SpecialCategoryRecord({
  declaration: d,
  acknowledgement,
}: {
  declaration: SpecialCategoryDeclaration;
  acknowledgement?: SpecialCategoryAcknowledgement;
}) {
  return (
    <>
      <p>
        Group column {d.column}:{" "}
        {d.specialCategory
          ? "special-category data, " +
            (d.route === "hosted" ? "hosted route" : "client-side route")
          : "declared not special-category data"}
        . Declared by {d.declaredBy} on {d.declaredAt.slice(0, 10)}.
      </p>
      <p>
        {d.basis
          ? "Basis: " + basisSummary(d.basis) + "."
          : "No basis recorded on the protocol."}{" "}
        <PendingLegalReview />
      </p>
      {acknowledgement && (
        <p>
          Hosted processing acknowledged by {acknowledgement.acknowledgedBy} on{" "}
          {acknowledgement.acknowledgedAt.slice(0, 10)}
          {acknowledgement.inheritedFrom
            ? ", carried over from run " + acknowledgement.inheritedFrom
            : ""}
          .
        </p>
      )}
    </>
  );
}

/** The basis a new protocol declaration copies, chosen for its column. */
export function declarationFor(
  e: Engagement,
  column: string,
  value: SpecialCategoryDeclarationInput,
): SpecialCategoryDeclarationInput {
  const special = value.specialCategory ?? true,
    basis = special && column ? basisFor(e, column) : undefined;
  return {
    specialCategory: special,
    route: special ? (value.route ?? "client_side") : "hosted",
    ...(basis ? { basisId: basis.id } : {}),
  };
}
