"use client";
// The practice's Access log (#181): who was given, changed or lost
// membership, a role or practice administration, the invitations behind
// that, and members' sign-ins, newest first in pages of GET /api/access-log
// (through the query cache, lib/event-log-queries.ts), filtered by who acted,
// the person involved (who acted or was acted on), event type and date, and exported as CSV. For practice administrators
// only, of any staff role (canSeeAccessLog); the server checks the same.
import { useMemo } from "react";
import { Download, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAssuranceQuery } from "@/hooks/use-assurance-query";
import { accessLogCsvHref, accessLogQuery } from "@/lib/event-log-queries";
import {
  accessEventLabel,
  signInGapHours,
  signInRetentionDays,
} from "@/lib/access-events";
import {
  EventLogFilterBar,
  EventLogPager,
  EventTime,
  filtered,
  useEventLog,
  useFacets,
} from "./event-log";
import { ViewLoading } from "./view-loading";
import type { WorkspaceData } from "./workspace-types";

export function AccessLog({ data }: { data: WorkspaceData }) {
  const log = useEventLog();
  const query = useMemo(
    () => accessLogQuery(log.filters, log.cursor),
    [log.filters, log.cursor],
  );
  // The practice's own entry of the query cache: no engagement, read again
  // when the management version moves.
  const entries = useAssuranceQuery(
    {
      tenantId: data.tenantId,
      engagementId: "",
      version: data.managementVersion,
    },
    query,
    { revalidateOnFocus: true },
  );
  const page = entries.data,
    facets = useFacets(page);
  return (
    <>
      <div className="page-head">
        <div className="page-heading">
          <ScrollText size={22} aria-hidden="true" />
          <h1>Access log</h1>
        </div>
      </div>
      <p className="subtle event-log-intro">
        Membership, role and practice administration changes, the invitations
        behind them, and sign-ins. A sign-in is recorded on a member&apos;s
        first visit to the practice after {signInGapHours} hours without one,
        and kept for {signInRetentionDays} days.
      </p>
      <section className="panel event-log" aria-label="Access events">
        <EventLogFilterBar
          log={log}
          label="Filter the Access log"
          actorLabel="Acted by"
          actors={facets.actors}
          people={facets.people ?? []}
          actions={facets.actions}
          actionLabel={accessEventLabel}
        >
          <a
            className="event-log-export"
            href={accessLogCsvHref(data.tenantId, log.filters)}
            download
          >
            <Download size={15} aria-hidden="true" />
            {filtered(log.filters) ? "Export filtered CSV" : "Export CSV"}
          </a>
        </EventLogFilterBar>
        {entries.error && (
          <div className="event-log-error" role="alert">
            <span>{entries.error}</span>
            <Button variant="outline" size="sm" onClick={entries.reload}>
              Try again
            </Button>
          </div>
        )}
        {entries.loading ? (
          <ViewLoading label="Loading the Access log" rows={2} />
        ) : page?.events.length ? (
          <Table aria-label="Access events">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <EventTime at={event.created_at} />
                  </TableCell>
                  <TableCell>{accessEventLabel(event.action)}</TableCell>
                  <TableCell>{event.actor_name}</TableCell>
                  <TableCell>{event.subject_name ?? "—"}</TableCell>
                  <TableCell>{event.role ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          page && (
            <div className="empty-state">
              <ScrollText size={28} aria-hidden="true" />
              <h3>
                {filtered(log.filters)
                  ? "No access events match the filters"
                  : "No access events yet"}
              </h3>
            </div>
          )
        )}
        {page && (
          <EventLogPager
            log={log}
            shown={page.events.length}
            next={page.next}
            fetching={entries.fetching}
            noun="access events"
          />
        )}
      </section>
    </>
  );
}
