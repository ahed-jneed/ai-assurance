/** Working-paper contract checks: engine drafts, the blank catalog template and status gates. */
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
  negative('submitted without evaluation rationale', blank, paper => { paper.status = 'submitted'; });
  const digest = 'd'.repeat(64);
  const approval = (actorId, role, approvedAt) => ({ actorId, role, decision: 'approve', revision: 1, contentDigest: digest, approvedAt, signatureReference: `SIG-${actorId}` });
  const sealed = structuredClone(blank);
  Object.assign(sealed.evaluation, { evidenceSufficiency: 'sufficient', auditorConclusion: 'supported', rationale: 'Synthetic fixture rationale covering the approved criteria.' });
  sealed.approvals = [approval('fixture-reviewer', 'reviewer', '2026-10-06T09:00:00Z'), approval('fixture-lead', 'lead_auditor', '2026-10-06T10:00:00Z')];
  sealed.status = 'sealed';
  sealed.provenance.contentDigest = digest;
  positive('Sealed catalog revision', sealed);
  negative('reviewed without approvals', sealed, paper => { paper.status = 'reviewed'; paper.approvals = []; });
  negative('reviewed without auditor conclusion', sealed, paper => { paper.status = 'reviewed'; paper.evaluation.auditorConclusion = 'not_assessed'; });
  negative('sealed with a single approval', sealed, paper => { paper.approvals.pop(); });
  negative('sealed without content digest', sealed, paper => { paper.provenance.contentDigest = null; });
}
console.log(`PASS working-paper contract: ${accepted} valid papers; ${rejected} rejected malformed papers; ${drafts.length} engine drafts` + (withTemplates ? '; blank catalog template validated' : '; templates/ absent, catalog revisions not checked'));
