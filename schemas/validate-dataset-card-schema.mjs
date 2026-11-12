/** Dataset governance card contract checks: the schema, the card the API pinned to a run, and rejected malformed cards. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(directory, '..');
const args = process.argv.slice(2);
const option = name => {
  const position = args.indexOf(name);
  return position < 0 ? undefined : args[position + 1];
};
const ajvPackage = option('--ajv-package') ?? [resolve(workspace, 'site-app/package.json'), resolve(workspace, '../package.json')].find(existsSync);
assert.ok(ajvPackage, 'Supply --ajv-package pointing to a package with Ajv 2020 and ajv-formats installed.');
const require = createRequire(resolve(ajvPackage));
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const schema = json(resolve(directory, 'dataset-card.schema.json'));
assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors));
const validate = ajv.compile(schema);
let accepted = 0;
let rejected = 0;
// What JSON Schema cannot say: the period runs forwards.
const ordered = card => card.periodStart <= card.periodEnd;
function positive(label, card) {
  assert.equal(validate(card), true, `${label}: ${JSON.stringify(validate.errors)}`);
  assert.ok(ordered(card), `${label}: period ends before it starts`);
  accepted++;
}
function negative(label, card, mutate) {
  const changed = structuredClone(card);
  mutate(changed);
  assert.equal(validate(changed) && ordered(changed), false, `${label}: malformed card accepted`);
  rejected++;
}

// The card the records API pinned to a hosted run (fixtures/hosted-api-runs.v1.4.json).
const pinned = json(resolve(directory, 'fixtures/hosted-api-runs.v1.4.json'))
  .map(run => run.manifest?.dataset?.cardPin?.card)
  .filter(Boolean);
assert.ok(pinned.length > 0, 'Expected an API-produced card-pinned run');
pinned.forEach((card, index) => positive(`API-pinned card ${index}`, card));
const card = pinned[0];
const { baselineRationale, ...beforeBaselines } = card;
positive('Card stored before regression baselines', beforeBaselines);
positive('Card with a regression baseline', { ...card, baselineDatasetRecordId: 'AS-baseline', baselineRationale: baselineRationale || 'Prior production quarter', baselinePin: { recordId: 'AS-baseline', sha256: 'b'.repeat(64), artifactSha256: 'c'.repeat(64) } });
for (const [label, mutate] of [
  ['unknown field', c => { c.arbitrary = true; }],
  ['unknown version', c => { c.schemaVersion = '2.0'; }],
  ['missing owner', c => { delete c.owner; }],
  ['blank name', c => { c.name = ' '; }],
  ['untrimmed name', c => { c.name = ` ${c.name}`; }],
  ['name over 300 characters', c => { c.name = 'n'.repeat(301); }],
  ['unknown split', c => { c.split = 'holdout'; }],
  ['impossible date', c => { c.periodEnd = '2026-02-30'; }],
  ['date with a time', c => { c.periodStart = '2026-01-01T00:00:00Z'; }],
  ['period ending before it starts', c => { c.periodStart = '2027-01-01'; c.periodEnd = '2026-01-01'; }],
  ['baseline without its rationale', c => { c.baselineDatasetRecordId = 'AS-baseline'; c.baselineRationale = ''; }],
  ['malformed artifact hash', c => { c.artifactSha256 = 'A'.repeat(64); }],
  ['missing artifact hash', c => { delete c.artifactSha256; }],
  ['fractional artifact size', c => { c.artifactSize = 1.5; }],
  ['baseline pin unknown field', c => { c.baselinePin = { recordId: 'AS-baseline', sha256: 'b'.repeat(64), artifactSha256: 'c'.repeat(64), arbitrary: true }; }],
]) negative(label, card, mutate);
// Further cards to check, for example the card bodies of a fresh harness run.
const supplied = option('--cards') ? json(resolve(option('--cards'))) : [];
supplied.forEach((c, index) => positive(`Supplied card ${index}`, c));
console.log(`PASS dataset-card contract: ${accepted} valid cards; ${rejected} rejected malformed cards`);
