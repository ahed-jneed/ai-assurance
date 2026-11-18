// Follow-up commands: monitoring, change, incident and remediation cases
// after the engagement, their assessment and independent closure.
//
// Closure rests on accepted evidence, except a reassessment decision, which
// the linked successor engagement carries. Deciding that no reassessment is
// needed concludes the case, so it needs its evidence when it is recorded; a
// follow-up decision may be recorded first and its evidence in a later
// assessment, before closure.
import { z } from "../zod";
import { monitoringClosureRefusal } from "../preconditions";
import type { MonitoringCase } from "../workflow-types";
import {
  calendarDate,
  fail,
  short,
  text,
  uid,
  type WorkflowHandler,
} from "./command";
/** The refusal for assessing or closing a case that is already closed. */
const closedCase =
  "This case is already closed. Create a new case for subsequent work";

export const monitoringCommands: Record<string, WorkflowHandler> = {
  async createMonitoringCase({ e, c, writer, authorized, w }, data) {
    writer();
    const a = z
      .object({
        kind: z.enum(["monitoring", "change", "incident", "remediation"]),
        title: short,
        description: text,
        ownerId: short,
        dueDate: calendarDate,
        cadence: z.enum(["one_off", "monthly", "quarterly", "annual"]),
        findingId: uid,
        reportId: uid,
        previousCaseId: short.optional(),
      })
      .strict()
      .parse(data);
    await authorized(a.ownerId, ["Auditor", "Lead Auditor"]);
    if (a.findingId && !e.findings.some((f) => f.id === a.findingId))
      fail(400, "Select a finding from this engagement");
    if (
      a.reportId &&
      !e.reports.some((r) => r.id === a.reportId && r.kind === "final")
    )
      fail(400, "Select a final report from this engagement");
    const x = w();
    if (x.monitoring.length >= 150) fail(413, "Follow-up case limit reached");
    const m: MonitoringCase = {
      ...a,
      id: c.id("CASE"),
      state: "open",
      decision: "not_assessed",
      assessment: "",
      evidenceIds: [],
      contributors: [c.userId],
      createdBy: c.userId,
      createdAt: c.at,
      updatedAt: c.at,
      history: [],
    };
    if (a.previousCaseId) {
      const previous = x.monitoring.find((q) => q.id === a.previousCaseId);
      if (
        !previous ||
        previous.state !== "closed" ||
        previous.cadence === "one_off" ||
        previous.nextCaseId ||
        a.dueDate <= previous.dueDate
      )
        fail(
          409,
          "Plan one later cycle from a closed recurring monitoring case",
        );
      previous.nextCaseId = m.id;
      previous.history.push({
        at: c.at,
        actor: c.userId,
        action: "plan_next_cycle",
        state: previous.state,
        assessment: m.description,
        evidenceIds: [...previous.evidenceIds],
      });
    }
    x.monitoring.push(m);
    return { caseId: m.id };
  },
  async assessMonitoringCase({ c, writer, w, accepted }, data) {
    writer();
    const a = z
        .object({
          caseId: short,
          decision: z.enum([
            "follow_up",
            "no_reassessment",
            "reassessment_required",
          ]),
          assessment: text,
          evidenceIds: z.array(short).max(100),
          dueDate: calendarDate,
        })
        .strict()
        .parse(data),
      m =
        w().monitoring.find((q) => q.id === a.caseId) ??
        fail(404, "Follow-up case not found");
    if (m.state === "closed") fail(409, closedCase);
    if (a.decision === "no_reassessment" && !a.evidenceIds.length)
      fail(
        400,
        "Link the accepted evidence that shows no reassessment is needed",
      );
    if (a.evidenceIds.length) accepted(a.evidenceIds);
    m.history.push({
      at: c.at,
      actor: c.userId,
      action: "assess",
      state: m.state,
      assessment: m.assessment,
      evidenceIds: [...m.evidenceIds],
    });
    Object.assign(m, a, {
      state: "in_progress",
      updatedAt: c.at,
      contributors: [...new Set([...m.contributors, c.userId])],
    });
    return { caseId: m.id };
  },
  async closeMonitoringCase({ e, c, independent, w }, data) {
    const a = z.object({ caseId: short, closure: text }).strict().parse(data),
      m =
        w().monitoring.find((q) => q.id === a.caseId) ??
        fail(404, "Follow-up case not found");
    // A closed case is refused before independence is checked: nobody may
    // close it again (#209).
    if (m.state === "closed") fail(409, closedCase);
    independent([...m.contributors, m.ownerId]);
    // One closure rule, which the workspace also shows (#216, as
    // releaseReport does with releaseRefusal).
    const refusal = monitoringClosureRefusal(e, m);
    if (refusal) fail(refusal.status, refusal.message);
    m.history.push({
      at: c.at,
      actor: c.userId,
      action: "close",
      state: m.state,
      assessment: a.closure,
      evidenceIds: [...m.evidenceIds],
    });
    Object.assign(m, {
      state: "closed",
      closedBy: c.userId,
      closedAt: c.at,
      closure: a.closure,
      updatedAt: c.at,
    });
    return { caseId: m.id };
  },
};
