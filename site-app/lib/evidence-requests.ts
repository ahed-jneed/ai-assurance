import { z } from "./zod";
import {
  canWrite,
  type Engagement,
  type EvidenceRequest,
  type Paper,
  type Role,
} from "./domain/types";

export const evidenceRequestOps = [
  "createEvidenceRequest",
  "updateEvidenceRequest",
  "recordEvidenceResponse",
  "assessEvidenceRequest",
  "closeEvidenceRequest",
  "reopenEvidenceRequest",
];
export class EvidenceRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const short = z.string().trim().min(1).max(300),
  text = z.string().trim().min(1).max(5000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Choose a valid calendar date");
const specification = z
  .object({
    subject: short,
    description: text,
    responsibleParty: short,
    periodVersion: short,
    handling: text,
    dueDate: date,
    paperIds: z.array(short).min(1).max(20),
  })
  .strict();
export function requestLabel(
  r: Pick<EvidenceRequest, "status" | "disposition">,
) {
  return r.status === "waived"
    ? r.disposition === "unobtainable"
      ? "Closed with limitation"
      : "No longer requested"
    : {
        open: "Awaiting evidence",
        submitted: "Needs assessment",
        accepted: "Sufficient for procedure",
        returned: "More evidence needed",
      }[r.status];
}
export function requestClosed(r: Pick<EvidenceRequest, "status">) {
  return ["accepted", "waived"].includes(r.status);
}
export function requestOverdue(r: EvidenceRequest, today: string) {
  return !requestClosed(r) && r.dueDate < today;
}
export function evidenceRequestCommand(
  e: Engagement,
  op: string,
  data: unknown,
  ctx: {
    role: Role;
    userId: string;
    at: string;
    id: () => string;
    makeLimitationPaper: () => Paper;
  },
) {
  const fail = (status: number, message: string): never => {
    throw new EvidenceRequestError(status, message);
  };
  if (!canWrite(ctx.role))
    fail(403, "Only an Auditor or Lead Auditor can manage evidence requests");
  const requests = e.evidenceRequests ?? [],
    byId = (value: string) =>
      requests.find((r) => r.id === value) ??
      fail(404, "Evidence request not found");
  const papers = (ids: string[]) => {
    if (ids.some((id) => !e.papers.some((p) => p.id === id)))
      fail(400, "Link working papers from this engagement");
  };
  const accepted = (ids: string[]) =>
    ids.length > 0 &&
    ids.every((id) =>
      e.artifacts.some((a) => a.id === id && a.status === "accepted"),
    );
  const archive = (r: EvidenceRequest) => {
    if (r.history.length >= 50)
      fail(
        413,
        "This request reached its revision limit. Create a follow-up request.",
      );
    const { history, ...snapshot } = r;
    r.history.push(structuredClone(snapshot));
    r.revision++;
    r.updatedAt = ctx.at;
    r.updatedBy = ctx.userId;
  };
  if (op === "createEvidenceRequest") {
    const a = specification.parse(data);
    papers(a.paperIds);
    if (requests.length >= 200)
      fail(413, "This engagement reached its evidence request limit");
    const r: EvidenceRequest = {
      ...a,
      paperIds: [...new Set(a.paperIds)],
      id: ctx.id(),
      required: true,
      status: "open",
      evidenceIds: [],
      response: "",
      assessment: "",
      createdAt: ctx.at,
      updatedAt: ctx.at,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
      revision: 1,
      history: [],
    };
    e.evidenceRequests = [...requests, r];
    return { requestId: r.id, status: r.status };
  }
  if (op === "updateEvidenceRequest") {
    const a = specification.extend({ requestId: short }).parse(data),
      r = byId(a.requestId);
    if (!["open", "returned"].includes(r.status))
      fail(
        409,
        "Reopen or return this request before changing its requirements",
      );
    papers(a.paperIds);
    archive(r);
    const { requestId, ...fields } = a;
    Object.assign(r, fields, {
      paperIds: [...new Set(a.paperIds)],
      status: "open",
      assessment: "",
      disposition: undefined,
    });
    return { requestId: r.id, status: r.status };
  }
  if (op === "recordEvidenceResponse") {
    const a = z
        .object({
          requestId: short,
          response: text,
          evidenceIds: z.array(short).min(1).max(100),
          deliveryComplete: z.boolean().optional(),
          remainingItems: z.string().max(5000).optional(),
        })
        .strict()
        .parse(data),
      r = byId(a.requestId);
    if (requestClosed(r))
      fail(
        409,
        "A Lead Auditor must reopen the completed request before changing its response",
      );
    if (a.deliveryComplete === false && !a.remainingItems?.trim())
      fail(400, "Explain which requested items remain outstanding");
    if (r.deliveryComplete === false && a.deliveryComplete === undefined)
      fail(
        400,
        "Deliberately record whether the partial delivery has been resolved",
      );
    if (a.evidenceIds.some((id) => !e.artifacts.some((t) => t.id === id)))
      fail(400, "Link evidence files from this engagement");
    archive(r);
    Object.assign(r, {
      response: a.response,
      deliveryComplete: a.deliveryComplete ?? true,
      remainingItems: a.remainingItems ?? "",
      evidenceIds: [...new Set(a.evidenceIds)],
      status: "submitted",
      assessment: "",
      disposition: undefined,
    });
    return { requestId: r.id, status: r.status };
  }
  if (op === "assessEvidenceRequest") {
    const a = z
        .object({
          requestId: short,
          decision: z.enum(["accepted", "returned"]),
          assessment: text,
        })
        .strict()
        .parse(data),
      r = byId(a.requestId);
    if (r.status !== "submitted")
      fail(409, "Record an evidence response before assessing it");
    if (a.decision === "accepted" && r.deliveryComplete === false)
      fail(
        400,
        "Resolve the partial submission and outstanding items before accepting sufficiency",
      );
    if (a.decision === "accepted" && !accepted(r.evidenceIds))
      fail(
        400,
        "Sufficiency requires accepted evidence files from this engagement",
      );
    archive(r);
    Object.assign(r, {
      status: a.decision,
      assessment: a.assessment,
      disposition: a.decision === "accepted" ? "sufficient" : undefined,
    });
    return { requestId: r.id, status: r.status };
  }
  if (op === "closeEvidenceRequest") {
    if (ctx.role !== "Lead Auditor")
      fail(
        403,
        "A Lead Auditor must approve evidence limitations and scope changes",
      );
    const a = z
        .object({
          requestId: short,
          disposition: z.enum(["unobtainable", "no_longer_required"]),
          assessment: text,
        })
        .strict()
        .parse(data),
      r = byId(a.requestId);
    if (requestClosed(r))
      fail(409, "Reopen this request before replacing its disposition");
    // Closing a reopened request again revises its retired memo, so each
    // request keeps one limitation memo with the earlier revisions as history.
    const previous = e.papers.find((p) => p.id === r.limitationPaperId),
      memo = previous ?? ctx.makeLimitationPaper();
    if (previous) {
      memo.history.push({
        revision: memo.revision,
        body: { ...memo.body },
        authorId: memo.authorId,
        at: memo.updatedAt,
        evidenceIds: [...memo.evidenceIds],
        runIds: [...memo.runIds],
        reviews: [...memo.reviews],
        signatures: [...memo.signatures],
        contributors: [...(memo.contributors ?? [])],
      });
      memo.revision++;
      memo.authorId = ctx.userId;
      memo.updatedAt = ctx.at;
      memo.status = "draft";
      memo.reviews = [];
      memo.signatures = [];
      delete memo.retired;
    }
    memo.required = true;
    memo.title =
      a.disposition === "unobtainable"
        ? "Evidence availability limitation"
        : "Evidence scope change";
    memo.body.scope = r.periodVersion;
    memo.body.results = `Request: ${r.subject}\nRequested evidence: ${r.description}\nResponsible party: ${r.responsibleParty}\nDisposition rationale: ${a.assessment}`;
    memo.body.limitations = a.assessment;
    memo.body.conclusion = "";
    memo.body.conclusionStatus = "not_evaluated";
    memo.evidenceIds = r.evidenceIds.filter((id) =>
      e.artifacts.some((t) => t.id === id && t.status === "accepted"),
    );
    archive(r);
    Object.assign(r, {
      status: "waived",
      disposition: a.disposition,
      assessment: a.assessment,
      limitationPaperId: memo.id,
    });
    if (!previous) e.papers.push(memo);
    return { requestId: r.id, status: r.status, paperId: memo.id };
  }
  if (op === "reopenEvidenceRequest") {
    if (ctx.role !== "Lead Auditor")
      fail(403, "A Lead Auditor must reopen a completed evidence request");
    const a = z.object({ requestId: short, reason: text }).strict().parse(data),
      r = byId(a.requestId);
    if (!requestClosed(r))
      fail(409, "Only a completed request can be reopened");
    archive(r);
    Object.assign(r, {
      status: "returned",
      assessment: a.reason,
      disposition: undefined,
    });
    // The limitation no longer applies while the request is open again: its
    // memo is retired until closing the request again revises it.
    const memo = e.papers.find((p) => p.id === r.limitationPaperId);
    if (memo) {
      memo.retired = {
        requestId: r.id,
        actor: ctx.userId,
        at: ctx.at,
        reason: a.reason,
      };
      memo.required = false;
    }
    return { requestId: r.id, status: r.status };
  }
  return fail(400, "Unknown evidence request command");
}
