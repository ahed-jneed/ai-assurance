"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DraftKind } from "@/lib/workspace-state";
export type DraftScope = {
  tenantId: string;
  engagementId: string;
  kind: DraftKind;
  recordId: string;
  baseRevision: string;
};
type StoredDraft = {
  content: Record<string, unknown>;
  baseRevision: string;
  version: number;
  updatedAt: string;
  current: boolean;
};
type AutosaveInput = {
  scope: DraftScope;
  content: Record<string, unknown>;
  encoded: string;
};
type PostDraft = (body: string) => Promise<Response>;
const postDraft: PostDraft = (body) =>
  fetch("/api/workspace-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
/**
 * Saves the recovery copy of one draft scope a short while after its content
 * changes. A 409 means the record or the stored draft changed under the form:
 * retrying cannot succeed, so autosave stops until the scope (which includes
 * the base revision) changes. Any other failure is not retried until the
 * content changes again.
 */
export class DraftAutosave {
  version = 0;
  last = "";
  private key = "";
  private input: AutosaveInput | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private conflict = false;
  private failed = "";
  constructor(
    private readonly onStatus: (status: string) => void,
    private readonly post: PostDraft = postDraft,
    private readonly delay = 1000,
  ) {}
  /** Starts a new draft scope and forgets the previous one, conflict included. */
  reset(key: string) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.key = key;
    this.input = undefined;
    this.version = 0;
    this.last = "";
    this.conflict = false;
    this.failed = "";
  }
  /** Passes the latest content; `undefined` while nothing should be saved. */
  update(input: AutosaveInput | undefined) {
    this.input = input;
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const input = this.input;
    if (
      !input ||
      this.pending ||
      this.conflict ||
      input.encoded === this.last ||
      input.encoded === this.failed
    )
      return;
    this.timer = setTimeout(() => this.save(input), this.delay);
  }
  private save(input: AutosaveInput) {
    const key = this.key;
    this.timer = undefined;
    this.pending = true;
    this.onStatus("Saving recovery copy…");
    void this.post(
      JSON.stringify({
        ...input.scope,
        expectedVersion: this.version,
        content: input.content,
      }),
    )
      .then(async (r) => {
        const v = (await r.json()) as { error?: string; version: number };
        if (key !== this.key) return;
        if (r.ok) {
          this.version = v.version;
          this.last = input.encoded;
          this.onStatus("Recovery copy saved");
          return;
        }
        if (r.status === 409) this.conflict = true;
        else this.failed = input.encoded;
        this.onStatus(v.error ?? "Recovery copy could not be saved");
      })
      .catch((e: { message?: string }) => {
        if (key !== this.key) return;
        this.failed = input.encoded;
        this.onStatus(e.message ?? "Recovery copy could not be saved");
      })
      .finally(() => {
        this.pending = false;
        this.schedule();
      });
  }
}
export function useRecoverableDraft(
  scope: DraftScope | undefined,
  content: Record<string, unknown>,
  dirty: boolean,
  enabled = true,
) {
  const [recovery, setRecovery] = useState<StoredDraft | null>(null),
    [status, setStatus] = useState(""),
    [loaded, setLoaded] = useState(false),
    [autosave] = useState(() => new DraftAutosave(setStatus));
  const generation = useRef(0);
  const key = scope
    ? [
        scope.tenantId,
        scope.engagementId,
        scope.kind,
        scope.recordId,
        scope.baseRevision,
      ].join("|")
    : "";
  useEffect(() => {
    const g = ++generation.current;
    autosave.reset(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the recovery state for the new draft scope before fetching it
    setLoaded(false);
    setRecovery(null);
    setStatus("");
    if (!scope || !enabled) return;
    const controller = new AbortController();
    void fetch("/api/workspace-state?" + new URLSearchParams({ ...scope }), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const v = (await r.json()) as {
          error?: string;
          draft?: StoredDraft | null;
        };
        if (!r.ok) throw Error(v.error);
        if (g !== generation.current) return;
        autosave.version = v.draft?.version ?? 0;
        if (
          v.draft &&
          JSON.stringify(v.draft.content) !== JSON.stringify(content)
        )
          setRecovery(v.draft);
        else if (v.draft) autosave.last = JSON.stringify(v.draft.content);
        setLoaded(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setStatus(e.message ?? "Draft recovery unavailable");
      });
    return () => {
      autosave.reset("");
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key encodes scope; content is compared only once, when the stored draft arrives
  }, [key, enabled]);
  const encoded = JSON.stringify(content);
  useEffect(() => {
    autosave.update(
      scope && enabled && loaded && dirty && !recovery
        ? { scope, content, encoded }
        : undefined,
    );
    // Status is deliberately not a dependency: DraftAutosave reschedules
    // itself when a save settles, so a refused save is not retried per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key and encoded are the serialised forms of scope and content
  }, [key, enabled, loaded, dirty, recovery, encoded]);
  return {
    recovery,
    status,
    ready: loaded,
    restore: () => {
      const v = recovery?.content;
      setRecovery(null);
      return v;
    },
    dismiss: () => setRecovery(null),
  };
}
export function DraftRecovery({
  draft,
  onRestore,
}: {
  draft: ReturnType<typeof useRecoverableDraft>;
  onRestore: (content: Record<string, unknown>) => void;
}) {
  if (!draft.recovery)
    return draft.status &&
      !["Recovery copy saved", "Saving recovery copy…"].includes(
        draft.status,
      ) ? (
      <p role="status" className="form-error">
        {draft.status}
      </p>
    ) : null;
  function exportDraft() {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(draft.recovery, null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "recovery-draft.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="draft-recovery">
      <b>
        {draft.recovery.current
          ? "Recover your unfinished work"
          : "A recovery copy predates the saved revision"}
      </b>
      <p>
        Saved {new Date(draft.recovery.updatedAt).toLocaleString()}. Approval
        and audit revision status are unchanged.
      </p>
      <div className="row-actions">
        {draft.recovery.current && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const value = draft.restore();
              if (value) onRestore(value);
            }}
          >
            Restore draft
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={exportDraft}>
          Export recovery copy
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={draft.dismiss}>
          Use saved revision
        </Button>
      </div>
    </section>
  );
}
