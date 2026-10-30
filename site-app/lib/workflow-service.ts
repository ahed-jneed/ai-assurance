import { z } from 'zod';
import type { Engagement, Paper, Role } from './domain';
import type { Brief, Procedure, ProcedurePlan, Workflow, MonitoringCase } from './workflow-types';
import { seedWorkflow } from './workflow-seed';
import { currentExecution, releaseState, workflowRequirements } from './workflow-state';
export class WorkflowError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new WorkflowError(status, message); }
const short = z.string().trim().min(1).max(300), text = z.string().trim().min(1).max(8000), optional = z.string().trim().max(8000), uid = z.string().max(300);
export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }, 'Choose a real calendar date');
const briefFields = z.object({ systemName: short, intendedUse: text, boundary: text, periodStart: calendarDate, periodEnd: calendarDate, actorResponsibilities: text, audience: text, deliverables: text, basis: text, constraints: text, independence: text, changeImpact: optional }).strict();
const planFields = z.object({ selected: z.boolean(), applicability: z.enum(['pending', 'applicable', 'readiness', 'not_applicable']), rationale: optional, criterion: optional, sourceVersion: short, periodAnalysis: optional, population: optional, sampling: optional, ownerId: uid, reviewerId: uid, dueDate: z.union([calendarDate, z.literal('')]), method: z.enum(['manual', 'automated', 'mixed']), modelId: uid, datasetId: uid, profileId: uid }).strict();
export const workflowOps = ['adoptWorkflow', 'saveBrief', 'submitBrief', 'approveBrief', 'returnBrief', 'saveProcedurePlan', 'bulkPlanProcedures', 'publishClientClarification', 'acknowledgeClientSubmission', 'scopeProgramCandidates', 'submitProgram', 'approveProgram', 'returnProgram', 'ensureProcedurePaper', 'recordProcedureExecution', 'evaluateProcedure', 'reaffirmExecution', 'submitProcedure', 'reviewProcedure', 'returnProcedure', 'grantClientRequest', 'updateClientRequest', 'revokeClientRequest', 'approveReportPackage', 'releaseReport', 'withdrawReport', 'createMonitoringCase', 'assessMonitoringCase', 'closeMonitoringCase', 'linkFindingSupport', 'recordFindingRetest', 'reopenFinding'];
type Context = {
    role: Role;
    userId: string;
    at: string;
    id: (prefix: string) => string;
    sha256: (value: string) => Promise<string>;
    makePaper: (templateId: string) => Paper;
    member: (userId: string) => Promise<{
        role: Role;
        client_id: string | null;
        status: string;
    } | null>;
};
function snapshot<T extends {
    history: unknown[];
}>(record: T) { const { history, ...value } = record; return structuredClone(value); }
function plan(p: Procedure): ProcedurePlan { const { selected, applicability, rationale, criterion, sourceVersion, periodAnalysis, population, sampling, ownerId, reviewerId, dueDate, method, modelId, datasetId, profileId } = p; return { selected, applicability, rationale, criterion, sourceVersion, periodAnalysis, population, sampling, ownerId, reviewerId, dueDate, method, modelId, datasetId, profileId }; }
export async function workflowCommand(e: Engagement, op: string, data: unknown, c: Context): Promise<Record<string, string>> {
    const writer = () => { if (!['Auditor', 'Lead Auditor'].includes(c.role))
        fail(403, 'An Auditor or Lead Auditor must record this audit work'); };
    const lead = () => { if (c.role !== 'Lead Auditor')
        fail(403, 'A Lead Auditor must authorize this decision'); };
    const reviewer = () => { if (!['Reviewer', 'Lead Auditor'].includes(c.role))
        fail(403, 'An independent Reviewer or Lead Auditor must approve'); };
    const independent = (contributors: string[]) => { reviewer(); if (contributors.includes(c.userId))
        fail(403, 'A preparer or contributor cannot approve their own work'); };
    const authorized = async (userId: string, roles: Role[]) => { const m = await c.member(userId); if (!m || m.status !== 'active' || !roles.includes(m.role))
        fail(400, 'Select an active authorized person with the required role'); return m; };
    const w = () => e.workflow ?? fail(409, 'Adopt the engagement workflow first');
    const procedure = (id: string) => w().procedures.find(p => p.id === id) ?? fail(404, 'Procedure not found in this engagement');
    const accepted = (ids: string[]) => { if (!ids.length || ids.some(id => !e.artifacts.some(a => a.id === id && a.status === 'accepted')))
        fail(400, 'Link accepted evidence from this engagement'); };
    const ready = () => { const x = w(); if (x.brief?.status !== 'approved' || x.program.status !== 'approved' || x.program.briefRevision !== x.brief.revision)
        fail(409, 'Approve the current scope and audit program before execution'); return x; };
    const recordHistory = (p: Procedure) => { if (p.history.length >= 30)
        fail(413, 'This procedure reached its revision limit; start a follow-up engagement'); p.history.push({ plan: plan(p), revision: p.revision, execution: structuredClone(p.execution), review: p.review, paperId: p.paperId, paperRevision: p.paperRevision, at: c.at, actor: c.userId }); };
    const programDraft = () => { const x = w(), p = x.program; if (p.history.length >= 150)
        fail(413, 'Program revision limit reached'); p.history.push({ revision: p.revision, briefRevision: p.briefRevision, status: p.status, approval: p.approval, procedureRevisions: x.procedures.map(q => ({ id: q.id, revision: q.revision })), at: c.at, actor: c.userId }); p.revision++; p.status = 'draft'; p.approval = undefined; p.contributors = [...new Set([...p.contributors, c.userId])]; p.updatedBy = c.userId; p.updatedAt = c.at; };
    if (op === 'adoptWorkflow') {
        lead();
        if (e.workflow)
            fail(409, 'This engagement already uses the workflow');
        e.workflow = seedWorkflow(c.userId, c.at);
        for (const p of e.workflow.procedures)
            p.paperId = e.papers.find(q => q.templateId === p.templateId)?.id;
        return { workflow: 'adopted' };
    }
    if (op === 'returnBrief' || op === 'returnProgram') {
        reviewer();
        const a = z.object({ reason: text }).strict().parse(data), x = w();
        if (op === 'returnBrief') {
            const b = x.brief ?? fail(400, 'Complete the brief first');
            if (b.status !== 'submitted')
                fail(409, 'Return a submitted scope');
            b.history.push(snapshot(b));
            b.status = 'draft';
            b.approval = undefined;
            b.changeImpact = a.reason;
        }
        else {
            if (x.program.status !== 'submitted')
                fail(409, 'Return a submitted program');
            const contributors = [...x.program.contributors];
            programDraft();
            x.program.contributors = contributors;
        }
        return { reason: a.reason };
    }
    if (op === 'saveBrief') {
        writer();
        const a = briefFields.parse(data), x = w(), old = x.brief;
        if (a.periodStart > a.periodEnd)
            fail(400, 'The audit period ends before it starts');
        if (old?.status === 'approved') {
            lead();
            if (!a.changeImpact.trim())
                fail(400, 'Explain the scope change and its impact');
        }
        if (old?.status === 'submitted')
            fail(409, 'Return the submitted scope before revising it');
        if (old && old.history.length >= 40)
            fail(413, 'Scope revision limit reached');
        const history = old ? [...old.history, snapshot(old)] : [];
        x.brief = { ...a, revision: (old?.revision ?? 0) + 1, status: 'draft', contributors: [...new Set([...(old?.contributors ?? []), c.userId])], updatedBy: c.userId, updatedAt: c.at, history };
        if (x.program.status !== 'draft')
            programDraft();
        return { briefRevision: String(x.brief.revision) };
    }
    if (op === 'submitBrief') {
        writer();
        const b = w().brief ?? fail(400, 'Complete the engagement brief first');
        if (b.status !== 'draft')
            fail(409, 'Only a scope draft can be submitted');
        b.status = 'submitted';
        return { briefRevision: String(b.revision) };
    }
    if (op === 'approveBrief') {
        const b = w().brief ?? fail(400, 'Complete the brief first');
        independent(b.contributors);
        const a = z.object({ revision: z.number().int(), reason: text }).strict().parse(data);
        if (b.status !== 'submitted' || b.revision !== a.revision)
            fail(409, 'Review the submitted scope revision');
        b.approval = { userId: c.userId, at: c.at, revision: b.revision, hash: await c.sha256(JSON.stringify({ ...b, history: undefined, approval: undefined })), reason: a.reason };
        b.status = 'approved';
        return { briefRevision: String(b.revision) };
    }
    if (op === 'bulkPlanProcedures') {
        writer(); const x=w(); if(x.program.status!=='draft')lead();
        const a=z.object({procedureIds:z.array(short).min(1).max(40).refine(v=>new Set(v).size===v.length,'Choose each procedure once'),patch:z.object({ownerId:uid.optional(),reviewerId:uid.optional(),dueDate:z.union([calendarDate,z.literal('')]).optional()}).strict().refine(v=>Object.keys(v).length>0,'Choose a planning change')}).strict().parse(data);
        const targets=a.procedureIds.map(procedure);
        if(x.program.history.length>=150||targets.some(p=>p.history.length>=30))fail(413,'Revision limit reached');
        for(const p of targets){const owner=a.patch.ownerId??p.ownerId,review=a.patch.reviewerId??p.reviewerId;
          if(owner)await authorized(owner,['Auditor','Lead Auditor']);
          if(review){await authorized(review,['Reviewer','Lead Auditor']);if(review===owner||p.contributors.includes(review)||review===c.userId)fail(400,'Choose an independent reviewer for '+p.title);}
        }
        for(const p of targets){recordHistory(p);Object.assign(p,a.patch,{revision:p.revision+1,review:undefined,updatedBy:c.userId,updatedAt:c.at,contributors:[...new Set([...p.contributors,c.userId])]});}
        programDraft();return {count:String(targets.length)};
    }
    if(op==='publishClientClarification'){
        writer();const a=z.object({grantId:short,text:text}).strict().parse(data),g=w().clientGrants.find(g=>g.id===a.grantId)??fail(404,'Request assignment not found');
        if(!g.active||Date.parse(g.expiresAt)<=Date.parse(c.at))fail(409,'The client assignment has expired');
        g.communications??=[];if(g.communications.length>=80)fail(413,'Open a follow-up request to continue this thread');
        g.communications.push({id:c.id('MSG'),actor:c.userId,at:c.at,kind:'clarification',text:a.text});return {grantId:g.id};
    }
    if(op==='acknowledgeClientSubmission'){
        writer();const a=z.object({submissionId:short,note:text}).strict().parse(data),s=w().submissions.find(s=>s.id===a.submissionId)??fail(404,'Submission not found');
        if(s.receipt)fail(409,'This package is already acknowledged');s.receipt={actor:c.userId,at:c.at,note:a.note};return {submissionId:s.id,requestId:s.requestId};
    }
    if (op === 'saveProcedurePlan') {
        writer();
        const a = z.object({ procedureId: short, plan: planFields }).strict().parse(data), p = procedure(a.procedureId), x = w();
        if (x.program.status !== 'draft')
            lead();
        if (a.plan.ownerId)
            await authorized(a.plan.ownerId, ['Auditor', 'Lead Auditor']);
        if (a.plan.reviewerId) {
            await authorized(a.plan.reviewerId, ['Reviewer', 'Lead Auditor']);
            if (a.plan.reviewerId === a.plan.ownerId || p.contributors.includes(a.plan.reviewerId))
                fail(400, 'Choose a reviewer independent of this procedure\'s preparers');
        }
        if (a.plan.modelId && !e.models.some(m => m.id === a.plan.modelId))
            fail(400, 'Choose a model from this engagement');
        if (a.plan.datasetId && !e.artifacts.some(q => q.id === a.plan.datasetId && q.category === 'Dataset' && q.status === 'accepted'))
            fail(400, 'Choose an accepted dataset from this engagement');
        if (a.plan.profileId && !e.evaluationProfiles?.some(q => q.id === a.plan.profileId))
            fail(400, 'Choose a protocol from this engagement');
        recordHistory(p);
        p.revision++;
        Object.assign(p, a.plan, { updatedBy: c.userId, updatedAt: c.at, contributors: [...new Set([...p.contributors, c.userId])], review: undefined });
        programDraft();
        return { procedureId: p.id };
    }
    if (op === 'scopeProgramCandidates') {
        writer();
        const x = w();
        if (x.program.status !== 'draft')
            lead();
        const a = z.object({ procedureIds: z.array(short).min(1).max(40), selected: z.boolean(), applicability: z.enum(['applicable', 'readiness', 'not_applicable']), rationale: text, periodAnalysis: text }).strict().parse(data);
        for (const pid of a.procedureIds) {
            const p = procedure(pid);
            recordHistory(p);
            Object.assign(p, { selected: a.selected, applicability: a.applicability, rationale: a.rationale, periodAnalysis: a.periodAnalysis, criterion: p.criterion || 'Approved engagement methodology: ' + p.objective, revision: p.revision + 1, review: undefined, updatedBy: c.userId, updatedAt: c.at, contributors: [...new Set([...p.contributors, c.userId])] });
        }
        programDraft();
        return { count: String(a.procedureIds.length) };
    }
    if (op === 'ensureProcedurePaper') {
        writer();
        const a = z.object({ procedureId: short }).strict().parse(data), p = procedure(a.procedureId);
        let q = e.papers.find(q => q.id === p.paperId);
        if (!q) {
            q = c.makePaper(p.templateId);
            q.required = false;
            q.body.scope = p.population;
            q.body.criteria = p.criterion;
            e.papers.push(q);
            p.paperId = q.id;
        }
        return { paperId: q.id, procedureId: p.id };
    }
    if (op === 'returnProcedure') {
        const a = z.object({ procedureId: short, reason: text }).strict().parse(data), p = procedure(a.procedureId);
        independent(p.contributors);
        if (p.reviewerId !== c.userId || p.state !== 'submitted')
            fail(409, 'The assigned reviewer can return submitted work');
        recordHistory(p);
        p.state = p.execution?.assessment ? 'evaluated' : 'executed';
        p.review = undefined;
        const q = e.papers.find(q => q.id === p.paperId);
        if (q) {
            q.comments.push({ id: c.id('COMMENT'), authorId: c.userId, text: a.reason, resolved: false, createdAt: c.at });
            q.status = 'draft';
            q.reviews = [];
            q.signatures = [];
        }
        return { procedureId: p.id };
    }
    if (op === 'submitProgram') {
        writer();
        const x = w();
        if (x.brief?.status !== 'approved')
            fail(409, 'Approve scope before the program');
        if (x.program.status !== 'draft')
            fail(409, 'Only a draft program can be submitted');
        if (!x.procedures.some(p => p.selected && ['applicable', 'readiness'].includes(p.applicability)))
            fail(400, 'Select at least one applicable or readiness procedure');
        for (const p of x.procedures) {
            if (p.applicability === 'pending' || !p.rationale.trim() || !p.periodAnalysis.trim() || !p.criterion.trim())
                fail(400, p.templateId + ': record applicability, criterion, period analysis and scope rationale');
            if (p.selected && ['applicable', 'readiness'].includes(p.applicability)) {
                if (!p.population.trim() || !p.sampling.trim() || !p.dueDate)
                    fail(400, p.templateId + ': record population, sampling and deadline');
                await authorized(p.ownerId, ['Auditor', 'Lead Auditor']);
                await authorized(p.reviewerId, ['Reviewer', 'Lead Auditor']);
                if (p.reviewerId === p.ownerId || p.contributors.includes(p.reviewerId))
                    fail(400, p.templateId + ': reviewer must be independent');
                if (p.method !== 'manual' && (!p.modelId || !p.datasetId || !p.profileId))
                    fail(400, p.templateId + ': pin model, dataset and protocol for automated work');
            }
        }
        x.program.status = 'submitted';
        x.program.briefRevision = x.brief.revision;
        return { programRevision: String(x.program.revision) };
    }
    if (op === 'approveProgram') {
        const x = w();
        independent(x.program.contributors);
        const a = z.object({ revision: z.number().int(), reason: text }).strict().parse(data);
        if (x.program.status !== 'submitted' || x.program.revision !== a.revision || x.program.briefRevision !== x.brief?.revision || x.brief?.status !== 'approved')
            fail(409, 'Review the current submitted program against approved scope');
        x.program.approval = { userId: c.userId, at: c.at, revision: x.program.revision, hash: await c.sha256(JSON.stringify(x.procedures.map(p => ({ id: p.id, revision: p.revision, plan: plan(p) })))), reason: a.reason };
        x.program.status = 'approved';
        return { programRevision: String(x.program.revision) };
    }
    if (op === 'recordProcedureExecution') {
        writer();
        const x = ready(), a = z.object({ procedureId: short, performed: text, steps: z.array(z.object({ id: short, state: z.enum(['performed', 'not_performed']), notes: optional })).min(1).max(30), sampling: text, results: text, limitations: optional, evidenceIds: z.array(short).min(1).max(100), runIds: z.array(short).max(30) }).strict().parse(data), p = procedure(a.procedureId);
        if (!p.selected || !['applicable', 'readiness'].includes(p.applicability))
            fail(409, 'This procedure is outside the approved execution program');
        if (p.ownerId !== c.userId && c.role !== 'Lead Auditor')
            fail(403, 'The assigned preparer or Lead must record execution');
        if (p.state === 'submitted')
            fail(409, 'Resolve the submitted review before changing execution');
        accepted(a.evidenceIds);
        if (a.steps.length !== p.instructions.length || new Set(a.steps.map(s => s.id)).size !== p.instructions.length || a.steps.some(s => !p.instructions.some(i => i.id === s.id) || s.state === 'not_performed' && !s.notes.trim()))
            fail(400, 'Record every planned step once; explain omitted work');
        if (p.method !== 'manual' && !a.runIds.length)
            fail(400, 'Include the planned automated evaluation');
        for (const runId of a.runIds) {
            const r = e.runs.find(r => r.id === runId);
            if (!r || r.state !== 'succeeded' || !r.procedureBinding || await c.sha256(JSON.stringify(r.procedureBinding)) !== r.provenance.inputHashes.auditBinding || r.procedureBinding?.procedureId !== p.id || r.procedureBinding.procedureRevision !== p.revision || r.modelId !== p.modelId || r.datasetId !== p.datasetId || r.profileId !== p.profileId || r.procedureBinding.programRevision !== x.program.revision || r.procedureBinding.briefRevision !== x.brief!.revision)
                fail(400, 'Link completed runs bound to this approved procedure and scope');
        }
        recordHistory(p);
        const { procedureId, ...actual } = a;
        p.execution = { ...actual, id: c.id('EXEC'), revision: (p.execution?.revision ?? 0) + 1, procedureRevision: p.revision, briefRevision: x.brief!.revision, programRevision: x.program.revision, actor: c.userId, at: c.at };
        p.state = 'executed';
        p.review = undefined;
        p.contributors = [...new Set([...p.contributors, c.userId])];
        return { procedureId: p.id };
    }
    if (op === 'evaluateProcedure') {
        writer();
        ready();
        const a = z.object({ procedureId: short, relevance: text, reliability: text, coverage: text, contradictions: text, conclusion: text, outcome: z.enum(['supported', 'qualified', 'not_supported']) }).strict().parse(data), p = procedure(a.procedureId);
        if (!p.execution || !currentExecution(e, p) || p.state === 'submitted')
            fail(409, 'Record current execution before evaluation');
        accepted(p.execution.evidenceIds);
        recordHistory(p);
        const { procedureId, ...assessment } = a;
        p.execution.assessment = { ...assessment, actor: c.userId, at: c.at };
        p.state = 'evaluated';
        p.review = undefined;
        p.contributors = [...new Set([...p.contributors, c.userId])];
        return { procedureId: p.id };
    }
    if (op === 'reaffirmExecution') {
        ready();
        const a = z.object({ procedureId: short, reason: text }).strict().parse(data), p = procedure(a.procedureId);
        independent(p.contributors);
        if (!p.execution || p.execution.procedureRevision !== p.revision)
            fail(409, 'Changed procedure steps require a new execution');
        accepted(p.execution.evidenceIds);
        recordHistory(p);
        p.execution.impactReview = { briefRevision: w().brief!.revision, programRevision: w().program.revision, actor: c.userId, at: c.at, reason: a.reason };
        p.state = p.execution.assessment ? 'evaluated' : 'executed';
        p.review = undefined;
        return { procedureId: p.id };
    }
    if (op === 'submitProcedure') {
        writer();
        ready();
        const a = z.object({ procedureId: short }).strict().parse(data), p = procedure(a.procedureId), v = p.execution;
        if (p.state !== 'evaluated' || !v?.assessment || !currentExecution(e, p))
            fail(409, 'Evaluate current execution before review');
        accepted(v.evidenceIds);
        const pending = e.evidenceRequests?.filter(r => r.paperIds.includes(p.paperId ?? '') && !['accepted', 'waived'].includes(r.status));
        if (pending?.length)
            fail(400, 'Resolve related evidence requests before procedure review');
        let paper = e.papers.find(q => q.id === p.paperId);
        if (paper?.comments.some(q => !q.resolved))
            fail(400, 'Respond to and resolve open review questions');
        if (!paper || paper.status === 'signed') {
            paper = c.makePaper(p.templateId);
            e.papers.push(paper);
            p.paperId = paper.id;
        }
        else {
            paper.history.push({ revision: paper.revision, body: { ...paper.body }, authorId: paper.authorId, at: paper.updatedAt, evidenceIds: [...paper.evidenceIds], runIds: [...paper.runIds], reviews: [...paper.reviews], signatures: [...paper.signatures], contributors: [...paper.contributors] });
            paper.revision++;
        }
        paper.authorId = c.userId;
        paper.contributors = [...new Set([...paper.contributors, ...p.contributors])];
        paper.body = { objective: p.objective, scope: p.population + '\nApproved engagement brief revision ' + w().brief!.revision, criteria: p.criterion + '\nSource ' + p.sourceVersion + '\n' + p.periodAnalysis, procedures: v.performed + '\n' + v.steps.map(s => p.instructions.find(i => i.id === s.id)?.text + ': ' + s.state + ' ' + s.notes).join('\n'), sampling: v.sampling, results: v.results + '\nRelevance: ' + v.assessment.relevance + '\nReliability: ' + v.assessment.reliability + '\nCoverage: ' + v.assessment.coverage + '\nContradictions: ' + v.assessment.contradictions, limitations: v.limitations, conclusion: v.assessment.conclusion, conclusionStatus: v.assessment.outcome };
        paper.plannedGuidance = p.instructions.map(i => i.text).join('\n');
        paper.evidenceIds = [...v.evidenceIds];
        paper.runIds = [...v.runIds];
        paper.required = p.stage !== 'Remediation and Monitoring';
        paper.status = 'in_review';
        paper.updatedAt = c.at;
        paper.reviews = [];
        paper.signatures = [];
        p.paperRevision = paper.revision;
        p.state = 'submitted';
        return { procedureId: p.id, paperId: paper.id };
    }
    if (op === 'reviewProcedure') {
        const a = z.object({ procedureId: short, reason: text }).strict().parse(data), p = procedure(a.procedureId);
        independent(p.contributors);
        if (p.reviewerId !== c.userId)
            fail(403, 'Only the assigned independent reviewer can approve this procedure');
        ready();
        const paper = e.papers.find(q => q.id === p.paperId);
        if (p.state !== 'submitted' || !currentExecution(e, p) || !paper || paper.revision !== p.paperRevision || paper.status !== 'in_review' || paper.comments.some(q => !q.resolved))
            fail(409, 'Review the current submitted revision with resolved questions');
        if (paper.contributors.includes(c.userId) || paper.authorId === c.userId)
            fail(403, 'The paper reviewer must be independent');
        paper.reviews.push({ userId: c.userId, revision: paper.revision, at: c.at });
        paper.status = 'reviewed';
        p.review = { userId: c.userId, at: c.at, revision: p.revision, hash: await c.sha256(JSON.stringify(p.execution)), reason: a.reason };
        p.state = 'reviewed';
        return { procedureId: p.id, paperId: paper.id };
    }
    if (op === 'grantClientRequest') {
        lead();
        const a = z.object({ userId: short, requestId: short, prompt: text, instructions: text, category: z.enum(['Dataset', 'Model', 'Training log', 'Validation', 'Pipeline code', 'Governance', 'Instructions', 'Oversight', 'Security', 'Other']), handlingBasis: z.enum(['synthetic', 'anonymized']), expiresAt: z.string().datetime(), requestedItems:z.array(short).max(30).optional() }).strict().parse(data), member = await authorized(a.userId, ['Client Contributor']);
        if (member.client_id !== e.clientId)
            fail(400, 'The contributor must belong to this client');
        if (!e.evidenceRequests?.some(r => r.id === a.requestId && !['accepted', 'waived'].includes(r.status)))
            fail(400, 'Choose an outstanding request from this engagement');
        if (Date.parse(a.expiresAt) <= Date.parse(c.at) || Date.parse(a.expiresAt) > Date.parse(c.at) + 366 * 86400000)
            fail(400, 'Access must expire within the next year');
        const x = w();
        if (x.clientGrants.length >= 200)
            fail(413, 'Request grant limit reached');
        x.clientGrants.push({ ...a, id: c.id('GRANT'), active: true, actor: c.userId, at: c.at });
        return { requestId: a.requestId };
    }
    if (op === 'revokeClientRequest') {
        lead();
        const a = z.object({ grantId: short, reason: text }).strict().parse(data), g = w().clientGrants.find(g => g.id === a.grantId) ?? fail(404, 'Grant not found');
        g.active = false;
        g.revokedAt = c.at;
        g.revokedBy = c.userId;
        return { grantId: g.id, reason: a.reason };
    }
    if (op === 'updateClientRequest') {
        lead();
        const a = z.object({ grantId: short, prompt: text, instructions: text, requestedItems:z.array(short).max(30).optional() }).strict().parse(data), g = w().clientGrants.find(g => g.id === a.grantId) ?? fail(404, 'Grant not found');
        if (!g.active || Date.parse(g.expiresAt) <= Date.parse(c.at))
            fail(409, 'Create a new grant for expired or revoked access');
        g.history ??= [];
        if (g.history.length >= 30)
            fail(413, 'Instruction revision limit reached');
        g.history.push({ actor: c.userId, at: c.at, prompt: g.prompt, instructions: g.instructions,requestedItems:g.requestedItems?[...g.requestedItems]:undefined });
        g.prompt = a.prompt;
        g.instructions = a.instructions;
        if(a.requestedItems)g.requestedItems=a.requestedItems;
        return { grantId: g.id };
    }
    if (op === 'approveReportPackage') {
        reviewer();
        const a = z.object({ reportId: short, internalHash: short, clientHash: short, reason: text }).strict().parse(data), r = e.reports.find(r => r.id === a.reportId) ?? fail(404, 'Report not found');
        if (r.kind !== 'final' || !['internal', 'approved'].includes(releaseState(r)))
            fail(409, 'Approve an internal final package');
        if (!r.snapshot.workflow)
            fail(409, 'Prepare a current final package capturing the approved scope and audit program');
        if (r.actor === c.userId)
            fail(403, 'The report creator cannot approve its package');
        if (r.sha256 !== a.internalHash || r.clientSha256 !== a.clientHash)
            fail(409, 'Review both exact package hashes');
        r.release ??= { state: 'internal', history: [] };
        r.release.approval = { userId: c.userId, at: c.at, internalHash: r.sha256, clientHash: r.clientSha256!, reason: a.reason };
        r.release.state = 'approved';
        r.release.history.push({ actor: c.userId, at: c.at, action: 'approve', reason: a.reason });
        return { reportId: r.id };
    }
    if (op === 'releaseReport') {
        lead();
        const a = z.object({ reportId: short, recipientScope: text, reason: text, supersedes: uid.optional() }).strict().parse(data), r = e.reports.find(r => r.id === a.reportId) ?? fail(404, 'Report not found'), release = r.release;
        if (release?.state !== 'approved' || release.approval?.internalHash !== r.sha256 || release.approval.clientHash !== r.clientSha256 || release.approval.userId === c.userId)
            fail(409, 'A different independent approver must approve both exact packages before release');
        if (workflowRequirements(e, true).length)
            fail(409, 'Resolve current scope/program completion before release');
        if (a.supersedes) {
            const old = e.reports.find(q => q.id === a.supersedes);
            if (!old || releaseState(old) !== 'released' || old.id === r.id)
                fail(400, 'Select a released predecessor from this engagement');
            old.release!.state = 'superseded';
            old.release!.supersededBy = r.id;
            old.release!.history.push({ actor: c.userId, at: c.at, action: 'supersede', reason: a.reason });
            release.supersedes = old.id;
        }
        Object.assign(release, { state: 'released', recipientScope: a.recipientScope, releasedBy: c.userId, releasedAt: c.at });
        release.history.push({ actor: c.userId, at: c.at, action: 'release', reason: a.reason });
        return { reportId: r.id };
    }
    if (op === 'withdrawReport') {
        lead();
        const a = z.object({ reportId: short, reason: text }).strict().parse(data), r = e.reports.find(r => r.id === a.reportId) ?? fail(404, 'Report not found');
        if (!['released', 'approved'].includes(releaseState(r)))
            fail(409, 'Only an approved or released report can be withdrawn');
        r.release!.state = 'withdrawn';
        r.release!.history.push({ actor: c.userId, at: c.at, action: 'withdraw', reason: a.reason });
        return { reportId: r.id };
    }
    if (op === 'createMonitoringCase') {
        writer();
        const a = z.object({ kind: z.enum(['monitoring', 'change', 'incident', 'remediation']), title: short, description: text, ownerId: short, dueDate: calendarDate, cadence: z.enum(['one_off', 'monthly', 'quarterly', 'annual']), findingId: uid, reportId: uid, previousCaseId: short.optional() }).strict().parse(data);
        await authorized(a.ownerId, ['Auditor', 'Lead Auditor']);
        if (a.findingId && !e.findings.some(f => f.id === a.findingId))
            fail(400, 'Select a finding from this engagement');
        if (a.reportId && !e.reports.some(r => r.id === a.reportId && r.kind === 'final'))
            fail(400, 'Select a final report from this engagement');
        const x = w();
        if (x.monitoring.length >= 150)
            fail(413, 'Follow-up case limit reached');
        const m: MonitoringCase = { ...a, id: c.id('CASE'), state: 'open', decision: 'not_assessed', assessment: '', evidenceIds: [], contributors: [c.userId], createdBy: c.userId, createdAt: c.at, updatedAt: c.at, history: [] };
        if (a.previousCaseId) {
            const previous = x.monitoring.find(q => q.id === a.previousCaseId);
            if (!previous || previous.state !== 'closed' || previous.cadence === 'one_off' || previous.nextCaseId || a.dueDate <= previous.dueDate)
                fail(409, 'Plan one later cycle from a closed recurring monitoring case');
            previous.nextCaseId = m.id;
            previous.history.push({ at: c.at, actor: c.userId, action: 'plan_next_cycle', state: previous.state, assessment: m.description, evidenceIds: [...previous.evidenceIds] });
        }
        x.monitoring.push(m);
        return { caseId: m.id };
    }
    if (op === 'assessMonitoringCase') {
        writer();
        const a = z.object({ caseId: short, decision: z.enum(['follow_up', 'no_reassessment', 'reassessment_required']), assessment: text, evidenceIds: z.array(short).max(100), dueDate: calendarDate }).strict().parse(data), m = w().monitoring.find(q => q.id === a.caseId) ?? fail(404, 'Follow-up case not found');
        if (m.state === 'closed')
            fail(409, 'Create a new case for subsequent work');
        if (a.evidenceIds.length)
            accepted(a.evidenceIds);
        m.history.push({ at: c.at, actor: c.userId, action: 'assess', state: m.state, assessment: m.assessment, evidenceIds: [...m.evidenceIds] });
        Object.assign(m, a, { state: 'in_progress', updatedAt: c.at, contributors: [...new Set([...m.contributors, c.userId])] });
        return { caseId: m.id };
    }
    if (op === 'closeMonitoringCase') {
        const a = z.object({ caseId: short, closure: text }).strict().parse(data), m = w().monitoring.find(q => q.id === a.caseId) ?? fail(404, 'Follow-up case not found');
        independent([...m.contributors, m.ownerId]);
        if (m.state === 'closed' || m.decision === 'not_assessed' || !m.assessment.trim())
            fail(409, 'Assess the case before independent closure');
        accepted(m.evidenceIds);
        if (m.decision === 'reassessment_required' && !m.successorEngagementId)
            fail(400, 'Open a successor engagement before closing the reassessment case');
        m.history.push({ at: c.at, actor: c.userId, action: 'close', state: m.state, assessment: a.closure, evidenceIds: [...m.evidenceIds] });
        Object.assign(m, { state: 'closed', closedBy: c.userId, closedAt: c.at, closure: a.closure, updatedAt: c.at });
        return { caseId: m.id };
    }
    if (op === 'linkFindingSupport') {
        writer();
        const a = z.object({ findingId: short, procedureId: uid, paperIds: z.array(short).max(30), evidenceIds: z.array(short).max(100), runIds: z.array(short).max(30) }).strict().parse(data), f = e.findings.find(f => f.id === a.findingId) ?? fail(404, 'Finding not found');
        if (a.procedureId)
            procedure(a.procedureId);
        if (a.paperIds.some(id => !e.papers.some(p => p.id === id)) || a.runIds.some(id => !e.runs.some(r => r.id === id)))
            fail(400, 'Support must belong to this engagement');
        accepted(a.evidenceIds);
        f.support = { ...a, actor: c.userId, at: c.at };
        return { findingId: f.id };
    }
    if (op === 'recordFindingRetest') {
        reviewer();
        const a = z.object({ findingId: short, performed: text, results: text, rationale: text, evidenceIds: z.array(short).min(1).max(100), conclusion: z.enum(['effective', 'not_effective']) }).strict().parse(data), f = e.findings.find(f => f.id === a.findingId) ?? fail(404, 'Finding not found');
        if (f.createdBy === c.userId || f.remediationBy === c.userId)
            fail(403, 'An independent person must perform the retest');
        if (f.status !== 'ready_for_retest' || !f.remediation.trim())
            fail(409, 'Record management remediation and request retest first');
        accepted(a.evidenceIds);
        f.retest = { ...a, actor: c.userId, at: c.at };
        f.retestEvidenceIds = [...a.evidenceIds];
        return { findingId: f.id };
    }
    if (op === 'reopenFinding') {
        lead();
        const a = z.object({ findingId: short, reason: text }).strict().parse(data), f = e.findings.find(f => f.id === a.findingId) ?? fail(404, 'Finding not found');
        if (f.status !== 'closed')
            fail(409, 'Only a closed finding can be reopened');
        f.closureHistory ??= [];
        f.closureHistory.push({ at: c.at, actor: c.userId, reason: a.reason, closedBy: f.closedBy, retest: f.retest });
        f.status = 'open';
        f.closedBy = undefined;
        f.retest = undefined;
        return { findingId: f.id };
    }
    return fail(400, 'Unknown workflow command');
}
