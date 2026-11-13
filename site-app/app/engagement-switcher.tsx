"use client";
import { useEffect, useState } from "react";
import { FolderOpen, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { parseRecentEngagements } from "@/lib/navigation-preferences";
import type { WorkspaceData } from "./workspace-types";

export function EngagementSwitcher({
  data,
  open,
  onOpenChange,
  onSelect,
}: {
  data: WorkspaceData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("client"),
    [recentIds, setRecentIds] = useState<string[]>([]),
    [restoredKey, setRestoredKey] = useState(""),
    [limit, setLimit] = useState(50);
  const key =
      "assurance.recent-engagements.v1." +
      data.identity.id +
      "." +
      data.tenantId,
    currentId = data.engagement?.id;
  const normalized = query.trim().toLowerCase(),
    clientName = (id: string) =>
      data.clients.find((c) => c.id === id)?.name ?? "Client";
  const practiceName =
    data.memberships.find((m) => m.tenant_id === data.tenantId)?.name ??
    "Current practice";
  useEffect(() => {
    let ids: string[] = [];
    try {
      ids = parseRecentEngagements(localStorage.getItem(key));
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is read only after hydration, so the server and first client render agree; this effect is that external read
    setRecentIds(ids);
    setRestoredKey(key);
  }, [key]);
  // Once the stored list is restored, the open engagement becomes the most
  // recent one, in the render that shows it.
  const recordKey =
      restoredKey === key && currentId ? key + "|" + currentId : "",
    [recordedKey, setRecordedKey] = useState("");
  if (recordKey !== recordedKey) {
    setRecordedKey(recordKey);
    if (currentId)
      setRecentIds((ids) =>
        ids[0] === currentId
          ? ids
          : [currentId, ...ids.filter((id) => id !== currentId)].slice(0, 5),
      );
  }
  useEffect(() => {
    if (restoredKey !== key) return;
    try {
      localStorage.setItem(key, JSON.stringify(recentIds));
    } catch {}
  }, [recentIds, key, restoredKey]);
  // Another search, sort or account shows the first 50 rows again.
  const pagingScope = JSON.stringify([query, sort, key]),
    [pagedScope, setPagedScope] = useState(pagingScope);
  if (pagedScope !== pagingScope) {
    setPagedScope(pagingScope);
    setLimit(50);
  }
  const matches = data.engagements
    .filter((e) =>
      (e.title + " " + clientName(e.client_id))
        .toLowerCase()
        .includes(normalized),
    )
    .sort((a, b) =>
      sort === "due"
        ? (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
          a.title.localeCompare(b.title)
        : clientName(a.client_id).localeCompare(clientName(b.client_id)) ||
          a.title.localeCompare(b.title),
    );
  const recent = !normalized
    ? recentIds
        .map((id) => data.engagements.find((e) => e.id === id))
        .filter((e): e is WorkspaceData["engagements"][number] => !!e)
    : [];
  const visible = matches
      .filter((e) => !recent.some((r) => r.id === e.id))
      .slice(0, limit),
    remaining = matches.length - recent.length - visible.length;
  function closePicker() {
    onOpenChange(false);
    setQuery("");
  }
  function item(e: WorkspaceData["engagements"][number], showClient = false) {
    return (
      <CommandItem
        key={e.id}
        value={e.id}
        onSelect={() => {
          closePicker();
          onSelect(e.id);
        }}
      >
        <FolderOpen size={16} aria-hidden="true" />
        <span>
          <b>{e.title}</b>
          <small>
            {showClient && clientName(e.client_id) + " · "}
            {e.stage}
            {e.due_date &&
              " · Due " +
                new Date(e.due_date + "T00:00:00").toLocaleDateString(
                  undefined,
                  { day: "numeric", month: "short", year: "numeric" },
                )}
          </small>
        </span>
        {e.id === currentId && (
          <span className="picker-current">
            <Check size={14} aria-hidden="true" />
            Current
          </span>
        )}
      </CommandItem>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) setQuery("");
      }}
    >
      <DialogContent
        className="workspace-search engagement-picker"
        showCloseButton={false}
      >
        <DialogHeader className="picker-header">
          <DialogTitle>Switch engagement</DialogTitle>
          <DialogDescription>{practiceName}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Find engagement"
            placeholder="Find an engagement or client…"
            value={query}
            onValueChange={setQuery}
          />
          <div className="picker-options">
            <span>
              {matches.length}{" "}
              {matches.length === 1 ? "engagement" : "engagements"}
            </span>
            <label>
              Sort
              <select
                aria-label="Sort engagements"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="client">Client & name</option>
                <option value="due">Due date</option>
              </select>
            </label>
          </div>
          <CommandList>
            <CommandEmpty>
              {data.engagements.length
                ? "No matching engagements."
                : "No engagements in this practice."}
            </CommandEmpty>
            {recent.length > 0 && (
              <CommandGroup heading="Recent engagements">
                {recent.map((e) => item(e, true))}
              </CommandGroup>
            )}
            {sort === "due"
              ? visible.length > 0 && (
                  <CommandGroup heading="By due date">
                    {visible.map((e) => item(e, true))}
                  </CommandGroup>
                )
              : [...data.clients]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((client) => {
                    const audits = visible.filter(
                      (e) => e.client_id === client.id,
                    );
                    return audits.length ? (
                      <CommandGroup key={client.id} heading={client.name}>
                        {audits.map((e) => item(e))}
                      </CommandGroup>
                    ) : null;
                  })}
          </CommandList>
          {remaining > 0 && (
            <button
              className="picker-load-more"
              onClick={() => setLimit((n) => n + 50)}
            >
              Show more engagements ({remaining} remaining)
            </button>
          )}
        </Command>
        <footer>
          <span>↑ ↓ Navigate</span>
          <span>Enter Open</span>
          <span>Esc Close</span>
          <button onClick={closePicker}>Close</button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
