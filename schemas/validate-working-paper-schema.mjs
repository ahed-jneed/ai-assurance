/** Working-paper contract checks: engine drafts, the blank catalog template, status gates and, with --documents, exported papers. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(directory, '..');
const args = process.argv.slice(2);
const ajvPackage = args.includes('--ajv-package') ? args[args.indexOf('--ajv-package') + 1] : [resolve(workspace, 'site-app/package.json'), resolve(workspace, '../package.json')].find(existsSync);
assert.ok(ajvPackage, 'Supply --ajv-package pointing to a package with Ajv 2020 and ajv-formats installed.');
const require = createRequire(resolve(ajvPackage));
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const schema = json(resolve(directory, 'working-paper.schema.json'));
assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors));
const validate = ajv.compile(schema);
let accepted = 0;
let rejected = 0;
function positive(label, paper) {
  assert.equal(validate(paper), true, `${label}: ${JSON.stringify(validate.errors)}`);
  accepted++;
}
function negative(label, paper, mutate) {
  const changed = structuredClone(paper);
  mutate(changed);
  assert.equal(validate(changed), false, `${label}: malformed paper accepted`);
  rejected++;
}

// Drafts that engine/diagnostics.py derives from each diagnostic result.
const drafts = ['report.json', 'report-v1.1.json', 'report-v1.1.1.json']
  .flatMap(name => json(resolve(workspace, 'engine/examples', name)).workingPapers);
assert.ok(drafts.length > 0, 'Expected engine-generated drafts');
drafts.forEach((paper, index) => positive(`Engine draft ${index} (${paper.title})`, paper));
const draft = drafts[0];
negative('draft carrying a sign-off', draft, paper => { paper.review.signOffs = [{ actor: 'fixture-reviewer' }]; });
negative('draft without mandatory review', draft, paper => { paper.review.required = false; });
negative('draft presented as approved', draft, paper => { paper.status = 'approved'; });
negative('draft unknown field', draft, paper => { paper.arbitrary = true; });

// Catalog revisions start from the blank template. The extracted runtime
// package ships engine/ and schemas/ only, so it skips these checks.
const templates = resolve(workspace, 'templates');
const withTemplates = existsSync(templates);
if (withTemplates) {
  const blank = json(resolve(templates, 'working-paper.blank.json'));
  positive('Blank catalog template (draft)', blank);
  negative('revision unknown field', blank, paper => { paper.arbitrary = true; });
  negative('revision unknown stage', blank, paper => { paper.stage = 'fieldwork'; });
  const digest = 'd'.repeat(64);
  const approval = (actorId, role, approvedAt) => ({ actorId, role, decision: 'approve', revision: 1, contentDigest: digest, approvedAt, signatureReference: `SIG-${actorId}` });
  // A complete submitted paper; each negative case breaks exactly one gate.
  const submitted = structuredClone(blank);
  Object.assign(submitted.evaluation, { evidenceSufficiency: 'sufficient', auditorConclusion: 'supported', rationale: 'Synthetic fixture rationale covering the approved criteria.' });
  submitted.status = 'submitted';
  positive('Submitted catalog revision', submitted);
  negative('submitted without evaluation rationale', submitted, paper => { paper.evaluation.rationale = ''; });
  const sealed = structuredClone(submitted);
  sealed.approvals = [approval('fixture-reviewer', 'reviewer', '2026-10-06T09:00:00Z'), approval('fixture-lead', 'lead_auditor', '2026-10-06T10:00:00Z')];
  sealed.status = 'sealed';
  sealed.provenance.contentDigest = digest;
  positive('Sealed catalog revision', sealed);
  negative('reviewed without approvals', sealed, paper => { paper.status = 'reviewed'; paper.approvals = []; });
  negative('reviewed without auditor conclusion', sealed, paper => { paper.status = 'reviewed'; paper.evaluation.auditorConclusion = 'not_assessed'; });
  negative('sealed with a single approval', sealed, paper => { paper.approvals.pop(); });
  negative('sealed without content digest', sealed, paper => { paper.provenance.contentDigest = null; });
  // Revision 1.1.0, which the application exports, carries the kind and the
  // narrative; 1.0.0 documents stay valid without them.
  const earlier = structuredClone(blank);
  earlier.schemaVersion = '1.0.0';
  delete earlier.kind;
  delete earlier.narrative;
  positive('Revision 1.0.0 without kind or narrative', earlier);
  negative('1.1.0 revision without narrative', blank, paper => { delete paper.narrative; });
  negative('1.1.0 revision without kind', blank, paper => { delete paper.kind; });
  negative('narrative with an unknown section', blank, paper => { paper.narrative.background = ''; });
  negative('narrative with an unknown conclusion status', blank, paper => { paper.narrative.conclusionStatus = 'pending'; });
  negative('submitted with a blank rationale', submitted, paper => { paper.evaluation.rationale = '   '; });
  // A memo carries the decision records it rests on.
  const memo = structuredClone(sealed);
  Object.assign(memo, { catalogId: 'MEM-SO-01', kind: 'memo', stage: 'Sign-off', title: 'Completion and issue authorization memo' });
  memo.approvals.push({ ...approval('fixture-eqr', 'engagement_quality_reviewer', '2026-10-06T11:00:00Z') });
  memo.records = {
    qualityReview: { reviewerId: 'fixture-eqr', checklistRevision: 2, signOffs: [{ reportId: 'REPORT-1', internalHash: digest, clientHash: digest, checklistRevision: 2, conclusion: 'No matter remains unresolved', userId: 'fixture-eqr', at: '2026-10-06T11:00:00Z' }] },
    releaseCompletion: { reportId: 'REPORT-1', templateIds: ['WP-RP-02', 'MEM-SO-01'], internalHash: digest, clientHash: digest, approvedBy: 'fixture-reviewer', approvedAt: '2026-10-06T09:00:00Z', releasedBy: 'fixture-lead', releasedAt: '2026-10-06T12:00:00Z' },
  };
  positive('Sealed memo with its decision records', memo);
  negative('working paper carrying memo records', memo, paper => { paper.kind = 'working_paper'; });
  negative('memo record with an unknown kind', memo, paper => { paper.records.minutes = {}; });
  negative('sign-off without its package hash', memo, paper => { delete paper.records.qualityReview.signOffs[0].internalHash; });
  negative('release completion with a malformed hash', memo, paper => { paper.records.releaseCompletion.clientHash = 'x'; });
  // The approver's completion checklist, recorded with the approval (#94).
  const answered = structuredClone(memo);
  answered.records.releaseCompletion.checklist = { items: [{ id: 'independence', answer: 'confirmed' }, { id: 'representations', answer: 'not_applicable' }], note: 'No responsible party distinct from the engaging party.' };
  positive('Sealed memo with the completion checklist', answered);
  negative('completion checklist with an unknown answer', answered, paper => { paper.records.releaseCompletion.checklist.items[0].answer = 'no'; });
  negative('completion checklist without its note', answered, paper => { delete paper.records.releaseCompletion.checklist.note; });
}
// Documents a paper export wrote, for example the papers/*.json files of a
// dossier or the workingPapers of a report package: a JSON array, or an
// object whose `documents` array holds them.
if (args.includes('--documents')) {
  const supplied = json(resolve(args[args.indexOf('--documents') + 1]));
  const documents = Array.isArray(supplied) ? supplied : supplied.documents;
  assert.ok(Array.isArray(documents) && documents.length > 0, 'Expected exported working-paper documents');
  for (const paper of documents) positive(`Exported ${paper.kind ?? 'paper'} ${paper.catalogId ?? paper.id} (${paper.status})`, paper);
}
console.log(`PASS working-paper contract: ${accepted} valid papers; ${rejected} rejected malformed papers; ${drafts.length} engine drafts` + (withTemplates ? '; blank catalog template validated' : '; templates/ absent, catalog revisions not checked'));
