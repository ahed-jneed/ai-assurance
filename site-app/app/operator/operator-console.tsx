"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { OperatorEvent, PracticeSummary } from "@/lib/operator";

type ConsoleData = {
  operator: { email: string; name: string };
  abandonedAfterDays: number;
  practices: PracticeSummary[];
  events: OperatorEvent[];
};

/** Bytes as KB or MB for the listing. */
export function formatBytes(bytes: number) {
  return bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + " MB"
    : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

/**
 * The operator console: the abandoned practices (or all of them) with what
 * they store, a deletion that needs the practice's name typed and a reason,
 * and the operator audit trail.
 */
export function OperatorConsole() {
  const [data, setData] = useState<ConsoleData | null>(null),
    [all, setAll] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [deleting, setDeleting] = useState<PracticeSummary | null>(null),
    [confirmName, setConfirmName] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/operator" + (all ? "?all=1" : ""), {
      cache: "no-store",
    });
    const body = (await response.json()) as ConsoleData & { error?: string };
    if (!response.ok) setError(body.error ?? "The console could not load");
    else {
      setError("");
      setData(body);
    }
  }, [all]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the console data from the API when the filter changes
    void load();
  }, [load]);
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const response = await fetch("/api/operator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        op: "deletePractice",
        data: { tenantId: deleting.id, confirmName, reason },
      }),
    });
    const body = (await response.json()) as {
      error?: string;
      details?: { objects: number };
    };
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "The practice was not deleted");
      return;
    }
    setNotice(
      deleting.name +
        " was deleted with " +
        (body.details?.objects ?? 0) +
        " stored object(s). The deletion is recorded below.",
    );
    setDeleting(null);
    setConfirmName("");
    setReason("");
    await load();
  }
  return (
    <main className="operator-console">
      <h1>Operator console</h1>
      <p className="subtle">
        Signed in as {data?.operator.email ?? "a platform operator"}. A practice
        with no recorded activity for {data?.abandonedAfterDays ?? 90} days that
        released no report and signed no dossier counts as abandoned and may be
        deleted with its snapshots, records and stored objects. Every deletion
        is recorded in the operator audit trail.
      </p>
      {error && (
        <p role="alert" className="operator-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="panel">
        <h2 className="panel-title">
          {all ? "All practices" : "Abandoned practices"}
        </h2>
        <label className="operator-filter">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => setAll(event.target.checked)}
          />{" "}
          Show every practice
        </label>
        {data?.practices.length ? (
          <Table className="compact-register management-table">
            <TableHeader>
              <TableRow>
                <TableHead>Practice</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Engagements</TableHead>
                <TableHead>Snapshots</TableHead>
                <TableHead>Records</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.practices.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <b className="font-medium">{p.name}</b>
                    <span className="block subtle mono">{p.id}</span>
                  </TableCell>
                  <TableCell data-label="Last activity">
                    {p.lastActivity.slice(0, 10)}
                    <span className="block subtle">
                      created {p.createdAt.slice(0, 10)}
                    </span>
                  </TableCell>
                  <TableCell data-label="Members">
                    {p.activeMembers} active of {p.members}
                  </TableCell>
                  <TableCell data-label="Engagements">
                    {p.engagements}
                  </TableCell>
                  <TableCell data-label="Snapshots">
                    {p.snapshots} · {formatBytes(p.snapshotBytes)}
                  </TableCell>
                  <TableCell data-label="Records">{p.records}</TableCell>
                  <TableCell>
                    {p.abandoned ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setDeleting(p);
                          setConfirmName("");
                          setReason("");
                          setNotice("");
                        }}
                      >
                        Delete…
                      </Button>
                    ) : (
                      <span className="subtle">
                        {p.retained ? "Retained" : "Active"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="empty-result">
            {data
              ? all
                ? "No practices."
                : "No abandoned practices."
              : "Loading…"}
          </p>
        )}
      </section>
      {deleting && (
        <section className="panel" aria-label="Delete practice">
          <h2 className="panel-title">Delete {deleting.name}</h2>
          <p>
            This permanently deletes the practice, its {deleting.members}{" "}
            membership(s), {deleting.engagements} engagement(s),{" "}
            {deleting.snapshots} snapshot(s), {deleting.records} record(s),
            their audit trails and every stored object. It cannot be undone.
          </p>
          <label>
            Type the practice name to confirm
            <Input
              name="confirmName"
              value={confirmName}
              autoComplete="off"
              onChange={(event) => setConfirmName(event.target.value)}
            />
          </label>
          <label>
            Reason (recorded in the audit trail)
            <Textarea
              name="reason"
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="operator-actions">
            <Button
              variant="destructive"
              disabled={
                busy ||
                confirmName.trim() !== deleting.name ||
                reason.trim().length < 10
              }
              onClick={() => void remove()}
            >
              Delete practice permanently
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
          </div>
        </section>
      )}
      <section className="panel">
        <h2 className="panel-title">Operator audit trail</h2>
        {data?.events.length ? (
          <ol className="record-list">
            {data.events.map((e) => (
              <li key={e.id}>
                <b>{e.action}</b> · {e.tenantId}
                {typeof e.details.name === "string"
                  ? " (" + e.details.name + ")"
                  : ""}{" "}
                · {e.actorEmail} · {e.createdAt.slice(0, 19).replace("T", " ")}
                {typeof e.details.reason === "string" && (
                  <span className="block subtle">{e.details.reason}</span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty-result">No operator actions recorded.</p>
        )}
      </section>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full-page navigation back to the workspace */}
      <a href="/">Return to workspace</a>
    </main>
  );
}
