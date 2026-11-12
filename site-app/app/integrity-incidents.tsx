"use client";
// The practice's engagement integrity incidents (#16, #121): engagement
// records that a member found damaged while loading them (a D1 body that is
// not JSON, or an R2 part that is missing, unavailable or altered). Practice
// administrators see them beside the engagement directory.
import { ShieldAlert } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  IntegrityIncidents,
  IntegrityKind,
} from "@/lib/engagement-storage";

const problems: Record<IntegrityKind, string> = {
  missing: "Stored part missing",
  unavailable: "Storage unavailable",
  mismatch: "Stored part altered",
  unreadable: "Record unreadable",
};
/** What a kind of incident means and what usually resolves it. */
const meaning: Record<IntegrityKind, string> = {
  missing:
    "An immutable part of the record is no longer in object storage. Restore it from a backup; the record stays closed until then.",
  unavailable:
    "Object storage did not answer. This is usually temporary; if it repeats, check the storage service.",
  mismatch:
    "A stored part no longer matches its recorded hash, so it was changed after it was written. Treat the record as tampered with until it is restored.",
  unreadable:
    "The engagement's database record is not valid JSON. Restore it from a backup.",
};
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
/** The part of an object key that names the stored object. */
function objectLabel(key: string) {
  if (key === "body") return "Engagement record (database)";
  const type = key.split("/immutable/")[1]?.split("/")[0];
  return type ? type.replaceAll("-", " ") + " (object storage)" : key;
}

export function IntegrityIncidentsPanel({
  incidents,
  onEngagement,
}: {
  incidents: IntegrityIncidents;
  onEngagement: (id: string) => void;
}) {
  if (!incidents.count) return null;
  const shown = incidents.incidents.length;
  return (
    <section
      className="panel integrity-incidents"
      aria-labelledby="integrity-incidents-title"
    >
      <div className="integrity-incidents-head">
        <ShieldAlert size={18} aria-hidden="true" />
        <div>
          <h2 className="panel-title" id="integrity-incidents-title">
            Integrity incidents
          </h2>
          <p className="subtle">
            {incidents.count === 1
              ? "Members found 1 damaged engagement record."
              : "Members found " +
                incidents.count.toLocaleString() +
                " damaged engagement records."}{" "}
            Each damaged engagement stays closed; the others work as before.
            {incidents.count > shown &&
              " Showing the " + shown + " most recently seen."}
          </p>
        </div>
      </div>
      <Table className="compact-register management-table">
        <TableHeader>
          <TableRow>
            <TableHead>Engagement</TableHead>
            <TableHead>Problem</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead>Occurrences</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {incidents.incidents.map((i) => (
            <TableRow key={i.engagementId + i.objectKey + i.kind}>
              <TableCell>
                {i.title ? (
                  <button
                    className="paper-link"
                    onClick={() => onEngagement(i.engagementId)}
                  >
                    {i.title}
                  </button>
                ) : (
                  <span>Deleted engagement</span>
                )}
                <span className="block subtle mono">{i.engagementId}</span>
              </TableCell>
              <TableCell data-label="Problem">
                <span className="badge red" title={meaning[i.kind]}>
                  {problems[i.kind] ?? i.kind}
                </span>
                <span className="block subtle">{objectLabel(i.objectKey)}</span>
                <details className="account-id">
                  <summary>Details</summary>
                  <p>{meaning[i.kind]}</p>
                  <span className="mono">{i.objectKey}</span>
                </details>
              </TableCell>
              <TableCell data-label="Last seen">
                {when(i.lastSeen)}
                <span className="block subtle">by {i.lastSeenBy}</span>
                <span className="block subtle">first {when(i.firstSeen)}</span>
              </TableCell>
              <TableCell data-label="Occurrences">
                {i.occurrences.toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
