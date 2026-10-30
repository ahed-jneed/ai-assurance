import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

// Load the actual predicates and their relative imports without a browser/server.
const modules = new Map();
async function sourceURL(file) {
  const filename = path.resolve(file);
  if (modules.has(filename)) return modules.get(filename);
  let output = ts.transpileModule(await fs.readFile(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const match of [...output.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)]) {
    const dependency = path.resolve(path.dirname(filename), match[2] + '.ts');
    output = output.replace(match[0], 'from ' + JSON.stringify(await sourceURL(dependency)));
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(output, 'utf8').toString('base64');
  modules.set(filename, url);
  return url;
}
const { engagementWork, procedureWork, orderWork } = await import(await sourceURL('lib/work-items.ts'));
const at = '2026-10-10T09:00:00.000Z', today = '2026-10-10';
function fixture() {
  return {
    id: 'engagement', title: 'System assurance', clientId: 'client', stage: 'Fieldwork', dueDate: '2026-10-20',
    papers: [{
      id: 'paper', templateId: 'WP-10', title: 'Data assurance', kind: 'working_paper', stage: 'Fieldwork',
      articleRefs: ['Art. 10'], required: true, revision: 2, authorId: 'preparer', contributors: ['preparer'],
      updatedAt: at, status: 'in_review',
      body: { results: 'Checks performed', conclusion: 'Supported by accepted records', conclusionStatus: 'supported', criteria: 'Data quality criteria' },
      evidenceIds: ['evidence'], runIds: [], comments: [], reviews: [], signatures: [], history: [],
    }],
    artifacts: [{ id: 'evidence', name: 'Validation record', status: 'accepted' }],
    evidenceRequests: [], findings: [], reports: [], runs: [], models: [],
    workflow: {
      adoptedBy: 'preparer', brief: { revision: 2, status: 'approved', contributors: ['preparer'], updatedBy: 'preparer' },
      program: { revision: 3, briefRevision: 2, status: 'approved', contributors: ['preparer'], updatedBy: 'preparer' },
      procedures: [{
        id: 'procedure', title: 'Data assurance', templateId: 'WP-10', selected: true, applicability: 'applicable',
        stage: 'Fieldwork', ownerId: 'preparer', reviewerId: 'reviewer', dueDate: '2026-10-09', revision: 4,
        contributors: ['preparer'], paperId: 'paper', paperRevision: 2, state: 'submitted', history: [],
        execution: {
          id: 'execution', revision: 1, briefRevision: 2, programRevision: 3, procedureRevision: 4, evidenceIds: ['evidence'],
          assessment: { conclusion: 'Supported', outcome: 'supported', actor: 'preparer', at },
        },
      }], monitoring: [],
    },
  };
}
function reviewed() {
  const e = fixture(), p = e.workflow.procedures[0], paper = e.papers[0];
  p.state = 'reviewed'; p.review = { revision: 4, userId: 'reviewer', at };
  paper.status = 'reviewed'; paper.reviews = [{ revision: 2, userId: 'reviewer', at }];
  return e;
}
function work(e = fixture(), role = 'Reviewer', userId = 'reviewer') {
  return engagementWork(e, role, userId, 'Client', today);
}
const procedure = (e, role, userId) => work(e, role, userId).find(i => i.kind === 'procedure');
const questions = (e, role, userId) => work(e, role, userId).find(i => i.kind === 'paper');
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

if (process.argv.includes('--local-calendar')) {
  const NativeDate = Date, fixed = new NativeDate('2026-10-09T22:30:00.000Z').getTime();
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
  assert.equal(new Date().toISOString().slice(0, 10), '2026-10-09');
  assert.equal(procedureWork(fixture(), 'procedure').overdue, true, 'Vienna has reached October 10 even while UTC is October 9');
  const items = [
    { id: 'urgent-today', title: 'Today', dueDate: '2026-10-10', priority: 0 },
    { id: 'overdue', title: 'Yesterday', dueDate: '2026-10-09', priority: 3 },
  ];
  assert.equal(orderWork(items)[0].id, 'overdue', 'Default ordering uses the same local date as deadline labels');
  assert.equal(engagementWork(fixture(), 'Reviewer', 'reviewer')[0].priority, 0, 'Procedure priority uses the injected local calendar');
  process.exit(0);
}

const eligible = procedure(fixture(), 'Reviewer', 'reviewer');
assert.equal(eligible.personal, true);
assert.equal(eligible.state, 'review');
assert.equal(eligible.section, 'review');
assert.equal(eligible.ownerId, 'reviewer');
assert.equal(eligible.dueDate, '2026-10-09');
assert.equal(eligible.engagementId, 'engagement');
assert.equal(procedure(fixture(), 'Reviewer', 'other-reviewer').personal, false);
assert.equal(procedure(fixture(), 'Lead Auditor', 'preparer').personal, false, 'A contributing Lead cannot review their prepared work');
for (const contaminate of [
  e => { e.workflow.procedures[0].contributors.push('reviewer'); },
  e => { e.papers[0].contributors.push('reviewer'); },
  e => { e.papers[0].authorId = 'reviewer'; },
  e => { e.workflow.procedures[0].reviewerId = 'preparer'; },
  e => { e.workflow.procedures[0].reviewerId = ''; },
]) {
  const e = fixture(); contaminate(e);
  assert.equal(procedure(e, 'Lead Auditor', 'lead').state, 'planning');
  assert.equal(procedure(e, 'Reviewer', 'reviewer').personal, false, 'A reviewer independence/assignment conflict is a planning dependency');
}
console.log('PASS assigned independent source review, paper contributor conflicts and scoped handoffs');

for (const invalidate of [
  e => { e.workflow.brief.status = 'submitted'; },
  e => { e.workflow.program.status = 'draft'; },
  e => { e.workflow.program.briefRevision = 1; },
  e => { e.workflow.procedures[0].execution.programRevision = 2; },
  e => { e.workflow.procedures[0].execution.procedureRevision = 3; },
  e => { e.workflow.procedures[0].execution = undefined; },
  e => { e.papers[0].revision = 3; },
  e => { e.papers[0].status = 'draft'; },
  e => { e.papers = []; },
  e => { e.artifacts[0].status = 'quarantined'; },
]) {
  const e = fixture(); invalidate(e);
  const item = procedure(e, 'Reviewer', 'reviewer');
  assert.equal(item.state, 'waiting', 'Stale or incomplete submitted records cannot be promoted as ready review');
}
const staleProgram = fixture(); staleProgram.workflow.program.briefRevision = 1;
assert.equal(work(staleProgram, 'Lead Auditor', 'lead').find(i => i.kind === 'program').action, 'Reassess audit program');
const reassessed = fixture(); reassessed.workflow.procedures[0].execution.programRevision = 2;
reassessed.workflow.procedures[0].execution.impactReview = { briefRevision: 2, programRevision: 3 };
assert.equal(procedure(reassessed, 'Reviewer', 'reviewer').state, 'review', 'A valid independent scope impact assessment can reaffirm current execution');
console.log('PASS current approved scope/program, execution bindings, compiled revision and accepted-evidence dependencies');

const comment = { id: 'question', authorId: 'reviewer', text: 'Explain this exception', resolved: false, responses: [] };
const open = fixture(); open.papers[0].comments = [comment];
assert.equal(procedure(open, 'Reviewer', 'reviewer'), undefined, 'Questions have one paper handoff, not a duplicated procedure action');
assert.equal(questions(open, 'Reviewer', 'reviewer').state, 'waiting');
assert.equal(questions(open, 'Reviewer', 'reviewer').action, 'Await a response');
assert.equal(questions(open, 'Reviewer', 'reviewer').module, 'Working papers');
assert.equal(questions(open, 'Reviewer', 'reviewer').section, 'review');
assert.equal(questions(open, 'Reviewer', 'reviewer').dueDate, '2026-10-09');
assert.equal(questions(open, 'Auditor', 'preparer').state, 'ready');
assert.equal(questions(open, 'Auditor', 'preparer').action, 'Respond to questions');
assert.equal(questions(open, 'Reviewer', 'other-reviewer').personal, false);
const responded = structuredClone(open); responded.papers[0].comments[0].responses.push({ actor: 'preparer', at, text: 'Explanation provided' });
assert.equal(questions(responded, 'Reviewer', 'reviewer').state, 'review');
assert.equal(questions(responded, 'Reviewer', 'reviewer').action, 'Check responses');
const standalone = structuredClone(open); standalone.workflow.procedures = [];
assert.equal(questions(standalone, 'Reviewer', 'reviewer').state, 'waiting', 'Unbound questions also await a response before resolution');
assert.equal(questions(standalone, 'Reviewer', 'reviewer').section, 'review');
console.log('PASS direct comment handoffs, attributed responses and truthful waiting states');

const oldReview = reviewed(); oldReview.papers[0].reviews.unshift({ revision: 1, userId: 'lead', at });
assert.equal(procedure(oldReview, 'Lead Auditor', 'lead').personal, true, 'An old review by this Lead does not bar signing a newer independently reviewed revision');
assert.equal(procedure(oldReview, 'Lead Auditor', 'lead').action, 'Sign reviewed paper');
assert.equal(procedure(reviewed(), 'Lead Auditor', 'reviewer').personal, false, 'The current independent reviewer cannot sign the same revision');
assert.equal(procedure(reviewed(), 'Lead Auditor', 'reviewer').state, 'waiting');
assert.equal(procedure(reviewed(), 'Lead Auditor', 'preparer').personal, true, 'A Lead preparer may sign after another independent reviewer');
for (const invalidate of [
  e => { e.workflow.procedures[0].review = undefined; },
  e => { e.workflow.procedures[0].review.revision = 3; },
  e => { e.workflow.procedures[0].review.userId = 'unassigned'; },
  e => { e.papers[0].reviews[0].revision = 1; },
  e => { e.papers[0].revision = 3; },
]) {
  const e = reviewed(); invalidate(e);
  assert.equal(procedure(e, 'Lead Auditor', 'lead').state, 'waiting', 'Missing/obsolete independent review cannot enable sign-off');
}
const signed = reviewed(); signed.papers[0].status = 'signed';
assert.equal(procedureWork(signed, 'procedure', today).complete, true);
assert.equal(procedure(signed, 'Lead Auditor', 'lead'), undefined);
const staleSigned = structuredClone(signed); staleSigned.papers[0].revision = 3;
assert.equal(procedureWork(staleSigned, 'procedure', today).complete, false);
assert.equal(procedure(staleSigned, 'Lead Auditor', 'lead').state, 'waiting');
console.log('PASS revision-bound sign-off eligibility, review metadata and current completion');

const execution = fixture(); execution.workflow.procedures[0].state = 'executed'; execution.papers[0].status = 'draft';
assert.equal(procedureWork(execution, 'procedure', today).readyToEvaluate, true);
execution.workflow.program.briefRevision = 1;
assert.equal(procedureWork(execution, 'procedure', today).readyToEvaluate, false);
const partial = fixture(); partial.workflow.procedures[0].state = 'evaluated'; partial.workflow.procedures[0].execution.assessment = undefined;
assert.equal(procedure(partial, 'Auditor', 'preparer').action, 'Evaluate evidence', 'A stored evaluated state alone does not prove an assessment exists');
const request = fixture(); request.evidenceRequests = [{ id: 'request', paperIds: ['paper'], status: 'open', createdBy: 'preparer' }];
assert.equal(procedure(request, 'Reviewer', 'reviewer').state, 'waiting');
assert.equal(procedure(request, 'Reviewer', 'reviewer').action, 'Follow up evidence');
assert.deepEqual(work(fixture(), 'Client Viewer', 'client'), []);
assert.deepEqual(work(fixture(), 'Client Contributor', 'client'), []);
const immutable = freeze(reviewed()), before = JSON.stringify(immutable);
work(immutable, 'Lead Auditor', 'lead'); procedureWork(immutable, 'procedure', today);
assert.equal(JSON.stringify(immutable), before);
const unordered = freeze(work(fixture(), 'Reviewer', 'reviewer')), original = JSON.stringify(unordered);
orderWork(unordered, today); assert.equal(JSON.stringify(unordered), original);
console.log('PASS evaluation prerequisites, outstanding requests, client-role restrictions and nonmutation');

const local = spawnSync(process.execPath, [path.resolve('scripts/work-items-check.mjs'), '--local-calendar'], {
  env: { ...process.env, TZ: 'Europe/Vienna' }, encoding: 'utf8',
});
assert.equal(local.status, 0, local.stderr || local.error?.message || 'Local calendar checks failed');
console.log('PASS local calendar defaults near UTC midnight and deterministic date injection');
