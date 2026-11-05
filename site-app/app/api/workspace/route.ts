import { records } from "@/lib/assurance-store";
import { z } from "zod";
import catalog from "@/lib/catalog.json";
import annexMap from "@/lib/annex-iv-map.json";
import {
  ApiError,
  context,
  db,
  getEngagement,
  now,
  id,
  requireRole,
  responseError,
  save,
  sha256,
  templatePaper,
  freshEngagement,
  sanitize,
  readBounded,
  checkOrigin,
} from "@/lib/store";
import { risk, stageGates, finalReportGates } from "@/lib/domain";
import type { Engagement, Paper } from "@/lib/domain";
import { evaluate } from "@/lib/diagnostics";
import {
  registerModel,
  registerProfile,
  queueEvaluation,
  executionCSV,
} from "@/lib/evaluation-service";
import { clientFinding } from "@/lib/client-projection";
import {
  workflowCommand,
  workflowOps,
  WorkflowError,
  calendarDate,
} from "@/lib/workflow-service";
import { isClientRole, isInternalRole } from "@/lib/workflow-state";
import { protocolConfigKeys } from "@/lib/evaluation";
import { assurancePins, jobs, assuranceGates } from "@/lib/assurance-store";
import { diagnosticNarrative } from "@/lib/presentation";
import {
  evidenceRequestOps,
  evidenceRequestCommand,
  EvidenceRequestError,
} from "@/lib/evidence-requests";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url),
      ctx = await context(url.searchParams.get("tenantId") ?? undefined);
    const memberships = (
      await db()
        .prepare(
          "SELECT m.tenant_id,t.name,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.status='active' ORDER BY t.name",
        )
        .bind(ctx.user.userId)
        .all()
    ).results;
    let clientRows = (
      await db()
        .prepare(
          "SELECT id,name,sector FROM clients WHERE tenant_id=?" +
            (isClientRole(ctx.role) ? " AND id=?" : "") +
            " ORDER BY name",
        )
        .bind(ctx.tenantId, ...(isClientRole(ctx.role) ? [ctx.clientId] : []))
        .all()
    ).results;
    let engagementRows = (
      await db()
        .prepare(
          "SELECT id,client_id,title,version,json_extract(body,'$.stage') AS stage,json_extract(body,'$.dueDate') AS due_date FROM engagements WHERE tenant_id=?" +
            (isClientRole(ctx.role) ? " AND client_id=?" : "") +
            " ORDER BY title",
        )
        .bind(ctx.tenantId, ...(isClientRole(ctx.role) ? [ctx.clientId] : []))
        .all()
    ).results;
    if (ctx.role !== "Client Viewer") {
      const granted = [];
      for (const row of engagementRows) {
        try {
          await getEngagement(ctx, String(row.id));
          granted.push(row);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }
      engagementRows = granted;
    }
    if (isInternalRole(ctx.role) && !ctx.practiceAdmin)
      clientRows = clientRows.filter((c) =>
        engagementRows.some((e) => e.client_id === c.id),
      );
    const selectedId =
      url.searchParams.get("engagementId") ??
      (engagementRows[0]?.id as string | undefined);
    const e = selectedId ? await getEngagement(ctx, selectedId) : null;
    const members = ctx.practiceAdmin
      ? (
          await db()
            .prepare(
              "SELECT user_id,role,client_id,display_name,status FROM memberships WHERE tenant_id=? ORDER BY display_name",
            )
            .bind(ctx.tenantId)
            .all()
        ).results
      : [];
    const people = isInternalRole(ctx.role)
      ? (
          await db()
            .prepare(
              "SELECT m.user_id,m.display_name,m.role,m.status,m.client_id FROM memberships m JOIN engagement_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=? AND m.status='active' AND a.engagement_id=? AND a.active=1",
            )
            .bind(ctx.tenantId, e?.id ?? "")
            .all()
        ).results
      : [];
    const managementVersion = (await db()
      .prepare("SELECT version FROM tenants WHERE id=?")
      .bind(ctx.tenantId)
      .first<{
        version: number;
      }>())!.version;
    const managementEvents = ctx.practiceAdmin
      ? (
          await db()
            .prepare(
              "SELECT id,actor,action,details,hash,created_at FROM management_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 30",
            )
            .bind(ctx.tenantId)
            .all()
        ).results
      : [];
    const events =
      e && isInternalRole(ctx.role)
        ? (
            await db()
              .prepare(
                "SELECT id,actor,action,hash,previous_hash,created_at,details FROM audit_events WHERE tenant_id=? AND engagement_id=? ORDER BY created_at DESC LIMIT 30",
              )
              .bind(ctx.tenantId, e.id)
              .all()
          ).results
        : [];
    return Response.json(
      {
        identity: {
          id: ctx.user.userId,
          name: ctx.user.displayName,
          role: ctx.role,
          practiceAdmin: ctx.practiceAdmin,
        },
        tenantId: ctx.tenantId,
        memberships,
        clients: clientRows,
        engagements: engagementRows,
        engagement: e ? sanitize(e, ctx) : null,
        members,
        people,
        managementVersion,
        managementEvents,
        events,
        catalog: isClientRole(ctx.role) ? null : catalog,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}
const text = z.string().trim().min(1).max(5000),
  short = z.string().trim().min(1).max(300);
const command = z
  .object({
    tenantId: short,
    engagementId: short,
    expectedVersion: z.number().int().positive(),
    op: short,
    data: z.record(z.unknown()).default({}),
  })
  .strict();
function paper(e: Engagement, value: unknown) {
  const p = e.papers.find((p) => p.id === value);
  if (!p) throw new ApiError(404, "Working paper not found");
  return p;
}
function archive(p: Paper, actor: string) {
  p.history.push({
    revision: p.revision,
    body: { ...p.body },
    authorId: p.authorId,
    at: p.updatedAt,
    evidenceIds: [...p.evidenceIds],
    runIds: [...p.runIds],
    reviews: [...p.reviews],
    signatures: [...p.signatures],
    contributors: [...(p.contributors ?? [])],
  });
  p.revision++;
  p.authorId = actor;
  p.updatedAt = now();
  p.status = "draft";
  p.reviews = [];
  p.signatures = [];
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const payload = command.parse(
        JSON.parse(
          new TextDecoder().decode(await readBounded(request, 2 * 1024 * 1024)),
        ),
      ),
      ctx = await context(payload.tenantId),
      e = await getEngagement(ctx, payload.engagementId);
    if (e.version !== payload.expectedVersion)
      throw new ApiError(409, "The engagement changed. Reload before saving.");
    const d = payload.data,
      op = payload.op;
    let details: Record<string, unknown> = {};
    let extras: (commandId: string) => D1PreparedStatement[] = () => [];
    if (["createClient", "createEngagement", "grantMember"].includes(op))
      throw new ApiError(400, "Use client and user management for this action");
    if (
      [
        "createPaper",
        "editPaper",
        "submitPaper",
        "classify",
        "createFinding",
        "updateFinding",
        "createModel",
        "createEvaluationProfile",
        "queueRun",
        "retryRun",
        "executeRun",
        "cancelRun",
        "acceptEvidence",
        "setStage",
        "renameEngagement",
        "createClient",
        "createEngagement",
      ].includes(op)
    )
      requireRole(ctx, ["Auditor", "Lead Auditor"]);
    if (workflowOps.includes(op)) {
      if (op === "releaseReport") {
        const r = e.reports.find((r) => r.id === d.reportId);
        if (!r) throw new ApiError(404, "Report not found");
        if (
          r.snapshot.assurancePins &&
          JSON.stringify(r.snapshot.assurancePins) !==
            JSON.stringify(await assurancePins(ctx, e.id))
        )
          throw new ApiError(
            409,
            "Assurance sources changed after capture; prepare and approve a new report",
          );
        const assuranceBlockers = await assuranceGates(
          ctx,
          e.id,
          String(r.snapshot.opinion),
        );
        if (assuranceBlockers.length)
          throw new ApiError(409, assuranceBlockers[0]);
        if (
          (await jobs(ctx, e.id)).some((j) =>
            ["queued", "running"].includes(String(j.state)),
          )
        )
          throw new ApiError(
            409,
            "Complete or cancel external execution before release",
          );
        const gates = finalReportGates(e, String(r.snapshot.opinion));
        if (gates.length) throw new ApiError(409, gates[0].message);
        const frozen = r.snapshot.workflow as Engagement["workflow"];
        if (
          !frozen ||
          frozen.brief?.revision !== e.workflow?.brief?.revision ||
          frozen.program.revision !== e.workflow?.program.revision
        )
          throw new ApiError(
            409,
            "Prepare a new report for the current approved scope and program",
          );
        const capturedPapers = e.papers
          .filter((p) => p.status === "signed")
          .map((p) => ({
            id: p.id,
            templateId: p.templateId,
            title: p.title,
            revision: p.revision,
            status: p.status,
            body: p.body,
            evidenceIds: p.evidenceIds,
            runIds: p.runIds,
            reviews: p.reviews,
            signatures: p.signatures,
          }));
        if (
          JSON.stringify(frozen.procedures) !==
            JSON.stringify(e.workflow?.procedures) ||
          JSON.stringify(r.snapshot.papers) !==
            JSON.stringify(capturedPapers) ||
          JSON.stringify(r.snapshot.findings) !== JSON.stringify(e.findings) ||
          JSON.stringify(
            (
              r.snapshot.engagement as {
                classification: unknown;
              }
            ).classification,
          ) !== JSON.stringify(e.classification) ||
          JSON.stringify(r.snapshot.evidenceRequests) !==
            JSON.stringify(e.evidenceRequests ?? []) ||
          JSON.stringify(r.snapshot.evidence) !==
            JSON.stringify(e.artifacts.map(({ key, ...a }) => a)) ||
          JSON.stringify(r.snapshot.models) !== JSON.stringify(e.models) ||
          JSON.stringify(r.snapshot.evaluationProfiles) !==
            JSON.stringify(e.evaluationProfiles ?? []) ||
          JSON.stringify(r.snapshot.runs) !== JSON.stringify(e.runs)
        )
          throw new ApiError(
            409,
            "Audit source records changed after report capture. Prepare and approve a new final package",
          );
      }
      try {
        details = await workflowCommand(e, op, d, {
          role: ctx.role,
          userId: ctx.user.userId,
          at: now(),
          id,
          sha256,
          makePaper: (t) => templatePaper(t, ctx.user.userId),
          member: (uid) =>
            db()
              .prepare(
                "SELECT m.role,m.client_id,m.status FROM memberships m WHERE m.tenant_id=? AND m.user_id=? AND (m.role IN ('Client Viewer','Client Contributor') OR EXISTS(SELECT 1 FROM engagement_access a WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id AND a.engagement_id=? AND a.active=1))",
              )
              .bind(ctx.tenantId, uid, e.id)
              .first(),
        });
      } catch (error) {
        if (error instanceof WorkflowError)
          throw new ApiError(error.status, error.message);
        throw error;
      }
    } else if (op === "openFollowup") {
      requireRole(ctx, ["Lead Auditor"]);
      const a = z
          .object({ caseId: short, title: short, dueDate: calendarDate })
          .strict()
          .parse(d),
        c = e.workflow?.monitoring.find((c) => c.id === a.caseId);
      if (
        !c ||
        c.decision !== "reassessment_required" ||
        c.state === "closed" ||
        c.successorEngagementId
      )
        throw new ApiError(
          409,
          "Assess an open case requiring reassessment before creating its follow-up",
        );
      const next = freshEngagement(e.clientId, a.title, ctx.user.userId, true);
      next.dueDate = a.dueDate;
      next.workflow!.successorOf = { engagementId: e.id, caseId: c.id };
      c.successorEngagementId = next.id;
      c.history.push({
        at: now(),
        actor: ctx.user.userId,
        action: "create_followup",
        state: c.state,
        assessment: c.assessment,
        evidenceIds: [...c.evidenceIds],
      });
      const body = JSON.stringify(next),
        hash = await sha256(body);
      extras = (cmd) => [
        db()
          .prepare(
            "INSERT INTO engagements(tenant_id,id,client_id,title,version,body,last_command_id) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
          )
          .bind(
            ctx.tenantId,
            next.id,
            next.clientId,
            next.title,
            next.version,
            body,
            cmd,
            ctx.tenantId,
            e.id,
            cmd,
          ),
        db()
          .prepare(
            "INSERT INTO engagement_snapshots(tenant_id,engagement_id,version,body,sha256,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
          )
          .bind(
            ctx.tenantId,
            next.id,
            next.version,
            body,
            hash,
            now(),
            ctx.tenantId,
            e.id,
            cmd,
          ),
        db()
          .prepare(
            "INSERT INTO engagement_access_policies(tenant_id,engagement_id,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
          )
          .bind(ctx.tenantId, next.id, now(), ctx.tenantId, e.id, cmd),
        db()
          .prepare(
            "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) SELECT ?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM engagements WHERE tenant_id=? AND id=? AND last_command_id=?)",
          )
          .bind(
            ctx.tenantId,
            next.id,
            ctx.user.userId,
            ctx.user.userId,
            now(),
            ctx.tenantId,
            e.id,
            cmd,
          ),
      ];
      details = { engagementId: next.id };
    } else if (op === "createPaper") {
      const a = z.object({ templateId: short }).parse(d);
      const p = templatePaper(a.templateId, ctx.user.userId);
      e.papers.push(p);
      details = { paperId: p.id };
    } else if (evidenceRequestOps.includes(op)) {
      try {
        details = evidenceRequestCommand(e, op, d, {
          role: ctx.role,
          userId: ctx.user.userId,
          at: now(),
          id: () => id("REQ"),
          makeLimitationPaper: () =>
            templatePaper("MEM-EX-01", ctx.user.userId),
        });
      } catch (error) {
        if (error instanceof EvidenceRequestError)
          throw new ApiError(error.status, error.message);
        throw error;
      }
    } else if (op === "editPaper") {
      const a = z
          .object({
            paperId: short,
            body: z.object({
              objective: z.string().max(20000),
              scope: z.string().max(20000),
              criteria: z.string().max(20000),
              procedures: z.string().max(20000),
              sampling: z.string().max(20000),
              results: z.string().max(30000),
              limitations: z.string().max(20000),
              conclusion: z.string().max(20000),
              conclusionStatus: z.enum([
                "not_evaluated",
                "supported",
                "qualified",
                "not_supported",
                "not_applicable",
              ]),
            }),
            evidenceIds: z.array(short).max(100),
            required: z.boolean(),
          })
          .parse(d),
        p = paper(e, a.paperId);
      if (
        e.workflow?.procedures.some(
          (q) => q.paperId === p.id && q.paperRevision !== undefined,
        )
      )
        throw new ApiError(
          409,
          "Update the source procedure execution and evaluation, then compile a new working-paper revision",
        );
      if (p.status === "signed")
        throw new ApiError(409, "Reopen the signed paper before changing it");
      if (
        a.evidenceIds.some(
          (v) =>
            !e.artifacts.some((t) => t.id === v && t.status === "accepted"),
        )
      )
        throw new ApiError(400, "Link accepted evidence from this engagement");
      // An existing supplementary paper is not an applicability exclusion. Removing a required paper or recording not-applicable remains Lead-controlled.
      const supplementary =
        !p.required &&
        p.body.conclusionStatus !== "not_applicable" &&
        a.body.conclusionStatus !== "not_applicable";
      if (!a.required && !supplementary && ctx.role !== "Lead Auditor")
        throw new ApiError(
          403,
          "Only a Lead Auditor can approve applicability exclusions",
        );
      if (
        !a.required &&
        !supplementary &&
        (a.body.conclusionStatus !== "not_applicable" ||
          !a.body.conclusion.trim() ||
          !a.body.criteria.trim())
      )
        throw new ApiError(
          400,
          "An applicability exclusion needs criteria and a reasoned not-applicable conclusion",
        );
      archive(p, ctx.user.userId);
      p.contributors = [
        ...new Set([...(p.contributors ?? []), ctx.user.userId]),
      ];
      p.body = a.body;
      p.evidenceIds = a.evidenceIds;
      p.required = a.required;
      details = { paperId: p.id, revision: p.revision };
    } else if (op === "reopenPaper") {
      requireRole(ctx, ["Lead Auditor"]);
      const p = paper(e, d.paperId),
        authorId = p.authorId;
      if (
        e.workflow?.procedures.some(
          (q) => q.paperId === p.id && q.paperRevision !== undefined,
        )
      )
        throw new ApiError(
          409,
          "Record new work in the source procedure to preserve this signed revision",
        );
      archive(p, ctx.user.userId);
      p.authorId = authorId;
      details = { paperId: p.id, revision: p.revision };
    } else if (op === "submitPaper") {
      const p = paper(e, d.paperId);
      if (
        e.workflow?.procedures.some(
          (q) => q.paperId === p.id && q.paperRevision !== undefined,
        )
      )
        throw new ApiError(
          409,
          "Submit the compiled working paper through its source procedure",
        );
      if (p.status !== "draft")
        throw new ApiError(409, "Only a draft can be submitted");
      if (
        !p.body.conclusion.trim() ||
        p.body.conclusionStatus === "not_evaluated" ||
        !p.body.results.trim() ||
        !p.evidenceIds.length
      )
        throw new ApiError(
          400,
          "Record results, a reasoned conclusion and accepted evidence before submission",
        );
      if (p.comments.some((c) => !c.resolved))
        throw new ApiError(400, "Resolve reviewer comments first");
      p.status = "in_review";
      details = { paperId: p.id, revision: p.revision };
    } else if (op === "reviewPaper") {
      requireRole(ctx, ["Reviewer", "Lead Auditor"]);
      const p = paper(e, d.paperId);
      if (e.workflow?.procedures.some((q) => q.paperId === p.id))
        throw new ApiError(
          409,
          "Review the bound procedure from the audit program",
        );
      if (
        p.authorId === ctx.user.userId ||
        (p.contributors ?? []).includes(ctx.user.userId)
      )
        throw new ApiError(403, "The author cannot review their own paper");
      if (p.status !== "in_review")
        throw new ApiError(409, "Submit the paper for review first");
      if (p.comments.some((c) => !c.resolved))
        throw new ApiError(400, "Unresolved reviewer comments block review");
      p.reviews.push({
        userId: ctx.user.userId,
        revision: p.revision,
        at: now(),
      });
      p.status = "reviewed";
      details = { paperId: p.id, revision: p.revision };
    } else if (op === "signPaper") {
      requireRole(ctx, ["Lead Auditor"]);
      const p = paper(e, d.paperId);
      if (
        p.status !== "reviewed" ||
        !p.reviews.some(
          (r) =>
            r.revision === p.revision &&
            r.userId !== p.authorId &&
            r.userId !== ctx.user.userId,
        )
      )
        throw new ApiError(
          400,
          "Independent review of the current revision is required",
        );
      if (p.comments.some((c) => !c.resolved))
        throw new ApiError(400, "Unresolved comments block sign-off");
      const hash = await sha256(
        JSON.stringify({
          body: p.body,
          revision: p.revision,
          evidenceIds: p.evidenceIds,
          runIds: p.runIds,
        }),
      );
      p.signatures.push({
        userId: ctx.user.userId,
        revision: p.revision,
        at: now(),
        hash,
      });
      p.status = "signed";
      details = { paperId: p.id, revision: p.revision, hash };
    } else if (op === "comment") {
      requireRole(ctx, ["Reviewer", "Lead Auditor", "Auditor"]);
      const a = z.object({ paperId: short, text }).parse(d),
        p = paper(e, a.paperId);
      if (p.status === "signed")
        throw new ApiError(
          409,
          "Reopen the signed paper to add a review comment",
        );
      p.comments.push({
        id: id("COMMENT"),
        authorId: ctx.user.userId,
        text: a.text,
        resolved: false,
        createdAt: now(),
      });
      p.status = "draft";
      p.reviews = [];
      p.signatures = [];
      const bound = e.workflow?.procedures.find((q) => q.paperId === p.id);
      if (bound) {
        bound.state = bound.execution?.assessment ? "evaluated" : "executed";
        bound.review = undefined;
      }
      details = { paperId: p.id };
    } else if (op === "respondComment") {
      requireRole(ctx, ["Auditor", "Lead Auditor"]);
      const a = z
          .object({ paperId: short, commentId: short, text })
          .strict()
          .parse(d),
        p = paper(e, a.paperId),
        c = p.comments.find((c) => c.id === a.commentId);
      if (!c || c.resolved || p.status === "signed")
        throw new ApiError(409, "Respond to an open review question");
      c.responses ??= [];
      if (c.responses.length >= 30)
        throw new ApiError(413, "Comment response limit reached");
      c.responses.push({ actor: ctx.user.userId, at: now(), text: a.text });
      details = { paperId: p.id, commentId: c.id };
    } else if (op === "resolveComment") {
      requireRole(ctx, ["Reviewer", "Lead Auditor", "Auditor"]);
      const p = paper(e, d.paperId),
        c = p.comments.find((c) => c.id === d.commentId);
      if (!c) throw new ApiError(404, "Comment not found");
      if (c.authorId !== ctx.user.userId)
        throw new ApiError(403, "The comment author must confirm resolution");
      if (!c.responses?.length)
        throw new ApiError(
          400,
          "Record a preparer response before confirming resolution",
        );
      c.resolved = true;
      c.resolvedAt = now();
      details = { paperId: p.id, commentId: c.id };
    } else if (op === "classify") {
      const a = z
        .object({
          prohibited: z.boolean(),
          highRisk: z.boolean(),
          transparency: z.boolean(),
          profiling: z.boolean(),
          annexRoute: short,
          operatorRole: z.enum([
            "Provider",
            "Deployer",
            "Provider and deployer",
            "Importer / distributor",
          ]),
          intendedPurpose: text,
          rationale: text,
        })
        .parse(d);
      e.classification = {
        ...e.classification,
        ...a,
        highRisk: a.highRisk || a.profiling,
        status: "provisional",
        approvedBy: undefined,
      };
      details = { classification: "provisional" };
    } else if (op === "approveClassification") {
      requireRole(ctx, ["Reviewer", "Lead Auditor"]);
      const classifiedEvent = await db()
        .prepare(
          "SELECT actor FROM audit_events WHERE tenant_id=? AND engagement_id=? AND action=? ORDER BY created_at DESC LIMIT 1",
        )
        .bind(ctx.tenantId, e.id, "classify")
        .first<{
          actor: string;
        }>();
      if (!classifiedEvent || classifiedEvent.actor === ctx.user.userId)
        throw new ApiError(
          403,
          "An independent reviewer must approve a completed classification",
        );
      if (!e.classification.rationale || !e.classification.intendedPurpose)
        throw new ApiError(400, "Record classification facts and rationale");
      e.classification.status = "approved";
      e.classification.approvedBy = ctx.user.userId;
      details = { classification: "approved" };
    } else if (op === "createFinding") {
      const a = z
          .object({
            title: short,
            article: short,
            condition: text,
            criteria: text,
            cause: z.string().max(5000),
            effect: text,
            likelihood: z.number().int().min(1).max(5),
            impact: z.number().int().min(1).max(5),
            owner: short,
            dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            visibility: z.enum(["internal", "client"]),
            procedureId: short.optional(),
          })
          .parse(d),
        f = {
          ...a,
          ...risk(a.likelihood, a.impact),
          id: id("F"),
          status: "open" as const,
          response: "",
          remediation: "",
          retestEvidenceIds: [],
          createdBy: ctx.user.userId,
        };
      if (a.procedureId) {
        const p = e.workflow?.procedures.find((p) => p.id === a.procedureId);
        if (
          !p?.execution ||
          p.execution.evidenceIds.some(
            (id) =>
              !e.artifacts.some((a) => a.id === id && a.status === "accepted"),
          )
        )
          throw new ApiError(
            400,
            "Finding origin requires a procedure with accepted execution evidence",
          );
        Object.assign(f, {
          support: {
            findingId: f.id,
            procedureId: p.id,
            paperIds: p.paperId ? [p.paperId] : [],
            evidenceIds: [...p.execution.evidenceIds],
            runIds: [...p.execution.runIds],
            actor: ctx.user.userId,
            at: now(),
          },
        });
      }
      e.findings.push(f);
      details = { findingId: f.id, riskScore: f.riskScore };
    } else if (op === "updateFinding") {
      const a = z
          .object({
            findingId: short,
            status: z.enum(["open", "in_progress", "ready_for_retest"]),
            response: z.string().max(15000),
            remediation: z.string().max(15000),
            retestEvidenceIds: z.array(short).max(100),
          })
          .parse(d),
        f = e.findings.find((f) => f.id === a.findingId);
      if (!f) throw new ApiError(404, "Finding not found");
      if (f.status === "closed")
        throw new ApiError(
          409,
          "A closed finding needs a new re-opening decision",
        );
      if (
        a.retestEvidenceIds.some(
          (v) =>
            !e.artifacts.some((t) => t.id === v && t.status === "accepted"),
        )
      )
        throw new ApiError(400, "Retest evidence must be accepted");
      Object.assign(f, a, {
        remediationBy: ctx.user.userId,
        remediationAt: now(),
        retest: undefined,
      });
      details = { findingId: f.id, status: f.status };
    } else if (op === "closeFinding") {
      requireRole(ctx, ["Reviewer", "Lead Auditor"]);
      const f = e.findings.find((f) => f.id === d.findingId);
      if (!f) throw new ApiError(404, "Finding not found");
      if (
        f.createdBy === ctx.user.userId ||
        f.remediationBy === ctx.user.userId
      )
        throw new ApiError(403, "Independent retest confirmation is required");
      if (
        f.status !== "ready_for_retest" ||
        !f.remediation.trim() ||
        !f.retestEvidenceIds.length
      )
        throw new ApiError(
          400,
          "Remediation and accepted retest evidence are required",
        );
      if (
        !f.retest ||
        f.retest.conclusion !== "effective" ||
        f.retest.evidenceIds.some(
          (id) =>
            !e.artifacts.some((a) => a.id === id && a.status === "accepted"),
        )
      )
        throw new ApiError(
          400,
          "Record an independent effective retest before closure",
        );
      f.status = "closed";
      f.closedBy = ctx.user.userId;
      details = { findingId: f.id };
    } else if (op === "createModel") {
      const m = registerModel(e, d, ctx.user.userId);
      details = { modelId: m.id, status: m.status };
    } else if (op === "createEvaluationProfile") {
      const p = registerProfile(e, d, ctx.user.userId);
      details = { profileId: p.id };
    } else if (op === "queueRun") {
      const { procedureId, datasetCardRecordId, ...args } = d;
      const p = procedureId
        ? e.workflow?.procedures.find((p) => p.id === procedureId)
        : undefined;
      if (
        procedureId &&
        (!p ||
          e.workflow?.brief?.status !== "approved" ||
          e.workflow.program.status !== "approved" ||
          !p.selected ||
          !["applicable", "readiness"].includes(p.applicability) ||
          p.modelId !== args.modelId ||
          p.datasetId !== args.datasetId ||
          p.profileId !== args.profileId)
      )
        throw new ApiError(
          409,
          "Use the approved procedure model, dataset and protocol",
        );
      const card = datasetCardRecordId
        ? (await records(ctx, e.id)).find(
            (r) => r.id === datasetCardRecordId && r.kind === "dataset",
          )
        : undefined;
      if (
        datasetCardRecordId &&
        (!card ||
          card.body.artifactId !== args.datasetId ||
          card.body.artifactSha256 !==
            e.artifacts.find(
              (a) => a.id === args.datasetId && a.status === "accepted",
            )?.sha256)
      )
        throw new ApiError(
          409,
          "The dataset card must match the accepted evaluation bytes",
        );
      const run = await queueEvaluation(e, args, ctx.user.userId);
      if (card && run.manifest) {
        run.manifest.dataset.cardPin = {
          recordId: card.id,
          sha256: card.sha256,
          card: card.body,
        };
        run.provenance.inputHashes.manifest = await sha256(
          JSON.stringify(run.manifest),
        );
      }
      if (p)
        run.procedureBinding = {
          procedureId: p.id,
          procedureRevision: p.revision,
          briefRevision: e.workflow!.brief!.revision,
          programRevision: e.workflow!.program.revision,
        };
      if (run.procedureBinding)
        run.provenance.inputHashes.auditBinding = await sha256(
          JSON.stringify(run.procedureBinding),
        );
      details = { runId: run.id };
    } else if (op === "retryRun") {
      const a = z.object({ runId: short }).strict().parse(d),
        source = e.runs.find((r) => r.id === a.runId);
      if (
        !source ||
        !["failed", "cancelled"].includes(source.state) ||
        !source.manifest
      )
        throw new ApiError(
          409,
          "Retry a failed or cancelled frozen evaluation",
        );
      await executionCSV(e, source);
      const p = source.procedureBinding
        ? e.workflow?.procedures.find(
            (p) => p.id === source.procedureBinding?.procedureId,
          )
        : undefined;
      if (
        source.procedureBinding &&
        (!p ||
          e.workflow?.program.status !== "approved" ||
          p.revision !== source.procedureBinding.procedureRevision ||
          e.workflow.program.revision !==
            source.procedureBinding.programRevision ||
          e.workflow.brief?.revision !== source.procedureBinding.briefRevision)
      )
        throw new ApiError(
          409,
          "The audit scope or procedure changed. Queue a new planned evaluation",
        );
      const args = source.profileId
          ? {
              modelId: source.modelId,
              datasetId: source.datasetId,
              profileId: source.profileId,
            }
          : {
              modelId: source.modelId,
              datasetId: source.datasetId,
              suite: source.suite,
              config: source.config,
            },
        run = await queueEvaluation(e, args, ctx.user.userId);
      run.retryOf = source.id;
      if (source.procedureBinding) {
        run.procedureBinding = { ...source.procedureBinding };
        run.provenance.inputHashes.auditBinding = await sha256(
          JSON.stringify(run.procedureBinding),
        );
      }
      details = { runId: run.id, retryOf: source.id };
    } else if (op === "executeRun") {
      const run = e.runs.find((r) => r.id === d.runId);
      if (!run) throw new ApiError(404, "Run not found");
      if (run.state !== "queued")
        throw new ApiError(
          409,
          "This run has already been claimed, completed or cancelled",
        );
      run.state = "running";
      run.startedAt = now();
      await save(ctx, e, payload.expectedVersion, "claimRun", {
        runId: run.id,
      });
      try {
        const { a, csv } = await executionCSV(e, run);
        run.results = evaluate(run, csv);
        run.outcome = run.results.some((r) => r.outcome === "fail")
          ? "fail"
          : run.results.some((r) => r.outcome === "inconclusive")
            ? "inconclusive"
            : "pass";
        run.overallOutcome = run.outcome;
        run.state = "succeeded";
        run.completedAt = now();
        for (const article of [...new Set(run.results.map((r) => r.article))]) {
          const p = templatePaper(
            article === "10" ? "WP-A10-02" : "WP-A15-01",
            ctx.user.userId,
          );
          p.title = "Diagnostic run · " + run.id + " · Article " + article;
          p.required = false;
          p.body.results = diagnosticNarrative(
            run.results.filter((r) => r.article === article),
          );
          p.body.procedures =
            "Verified the registered CSV bytes against their SHA-256 pin and validated the task-specific column mappings. Executed: " +
            run.results
              .filter((r) => r.article === article)
              .map((r) => r.label)
              .join("; ") +
            ". Runner: " +
            run.provenance.runnerVersion +
            ". Saved-prediction diagnostics only; no independent model inference or cross-validation was performed.";
          p.body.scope =
            "Model: " +
            (run.manifest?.model.name ?? run.modelId) +
            " · version " +
            (run.manifest?.model.version ?? "legacy") +
            "; dataset: " +
            (run.manifest?.dataset.name ?? run.datasetId);
          p.body.sampling = run.manifest?.profile
            ? run.manifest.profile.datasetContext.split +
              " dataset. " +
              run.manifest.profile.datasetContext.independence
            : "Sampling independence not established.";
          p.body.criteria = run.manifest?.profile
            ? run.manifest.profile.name +
              " v" +
              run.manifest.profile.version +
              ": " +
              run.manifest.profile.rationale
            : p.body.criteria;
          p.body.criteria +=
            "\nInternal protocol parameters: " +
            Object.entries(run.config)
              .filter(([key]) =>
                protocolConfigKeys(
                  run.task ?? "Binary classification",
                  run.suite,
                ).includes(key),
              )
              .map(
                ([key, value]) =>
                  key.replace(/([A-Z])/g, " $1") + " = " + value,
              )
              .join("; ");
          p.body.limitations =
            "Automated diagnostic draft. Evaluate suitability, data rights, sampling and uncertainty before reaching a human audit conclusion. " +
            (run.manifest?.limitations ?? []).join(" ");
          p.evidenceIds = [a.id];
          p.runIds = [run.id];
          e.papers.push(p);
          run.paperIds.push(p.id);
        }
      } catch (error) {
        run.state = "failed";
        run.outcome = "inconclusive";
        run.overallOutcome = "inconclusive";
        run.error =
          error instanceof Error
            ? error.message
            : "Diagnostic execution failed";
        run.completedAt = now();
      }
      const generated = e.papers.filter((p) => run.paperIds.includes(p.id));
      let completion: Engagement | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const latest = await getEngagement(ctx, e.id),
          target = latest.runs.find((r) => r.id === run.id);
        if (!target || target.state !== "running")
          throw new ApiError(409, "The run is no longer active");
        Object.assign(target, run);
        for (const p of generated)
          if (!latest.papers.some((x) => x.id === p.id)) latest.papers.push(p);
        try {
          completion = await save(ctx, latest, latest.version, "completeRun", {
            runId: run.id,
            state: run.state,
            outcome: run.outcome,
          });
          break;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
        }
      }
      if (!completion)
        throw new ApiError(
          409,
          "Completion conflicted with ongoing edits. Recover the interrupted run once it is older than two minutes.",
        );
      return Response.json({ engagement: sanitize(completion, ctx) });
    } else if (op === "recoverRun") {
      requireRole(ctx, ["Lead Auditor"]);
      const r = e.runs.find((r) => r.id === d.runId);
      if (!r) throw new ApiError(404, "Run not found");
      if (
        r.state !== "running" ||
        Date.now() - new Date(r.startedAt ?? r.createdAt).getTime() < 120000
      )
        throw new ApiError(
          409,
          "Only an interrupted run older than two minutes can be recovered",
        );
      r.state = "failed";
      r.outcome = "inconclusive";
      r.overallOutcome = "inconclusive";
      r.error =
        "Execution was interrupted. Re-run using a new immutable request.";
      r.completedAt = now();
      details = { runId: r.id };
    } else if (op === "cancelRun") {
      const r = e.runs.find((r) => r.id === d.runId);
      if (!r) throw new ApiError(404, "Run not found");
      if (r.state !== "queued")
        throw new ApiError(
          409,
          "Only queued interactive runs can be cancelled",
        );
      r.state = "cancelled";
      r.outcome = "inconclusive";
      r.overallOutcome = "inconclusive";
      r.completedAt = now();
      details = { runId: r.id };
    } else if (op === "acceptEvidence") {
      const a = e.artifacts.find((a) => a.id === d.artifactId);
      if (!a) throw new ApiError(404, "Evidence not found");
      if (a.category === "Model")
        throw new ApiError(
          400,
          "Model binaries stay quarantined until a trusted adapter and security review are available",
        );
      a.status = "accepted";
      details = { artifactId: a.id, sha256: a.sha256 };
    } else if (op === "setStage") {
      requireRole(ctx, ["Lead Auditor"]);
      const stage = z
        .enum([
          "Planning",
          "Fieldwork",
          "Evidence evaluation",
          "Reporting",
          "Sign-off",
        ])
        .parse(d.stage);
      const gates = stageGates(e, stage);
      if (gates.length)
        throw new ApiError(
          400,
          [...new Set(gates.map((g) => g.message))].slice(0, 5).join("; "),
        );
      e.stage = stage;
      details = { stage };
    } else if (op === "renameEngagement") {
      const a = z
        .object({
          title: short,
          dueDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/),
        })
        .parse(d);
      e.title = a.title;
      e.dueDate = a.dueDate;
      details = a;
    } else if (op === "createReport") {
      requireRole(ctx, ["Lead Auditor"]);
      const a = z
        .object({
          kind: z.enum(["draft", "final"]),
          opinion: z.enum([
            "Readiness assessment",
            "Qualified conclusion",
            "Adverse conclusion",
            "Unable to conclude",
          ]),
          summary: text,
        })
        .parse(d);
      if (a.kind === "final") {
        if (
          (await jobs(ctx, e.id)).some((j) =>
            ["queued", "running"].includes(String(j.state)),
          )
        )
          throw new ApiError(
            409,
            "Complete or cancel external execution before final capture",
          );
        const assuranceBlockers = await assuranceGates(ctx, e.id, a.opinion);
        if (assuranceBlockers.length)
          throw new ApiError(409, assuranceBlockers[0]);
        const gates = finalReportGates(e, a.opinion);
        if (gates[0]?.kind === "stage")
          throw new ApiError(400, gates[0].message);
        if (gates.length)
          throw new ApiError(
            400,
            gates
              .slice(0, 8)
              .map((g) => g.message)
              .join("; "),
          );
      }
      const annexIV = annexMap.sections.map((section) => {
        const matching = e.papers.filter((p) =>
            section.paperIds.includes(p.templateId),
          ),
          candidates = e.artifacts.filter(
            (a) =>
              a.status === "accepted" &&
              section.evidenceCategories.includes(a.category),
          );
        return {
          number: section.number,
          title: section.title,
          reference: section.reference,
          state: candidates.length
            ? "candidate_evidence_present"
            : "unassessed",
          paperIds: matching.map((p) => p.id),
          candidateEvidenceIds: candidates.map((a) => a.id),
          gaps: [
            ...(!candidates.length ? ["No accepted candidate evidence"] : []),
            ...matching
              .filter((p) => p.status !== "signed")
              .map(
                (p) => p.templateId + ": independent signed assessment missing",
              ),
            "Human assessment of legal subitems, scope, currency and version remains required",
          ],
          checklist: section.evidenceChecklist,
        };
      });
      const snapshot = {
        workflow: e.workflow ? structuredClone(e.workflow) : null,
        contractVersion: "1.1",
        engagement: {
          id: e.id,
          title: e.title,
          stage: e.stage,
          classification: e.classification,
        },
        opinion: a.opinion,
        summary: a.summary,
        evidenceRequests: e.evidenceRequests ?? [],
        papers: e.papers
          .filter((p) => a.kind === "draft" || p.status === "signed")
          .map((p) => ({
            id: p.id,
            templateId: p.templateId,
            title: p.title,
            revision: p.revision,
            status: p.status,
            body: p.body,
            evidenceIds: p.evidenceIds,
            runIds: p.runIds,
            reviews: p.reviews,
            signatures: p.signatures,
          })),
        evidence: e.artifacts.map(({ key, ...a }) => a),
        findings: e.findings,
        models: e.models,
        evaluationProfiles: e.evaluationProfiles ?? [],
        runs: e.runs,
        annexIV,
        annexMapVersion: annexMap.mapVersion,
        auditEventHead: e.eventHead,
        createdAt: now(),
        regulatorySource: "https://eur-lex.europa.eu/eli/reg/2024/1689",
        limitations:
          "Diagnostic and assurance conclusions do not constitute a notified-body conformity assessment or legal certification.",
      };
      Object.assign(snapshot, {
        assurancePins: await assurancePins(ctx, e.id),
      });
      const hash = await sha256(JSON.stringify(snapshot)),
        r = {
          id: id("REPORT"),
          kind: a.kind,
          createdAt: now(),
          actor: ctx.user.userId,
          sha256: hash,
          snapshot,
          release: { state: "internal" as const, history: [] },
        };
      const clientSnapshot = {
        scope: e.workflow?.brief
          ? {
              systemName: e.workflow.brief.systemName,
              intendedUse: e.workflow.brief.intendedUse,
              boundary: e.workflow.brief.boundary,
              periodStart: e.workflow.brief.periodStart,
              periodEnd: e.workflow.brief.periodEnd,
              deliverables: e.workflow.brief.deliverables,
            }
          : null,
        engagement: {
          id: e.id,
          title: e.title,
          classification: e.classification,
        },
        opinion: a.opinion,
        summary: a.summary,
        createdAt: r.createdAt,
        papers: e.papers
          .filter((p) => p.status === "signed")
          .map((p) => ({
            id: p.id,
            title: p.title,
            revision: p.revision,
            status: p.status,
            conclusion: p.body.conclusion,
            conclusionStatus: p.body.conclusionStatus,
          })),
        evidence: e.artifacts
          .filter((a) => a.visibility === "client" && a.status === "accepted")
          .map(({ key, ...a }) => a),
        findings: e.findings
          .filter((f) => f.visibility === "client")
          .map(clientFinding),
        limitations:
          snapshot.limitations +
          ((e.evidenceRequests ?? []).some(
            (q) => q.disposition === "unobtainable",
          )
            ? " Evidence availability limitations were recorded; refer to the scoped opinion and executive summary."
            : ""),
        regulatorySource: snapshot.regulatorySource,
      };
      Object.assign(r, {
        clientSnapshot,
        clientSha256: await sha256(JSON.stringify(clientSnapshot)),
      });
      e.reports.push(r);
      details = { reportId: r.id, kind: r.kind, sha256: hash };
    } else throw new ApiError(400, "Unknown command");
    await save(ctx, e, payload.expectedVersion, op, details, extras);
    return Response.json({ engagement: sanitize(e, ctx), details });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error: error.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .join("; "),
        },
        { status: 400 },
      );
    return responseError(error);
  }
}
