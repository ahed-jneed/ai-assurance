"use client";
// The engagement's audit trail (#181): every audit event, newest first, in
// pages of the server's trail (GET /api/audit-trail through the query cache,
// lib/event-log-queries.ts), filtered by person, event type and date.
import { useMemo } from "react";
import { History } from "lucide-react";
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
import { trailQuery } from "@/lib/event-log-queries";
import { humanLabel } from "@/lib/presentation";
import {
  EventLogFilterBar,
  EventLogPager,
  EventTime,
  filtered,
  useEventLog,
  useFacets,
} from "./event-log";
import { ViewLoading } from "./view-loading";
import type { ViewDetail } from "./workspace/types";

export function AuditTrail({
  tenantId,
  engagementId,
  version,
  onDetail,
}: {
  tenantId: string;
  engagementId: string;
  /** The engagement version shown: a newer one reads the page again. */
  version: number;
  onDetail: ViewDetail;
}) {
  const log = useEventLog();
  const query = useMemo(
    () => trailQuery(log.filters, log.cursor),
    [log.filters, log.cursor],
  );
  const trail = useAssuranceQuery({ tenantId, engagementId, version }, query);
  const page = trail.data,
    facets = useFacets(page);
  return (
    <section className="panel event-log" aria-label="Audit history">
      <EventLogFilterBar
        log={log}
        label="Filter the audit history"
        actors={facets.actors}
        actions={facets.actions}
        actionLabel={humanLabel}
      />
      {trail.error && (
        <div className="event-log-error" role="alert">
          <span>{trail.error}</span>
          <Button variant="outline" size="sm" onClick={trail.reload}>
            Try again
          </Button>
        </div>
      )}
      {trail.loading ? (
        <ViewLoading label="Loading audit history" rows={2} />
      ) : page?.events.length ? (
        <Table aria-label="Audit events">
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Person</TableHead>
              <TableHead>
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <EventTime at={event.created_at} />
                </TableCell>
                <TableCell>{humanLabel(event.action)}</TableCell>
                <TableCell>{event.actor_name}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDetail("Audit event", event)}
                  >
                    Details
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        page && (
          <div className="empty-state">
            <History size={28} />
            <h3>
              {filtered(log.filters)
                ? "No audit events match the filters"
                : "No audit activity yet"}
            </h3>
          </div>
        )
      )}
      {page && (
        <EventLogPager
          log={log}
          shown={page.events.length}
          next={page.next}
          fetching={trail.fetching}
          noun="audit events"
        />
      )}
    </section>
  );
}
