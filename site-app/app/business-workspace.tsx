"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Bookmark,
  Trash2,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { packFeatures, type WorkspaceData } from "./workspace-types";
import { engagementWork, orderWork, type WorkItem } from "@/lib/work-items";
import { localWorkDay, workKindLabels } from "@/lib/work-inbox";
import { linkQuery } from "@/lib/workspace-links";
import { classificationRules } from "@/lib/classification-rules";
import { asRulePack } from "@/lib/rule-pack";
import {
  defaultPreferences,
  type PersonalPreferences,
} from "@/lib/workspace-state";
export function usePersonalPreferences(tenantId: string) {
  const initial = {
    tenantId,
    value: defaultPreferences,
    version: 0,
    error: "",
    ready: false,
  };
  const [snapshot, setSnapshot] = useState(initial),
    request = useRef<{
      generation: number;
      controller: AbortController | null;
    }>({ generation: 0, controller: null }),
    activeTenant = useRef(tenantId);
  activeTenant.current = tenantId;
  const current = snapshot.tenantId === tenantId ? snapshot : initial;
  const load = useCallback(async () => {
    request.current.controller?.abort();
    const controller = new AbortController(),
      generation = ++request.current.generation;
    request.current.controller = controller;
    setSnapshot((old) => ({
      ...old,
      tenantId,
      value: old.tenantId === tenantId ? old.value : defaultPreferences,
      version: old.tenantId === tenantId ? old.version : 0,
      error: "",
      ready: false,
    }));
    try {
      const r = await fetch(
          "/api/workspace-state?" +
            new URLSearchParams({ tenantId, kind: "preferences" }),
          { cache: "no-store", signal: controller.signal },
        ),
        v = (await r.json()) as {
          error?: string;
          preferences: PersonalPreferences;
          version: number;
        };
      if (!r.ok)
        throw Error(
          v.error ??
            "Preferences could not be loaded. Retry to refresh your saved views.",
        );
      if (
        generation !== request.current.generation ||
        activeTenant.current !== tenantId
      )
        return;
      setSnapshot({
        tenantId,
        value: v.preferences,
        version: v.version,
        error: "",
        ready: true,
      });
    } catch (e) {
      if (
        !controller.signal.aborted &&
        generation === request.current.generation &&
        activeTenant.current === tenantId
      )
        setSnapshot((old) => ({
          ...old,
          error:
            e instanceof Error
              ? e.message
              : "Preferences unavailable. Retry to load your saved views.",
          ready: false,
        }));
    }
  }, [tenantId]);
  useEffect(() => {
    void load();
    return () => {
      request.current.generation++;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally aborts whichever request is in flight at cleanup time
      request.current.controller?.abort();
    };
  }, [load]);
  async function save(next: PersonalPreferences) {
    if (!current.ready || activeTenant.current !== tenantId)
      throw Error("Wait for your current practice preferences to load.");
    const generation = request.current.generation;
    try {
      const r = await fetch("/api/workspace-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId,
            kind: "preferences",
            expectedVersion: current.version,
            preferences: next,
          }),
        }),
        v = (await r.json()) as { error?: string; version: number };
      if (!r.ok)
        throw Error(
          v.error ??
            "Preferences could not be saved. Retry to refresh your saved views.",
        );
      if (
        generation === request.current.generation &&
        activeTenant.current === tenantId
      )
        setSnapshot({
          tenantId,
          value: next,
          version: v.version,
          error: "",
          ready: true,
        });
    } catch (e) {
      if (
        generation === request.current.generation &&
        activeTenant.current === tenantId
      )
        setSnapshot((old) => ({
          ...old,
          error:
            e instanceof Error ? e.message : "Preferences could not be saved.",
        }));
      throw e;
    }
  }
  return {
    value: current.value,
    save,
    error: current.error,
    ready: current.ready,
    load,
  };
}
export function TaskRows({
  items,
  onOpen,
  onSnooze,
  onResume,
  tenantId,
  reminders = new Map(),
  reminderDisabled = false,
  showState = true,
}: {
  items: WorkItem[];
  onOpen: (i: WorkItem) => void;
  onSnooze?: (i: WorkItem) => void;
  onResume?: (i: WorkItem) => void;
  tenantId: string;
  reminders?: Map<string, string>;
  reminderDisabled?: boolean;
  showState?: boolean;
}) {
  const today = localWorkDay();
  return (
    <div className="business-task-list">
      {items.map((i) => {
        const due = i.dueDate
            ? new Date(i.dueDate + "T12:00:00").toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "",
          until = reminders.get(i.id);
        const kind = [
          "scope",
          "classification",
          "program",
          "monitoring",
        ].includes(i.kind)
          ? ""
          : i.kind;
        const href =
          "?" +
          linkQuery({
            tenantId,
            engagementId: i.engagementId,
            module: i.module,
            kind,
            recordId: kind ? i.recordId : "",
            section: i.section ?? "",
          });
        return (
          <div className="business-task-row" key={i.id}>
            <a
              className="business-task-open"
              href={href}
              onClick={(event) => {
                if (
                  event.button === 0 &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  onOpen(i);
                }
              }}
            >
              <span className="business-task-main">
                <span className="business-task-type">
                  {workKindLabels[i.kind]}
                  {i.priority === 0 && (
                    <span className="work-priority">Priority</span>
                  )}
                </span>
                <b>{i.title}</b>
                <small>
                  {i.client ? i.client + " · " : ""}
                  {i.engagement}
                </small>
                <span>{i.reason}</span>
              </span>
              <span className="business-task-state">
                {showState && (
                  <span
                    className={
                      "badge " +
                      (i.state === "review"
                        ? "blue"
                        : i.state === "waiting"
                          ? "amber"
                          : "neutral")
                    }
                  >
                    {i.state === "waiting"
                      ? "Waiting"
                      : i.state === "review"
                        ? "Needs review"
                        : i.state === "planning"
                          ? "Planning"
                          : "Ready"}
                  </span>
                )}
                <small
                  className={i.dueDate && i.dueDate < today ? "overdue" : ""}
                >
                  {i.dueDate
                    ? i.dueDate < today
                      ? "Overdue · " + due
                      : i.dueDate === today
                        ? "Due today"
                        : "Due " + due
                    : "No due date"}
                </small>
                {until && (
                  <small>
                    Resumes{" "}
                    {new Date(until).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                )}
                <b>
                  {i.action}
                  <ChevronRight size={14} aria-hidden="true" />
                </b>
              </span>
            </a>
            {until && onResume && i.personal ? (
              <Button
                size="icon"
                variant="ghost"
                disabled={reminderDisabled}
                title="Resume reminder"
                aria-label={"Resume reminder for " + i.title}
                onClick={() => onResume(i)}
              >
                <RotateCcw size={16} aria-hidden="true" />
              </Button>
            ) : (
              onSnooze &&
              i.personal && (
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={reminderDisabled}
                  title="Snooze until tomorrow at 08:00"
                  aria-label={
                    "Snooze reminder for " +
                    i.title +
                    " until tomorrow at 08:00"
                  }
                  onClick={() => onSnooze(i)}
                >
                  <Clock3 size={16} aria-hidden="true" />
                </Button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
export function EngagementTaskQueue({
  data,
  onOpen,
}: {
  data: WorkspaceData;
  onOpen: (i: WorkItem) => void;
}) {
  const e = data.engagement!,
    items = orderWork(
      engagementWork(
        e,
        data.identity.role,
        data.identity.id,
        data.clients.find((c) => c.id === e.clientId)?.name,
        undefined,
        {
          nameOf: (id) =>
            data.people.find((m) => m.user_id === id)?.display_name,
          rules: classificationRules(
            asRulePack(data.catalog?.regulatorySnapshot),
          ),
          features: packFeatures(data),
        },
      ),
    ).filter((i) => i.personal),
    [all, setAll] = useState(false);
  const actionable = items.filter((i) => i.state !== "waiting"),
    waiting = items.filter((i) => i.state === "waiting");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- collapses the queue again after the engagement or stage changes (post-commit reset is the current behaviour)
  useEffect(() => setAll(false), [e.id, e.stage]);
  return (
    <section className="panel engagement-task-queue">
      <div className="panel-head">
        <h2>
          Your next actions{" "}
          <span className="count-label">{actionable.length}</span>
        </h2>
      </div>
      {actionable.length ? (
        <>
          <TaskRows
            items={all ? actionable : actionable.slice(0, 5)}
            tenantId={data.tenantId}
            onOpen={onOpen}
          />
          {actionable.length > 5 && (
            <Button variant="ghost" onClick={() => setAll((v) => !v)}>
              {all
                ? "Show fewer"
                : `Show ${actionable.length - 5} more actions`}
            </Button>
          )}
        </>
      ) : (
        <div className="queue-empty">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>
            {waiting.length
              ? "Your assigned work is waiting on dependencies."
              : "No assigned actions at this stage."}
          </span>
        </div>
      )}
      {waiting.length > 0 && (
        <details className="work-group work-waiting">
          <summary>
            <span>Waiting on dependencies</span>
            <span className="count-label">{waiting.length}</span>
          </summary>
          <TaskRows items={waiting} tenantId={data.tenantId} onOpen={onOpen} />
        </details>
      )}
    </section>
  );
}
export function SavedViews({
  tenantId,
  current,
  onOpen,
  compact = false,
}: {
  compact?: boolean;
  tenantId: string;
  current: {
    module: string;
    search: string;
    filter: string;
    facet: string;
    sort: string;
  };
  onOpen: (v: typeof current) => void;
}) {
  const pref = usePersonalPreferences(tenantId),
    [name, setName] = useState(""),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await pref.save({
        ...pref.value,
        views: [
          ...pref.value.views,
          { ...current, id: crypto.randomUUID(), name: name.trim() },
        ],
      });
      setName("");
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          aria-label="Saved views"
          title="Saved views"
        >
          <Bookmark size={15} aria-hidden="true" />
          {!compact && "Saved views"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="saved-view-popover" align="end">
        <h2>Saved views</h2>
        {pref.error && (
          <p className="form-error" role="alert">
            {pref.error}
            <Button variant="ghost" onClick={() => void pref.load()}>
              Reload
            </Button>
          </p>
        )}
        {pref.value.views.map((v) => (
          <div className="saved-view-row" key={v.id}>
            <button
              onClick={() => {
                onOpen(v);
                setOpen(false);
              }}
            >
              <b>{v.name}</b>
              <small>{v.module}</small>
            </button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={"Remove saved view " + v.name}
              onClick={() =>
                void pref
                  .save({
                    ...pref.value,
                    views: pref.value.views.filter((x) => x.id !== v.id),
                  })
                  .catch(() => {})
              }
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
        {!pref.value.views.length && (
          <p className="subtle">Save your current filters for next time.</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
              placeholder="My review queue…"
            />
          </label>
          <Button
            type="submit"
            disabled={busy || !pref.ready || pref.value.views.length >= 20}
          >
            {busy ? "Saving…" : "Save current view"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
