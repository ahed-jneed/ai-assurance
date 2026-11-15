// Finding assurance commands: the support behind a finding, the
// independent retest of its remediation and reopening a closed finding.
import { z } from "zod";
import { defaultFindingCriteria } from "../criteria/pin";
import { fail, short, text, uid, type WorkflowHandler } from "./command";
export const findingAssuranceCommands: Record<string, WorkflowHandler> = {
  async linkFindingSupport({ e, c, writer, procedure, accepted }, data) {
    writer();
    const a = z
        .object({
          findingId: short,
          procedureId: uid,
          paperIds: z.array(short).max(30),
          evidenceIds: z.array(short).max(100),
          runIds: z.array(short).max(30),
        })
        .strict()
        .parse(data),
      f =
        e.findings.find((f) => f.id === a.findingId) ??
        fail(404, "Finding not found");
    const linked = a.procedureId ? procedure(a.procedureId) : undefined;
    if (
      a.paperIds.some((id) => !e.papers.some((p) => p.id === id)) ||
      a.runIds.some((id) => !e.runs.some((r) => r.id === id))
    )
      fail(400, "Support must belong to this engagement");
    accepted(a.evidenceIds);
    f.support = { ...a, actor: c.userId, at: c.at };
    // A finding without criteria takes those of its procedure's item
    // (docs/design/criteria-model.md section 7, phase 2).
    if (linked && !f.criteriaRefs?.length) {
      const refs = defaultFindingCriteria(e, linked.templateId);
      if (refs.length) f.criteriaRefs = refs;
    }
    return { findingId: f.id };
  },
  async recordFindingRetest({ e, c, reviewer, accepted }, data) {
    reviewer();
    const a = z
        .object({
          findingId: short,
          performed: text,
          results: text,
          rationale: text,
          evidenceIds: z.array(short).max(100),
          conclusion: z.enum(["effective", "not_effective"]),
        })
        .strict()
        .parse(data),
      f =
        e.findings.find((f) => f.id === a.findingId) ??
        fail(404, "Finding not found");
    // A required field of the form, refused in its words (#241).
    if (!a.evidenceIds.length)
      fail(400, "Select the evidence the retest relied on");
    if (f.createdBy === c.userId || f.remediationBy === c.userId)
      fail(403, "An independent person must perform the retest");
    if (f.status !== "ready_for_retest" || !f.remediation.trim())
      fail(409, "Record management remediation and request retest first");
    accepted(a.evidenceIds);
    f.retest = { ...a, actor: c.userId, at: c.at };
    f.retestEvidenceIds = [...a.evidenceIds];
    return { findingId: f.id };
  },
  async reopenFinding({ e, c, lead }, data) {
    lead();
    const a = z.object({ findingId: short, reason: text }).strict().parse(data),
      f =
        e.findings.find((f) => f.id === a.findingId) ??
        fail(404, "Finding not found");
    if (f.status !== "closed")
      fail(409, "Only a closed finding can be reopened");
    f.closureHistory ??= [];
    f.closureHistory.push({
      at: c.at,
      actor: c.userId,
      reason: a.reason,
      closedBy: f.closedBy,
      retest: f.retest,
    });
    f.status = "open";
    f.closedBy = undefined;
    f.retest = undefined;
    return { findingId: f.id };
  },
};
