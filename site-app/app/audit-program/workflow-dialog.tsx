"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Engagement } from "@/lib/domain";
import {
  DraftRecovery,
  useRecoverableDraft,
  type DraftScope,
} from "../recoverable-draft";
export type Option = {
  value: string;
  label: string;
};
export type Field = {
  name: string;
  label: string;
  value?: string;
  type?: "text" | "date" | "area" | "select" | "checklist";
  options?: Option[];
  ids?: string[];
  optional?: boolean;
  hint?: string;
  /** Overrides the default limit (8,000 for an area, 300 for text). */
  maxLength?: number;
};
export type WorkflowAct = (
  op: string,
  data: Record<string, unknown>,
) => Promise<{
  engagement: Engagement;
  details?: Record<string, string>;
}>;
export type Form = {
  title: string;
  draft?: DraftScope;
  description?: string;
  action: string;
  fields: Field[];
  save: (values: Record<string, string | string[]>) => Promise<unknown>;
};
export function WorkflowDialog({
  form,
  onClose,
  busy,
  onEditing,
}: {
  form: Form | null;
  onClose: () => void;
  busy: boolean;
  onEditing?: (v: boolean) => void;
}) {
  const [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [confirm, setConfirm] = useState(false),
    [values, setValues] = useState<Record<string, string | string[]>>({}),
    [openForm, setOpenForm] = useState<Form | null>(null);
  // Each form that opens starts from its own field values, in the render
  // that shows it.
  if (openForm !== form) {
    setOpenForm(form);
    setError("");
    setDirty(false);
    setConfirm(false);
    setValues(
      Object.fromEntries(
        form?.fields.map((f) => [
          f.name,
          f.type === "checklist" ? (f.ids ?? []) : (f.value ?? ""),
        ]) ?? [],
      ),
    );
  }
  const recovery = useRecoverableDraft(
    form?.draft,
    values,
    dirty,
    !!form?.draft,
  );
  useEffect(() => {
    onEditing?.(!!form);
    return () => onEditing?.(false);
  }, [form, onEditing]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget),
      v: Record<string, string | string[]> = {};
    for (const f of form!.fields)
      v[f.name] =
        f.type === "checklist"
          ? fields.getAll(f.name).map(String)
          : String(fields.get(f.name) ?? "");
    try {
      setError("");
      await form!.save(v);
      setDirty(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }
  function close() {
    if (busy) return;
    if (dirty) setConfirm(true);
    else onClose();
  }
  return (
    <Dialog
      open={!!form}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {form && (
        <DialogContent className="audit-dialog workflow-dialog">
          <DialogHeader>
            <DialogTitle>{form.title}</DialogTitle>
            <DialogDescription>
              {form.description ??
                "Changes are recorded with your identity and the current engagement version."}
            </DialogDescription>
          </DialogHeader>
          <DraftRecovery
            draft={recovery}
            onRestore={(v) => {
              setValues(v as Record<string, string | string[]>);
              setDirty(true);
            }}
          />
          <form
            onSubmit={submit}
            onChange={(ev) => {
              setDirty(true);
              const fd = new FormData(ev.currentTarget);
              setValues(
                Object.fromEntries(
                  form.fields.map((f) => [
                    f.name,
                    f.type === "checklist"
                      ? fd.getAll(f.name).map(String)
                      : String(fd.get(f.name) ?? ""),
                  ]),
                ),
              );
            }}
          >
            <fieldset disabled={busy}>
              {form.fields.map((f) => (
                <div className="workflow-field" key={f.name}>
                  {f.type === "checklist" ? (
                    <fieldset>
                      <legend>{f.label}</legend>
                      <div className="workflow-checklist">
                        {f.options?.map((o) => (
                          <label key={o.value}>
                            <input
                              type="checkbox"
                              name={f.name}
                              value={o.value}
                              checked={
                                Array.isArray(values[f.name]) &&
                                (values[f.name] as string[]).includes(o.value)
                              }
                              readOnly
                            />
                            <span>{o.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <label>
                      {f.label}
                      {f.type === "area" ? (
                        <Textarea
                          name={f.name}
                          value={String(values[f.name] ?? "")}
                          onChange={() => {}}
                          required={!f.optional}
                          maxLength={f.maxLength ?? 8000}
                        />
                      ) : f.type === "select" ? (
                        <select
                          name={f.name}
                          value={String(values[f.name] ?? "")}
                          onChange={() => {}}
                          required={!f.optional}
                        >
                          <option value="">Choose…</option>
                          {f.options?.map((o) => (
                            <option value={o.value} key={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          name={f.name}
                          type={f.type === "date" ? "date" : "text"}
                          value={String(values[f.name] ?? "")}
                          onChange={() => {}}
                          required={!f.optional}
                          maxLength={
                            f.type === "date" ? undefined : (f.maxLength ?? 300)
                          }
                        />
                      )}
                    </label>
                  )}
                  {f.hint && <small className="subtle">{f.hint}</small>}
                </div>
              ))}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {confirm && (
                <p className="form-error" role="alert">
                  Discard your unsaved changes?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setDirty(false);
                      onClose();
                    }}
                  >
                    Discard changes
                  </button>{" "}
                  <button type="button" onClick={() => setConfirm(false)}>
                    Keep editing
                  </button>
                </p>
              )}
              <div className="form-footer">
                <span className="subtle">
                  {dirty ? recovery.status || "Unsaved changes" : ""}
                </span>
                <div className="row-actions">
                  <Button type="button" variant="outline" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {busy ? "Saving…" : form.action}
                  </Button>
                </div>
              </div>
            </fieldset>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
