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
import { errorMessage, fetchJson, postJson } from "@/lib/fetch-json";
import type {
  IssuedWork,
  OperatorEvent,
  PartCheck,
  PracticeCursor,
  PracticeSummary,
} from "@/lib/operator";

type ConsoleData = {
  operator: { email: string; name: string };
  abandonedAfterDays: number;
  practices: PracticeSummary[];
  /** Where the next page of the listing starts, or null on the last. */
  next: PracticeCursor | null;
  events: OperatorEvent[];
};

/** What the operator is about to do to a practice. */
type Pending = {
  practice: PracticeSummary;
  op: "deletePractice" | "archivePractice";
};

/** Bytes as KB or MB for the listing. */
export function formatBytes(bytes: number) {
  return bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + " MB"
    : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

/** One integrity check of an issued part, as the console words it. */
export function partLabel(check: PartCheck) {
  return {
    valid: "matches its digest",
    mismatch: "does not match its digest",
    missing: "is missing",
    unavailable: "could not be read now",
    unreadable: "is unreadable",
  }[check];
}

/** The status cell of a practice the operator may not act on. */
export function practiceStatus(p: PracticeSummary) {
  if (p.archivedAt) return "Archived " + p.archivedAt.slice(0, 10);
  return p.retained ? "Retained" : "Active";
}

/**
 * The operator console: the abandoned and archived practices (or all of
 * them), longest inactive first and paged by last activity, with what they
 * store; a deletion of one without issued work, or an archive of one
 * with issued work (#151), each needing the practice's name typed and a
 * reason; an archived practice's issued work for verification requests; and
 * the operator audit trail.
 */
export function OperatorConsole() {
  const [data, setData] = useState<ConsoleData | null>(null),
    [all, setAll] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<Pending | null>(null),
    [issued, setIssued] = useState<IssuedWork | null>(null),
    [confirmName, setConfirmName] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const read = useCallback(
    () =>
      fetchJson<ConsoleData>("/api/operator" + (all ? "?all=1" : ""), {
        cache: "no-store",
      }).then(
        (body) => ({ ok: true as const, body }),
        (x: unknown) => ({
          ok: false as const,
          error: errorMessage(x, "The console could not load"),
        }),
      ),
    [all],
  );
  const show = useCallback((result: Awaited<ReturnType<typeof read>>) => {
    if (!result.ok) setError(result.error);
    else {
      setError("");
      setData(result.body);
    }
  }, []);
  const load = async () => show(await read());
  useEffect(() => {
    // A response for a filter that has since changed is dropped.
    let active = true;
    void read().then((result) => {
      if (active) show(result);
    });
    return () => {
      active = false;
    };
  }, [read, show]);
  /** Appends the next page of practices to the listing. */
  async function more() {
    if (!data?.next) return;
    setBusy(true);
    const query = new URLSearchParams({
      afterActivity: data.next.lastActivity,
      afterId: data.next.id,
      ...(all ? { all: "1" } : {}),
    });
    try {
      const body = await fetchJson<ConsoleData>("/api/operator?" + query, {
        cache: "no-store",
      });
      setError("");
      setData({
        ...body,
        practices: [...data.practices, ...body.practices],
      });
    } catch (x) {
      setError(errorMessage(x, "The next page could not load"));
    } finally {
      setBusy(false);
    }
  }
  function start(practice: PracticeSummary, op: Pending["op"]) {
    setPending({ practice, op });
    setIssued(null);
    setConfirmName("");
    setReason("");
    setNotice("");
  }
  async function showIssued(practice: PracticeSummary) {
    setPending(null);
    try {
      const body = await fetchJson<{ issued?: IssuedWork }>(
        "/api/operator?tenantId=" + encodeURIComponent(practice.id),
        { cache: "no-store" },
      );
      if (!body.issued) throw new Error("The issued work could not load");
      setError("");
      setIssued(body.issued);
    } catch (x) {
      setError(errorMessage(x, "The issued work could not load"));
    }
  }
  async function submit() {
    if (!pending) return;
    const { practice, op } = pending;
    setBusy(true);
    let body: { details?: { objects?: number; members?: number } };
    try {
      body = await postJson<typeof body>("/api/operator", {
        op,
        data: { tenantId: practice.id, confirmName, reason },
      });
    } catch (x) {
      setError(
        errorMessage(
          x,
          op === "archivePractice"
            ? "The practice was not archived"
            : "The practice was not deleted",
        ),
      );
      return;
    } finally {
      setBusy(false);
    }
    setNotice(
      op === "archivePractice"
        ? practice.name +
            " was archived: " +
            (body.details?.members ?? 0) +
            " member(s) lost access and its issued records are retained. It stays listed here as archived; open its issued work to answer a verification request. The archive is recorded below."
        : practice.name +
            " was deleted with " +
            (body.details?.objects ?? 0) +
            " stored object(s). The deletion is recorded below.",
    );
    setPending(null);
    setConfirmName("");
    setReason("");
    await load();
  }
  const archiving = pending?.op === "archivePractice";
  return (
    <main className="operator-console">
      <h1>Operator console</h1>
      <p className="subtle">
        Signed in as {data?.operator.email ?? "a platform operator"}. A practice
        with no recorded activity for {data?.abandonedAfterDays ?? 90} days that
        released no report and signed no dossier counts as abandoned and may be
        deleted with its snapshots, records and stored objects. One that
        released a report or signed a dossier is never deleted: it is archived
        instead, so its members lose access while its issued records stay
        retained and verifiable. Every deletion and archive is recorded in the
        operator audit trail.
      </p>
      {error && (
        <p role="alert" className="operator-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="panel">
        <h2 className="panel-title">
          {all ? "All practices" : "Abandoned and archived practices"}
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
                        onClick={() => start(p, "deletePractice")}
                      >
                        Delete…
                      </Button>
                    ) : p.archivable ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => start(p, "archivePractice")}
                      >
                        Archive…
                      </Button>
                    ) : p.archivedAt ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void showIssued(p)}
                      >
                        {practiceStatus(p)} · issued work
                      </Button>
                    ) : (
                      <span className="subtle">{practiceStatus(p)}</span>
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
                : "No abandoned or archived practices."
              : "Loading…"}
          </p>
        )}
      </section>
      {data?.next && (
        <Button variant="outline" disabled={busy} onClick={() => void more()}>
          Show more practices
        </Button>
      )}
      {pending && (
        <section
          className="panel"
          aria-label={archiving ? "Archive practice" : "Delete practice"}
        >
          <h2 className="panel-title">
            {archiving ? "Archive " : "Delete "}
            {pending.practice.name}
          </h2>
          {archiving ? (
            <p>
              This practice released a report or signed a dossier, so it is
              archived instead of deleted. Its {pending.practice.activeMembers}{" "}
              active member(s) lose access, its pending invitations are
              cancelled and its runner workers stop. Its{" "}
              {pending.practice.engagements} engagement(s),{" "}
              {pending.practice.snapshots} snapshot(s),{" "}
              {pending.practice.records} record(s), audit trails and stored
              objects are retained. An archive cannot be undone here.
            </p>
          ) : (
            <p>
              This permanently deletes the practice, its{" "}
              {pending.practice.members} membership(s),{" "}
              {pending.practice.engagements} engagement(s),{" "}
              {pending.practice.snapshots} snapshot(s),{" "}
              {pending.practice.records} record(s), their audit trails and every
              stored object. It cannot be undone.
            </p>
          )}
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
                confirmName.trim() !== pending.practice.name ||
                reason.trim().length < 10
              }
              onClick={() => void submit()}
            >
              {archiving ? "Archive practice" : "Delete practice permanently"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
          </div>
        </section>
      )}
      {issued && (
        <section className="panel" aria-label="Issued work">
          <h2 className="panel-title">Issued work of {issued.name}</h2>
          <p className="subtle">
            Archived {issued.archivedAt.slice(0, 10)}. Identifiers and digests
            only. Each report package is read back from storage now and rebuilt
            against the report&apos;s recorded digest; each dossier record and
            its signed archive are rehashed against their recorded digests. Give
            a requester the verification keys through a channel independent of
            this server.
          </p>
          <h3>Released reports</h3>
          {issued.reports.length ? (
            <ul className="record-list">
              {issued.reports.map((r) => (
                <li key={r.engagementId + r.reportId}>
                  <b>{r.reportId}</b> · {r.engagementId} · {r.kind} · {r.state}
                  {r.releasedAt ? " " + r.releasedAt.slice(0, 10) : ""} ·
                  internal package {partLabel(r.internal)}
                  {r.client ? " · client package " + partLabel(r.client) : ""}
                  <span className="block subtle mono">{r.sha256}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-result">No released reports.</p>
          )}
          <h3>Signed dossiers</h3>
          {issued.dossiers.length ? (
            <ul className="record-list">
              {issued.dossiers.map((d) => (
                <li key={d.recordId}>
                  <b>{d.recordId}</b> · {d.engagementId}
                  {d.reportId ? " · " + d.reportId : ""}
                  {d.audience ? " · " + d.audience : ""} ·{" "}
                  {d.createdAt.slice(0, 10)} · record {partLabel(d.record)} ·
                  signed archive {partLabel(d.archive)}
                  <span className="block subtle mono">{d.sha256}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-result">No signed dossiers.</p>
          )}
          <h3>Verification keys</h3>
          {issued.keys.length ? (
            <ul className="record-list">
              {issued.keys.map((k) => (
                <li key={k.keyId}>
                  <b>{k.keyId}</b> · {k.status}
                  <span className="block subtle mono">{k.publicKeySPKI}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-result">No verification keys.</p>
          )}
          <Button variant="ghost" onClick={() => setIssued(null)}>
            Close
          </Button>
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
