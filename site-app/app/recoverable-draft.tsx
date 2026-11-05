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
export function useRecoverableDraft(
  scope: DraftScope | undefined,
  content: Record<string, unknown>,
  dirty: boolean,
  enabled = true,
) {
  const [recovery, setRecovery] = useState<{
      content: Record<string, unknown>;
      baseRevision: string;
      version: number;
      updatedAt: string;
      current: boolean;
    } | null>(null),
    [status, setStatus] = useState(""),
    [loaded, setLoaded] = useState(false);
  const version = useRef(0),
    generation = useRef(0),
    pending = useRef(false),
    last = useRef(""),
    active = useRef(false);
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
    active.current = true;
    version.current = 0;
    setLoaded(false);
    setRecovery(null);
    setStatus("");
    last.current = "";
    if (!scope || !enabled) return;
    const controller = new AbortController();
    void fetch("/api/workspace-state?" + new URLSearchParams({ ...scope }), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const v = (await r.json()) as any;
        if (!r.ok) throw Error(v.error);
        if (g !== generation.current) return;
        version.current = v.draft?.version ?? 0;
        if (
          v.draft &&
          JSON.stringify(v.draft.content) !== JSON.stringify(content)
        )
          setRecovery(v.draft);
        else if (v.draft) last.current = JSON.stringify(v.draft.content);
        setLoaded(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setStatus(e.message ?? "Draft recovery unavailable");
      });
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [key, enabled]);
  const encoded = JSON.stringify(content);
  useEffect(() => {
    if (
      !scope ||
      !enabled ||
      !loaded ||
      !dirty ||
      recovery ||
      last.current === encoded
    )
      return;
    const g = generation.current,
      timer = setTimeout(() => {
        if (pending.current) return;
        pending.current = true;
        setStatus("Saving recovery copy…");
        void fetch("/api/workspace-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...scope,
            expectedVersion: version.current,
            content,
          }),
        })
          .then(async (r) => {
            const v = (await r.json()) as any;
            if (!r.ok) throw Error(v.error);
            if (g === generation.current) {
              version.current = v.version;
              last.current = encoded;
              setStatus("Recovery copy saved");
            }
          })
          .catch((e) => {
            if (g === generation.current)
              setStatus(e.message ?? "Recovery copy could not be saved");
          })
          .finally(() => {
            pending.current = false;
          });
      }, 1000);
    return () => clearTimeout(timer);
  }, [key, enabled, loaded, dirty, recovery, encoded, status]);
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
