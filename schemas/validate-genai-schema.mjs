// Validates the GenAI evidence contracts with Ajv 2020 in strict mode: schemas/genai-evidence-item.schema.json
// (per-item records and run metadata) and schemas/genai-result.schema.json (the genai-result/0.1 envelope,
// its computation, and the genai-plan/0.1 and genai-bundle/0.1 input contracts).
//
// Without arguments it checks the committed reference records (engine/tests/fixtures/genai/normalized-items.jsonl
// and normalized-examples.json) and the committed example envelope (schemas/fixtures/genai-result.example.json):
// both hashes of the envelope are recomputed over the exact strings, the computation and every item line are
// validated, and tampered or malformed copies are rejected. `node schemas/validate-genai-schema.mjs <envelope.json>`
// validates another envelope the same way. `--ajv-package` points at an alternative package.json.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const args = process.argv.slice(2);
const packageIndex = args.indexOf('--ajv-package');
const require = createRequire(
  packageIndex < 0 ? new URL('../site-app/package.json', import.meta.url) : resolve(args[packageIndex + 1]),
);
const Ajv = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');

const read = (url) => JSON.parse(readFileSync(url, 'utf8'));
const itemSchema = read(new URL('./genai-evidence-item.schema.json', import.meta.url));
const resultSchema = read(new URL('./genai-result.schema.json', import.meta.url));
const ajv = new Ajv({allErrors: true, strict: true, strictTypes: false, allowUnionTypes: true});
addFormats(ajv);
ajv.addSchema(itemSchema);
ajv.addSchema(resultSchema);
assert(ajv.validateSchema(itemSchema), JSON.stringify(ajv.errors));
assert(ajv.validateSchema(resultSchema), JSON.stringify(ajv.errors));

const validateItem = ajv.getSchema(itemSchema.$id);
const validateEnvelope = ajv.getSchema(resultSchema.$id);
const validateComputation = ajv.compile({$ref: `${resultSchema.$id}#/$defs/computation`});
const validateMetadata = ajv.compile({$ref: `${itemSchema.$id}#/$defs/runMetadata`});
const validatePlan = ajv.compile({$ref: `${resultSchema.$id}#/$defs/plan`});
const validateManifest = ajv.compile({$ref: `${resultSchema.$id}#/$defs/manifest`});
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function check(validate, value, label) {
  assert(validate(value), `${label}: ${JSON.stringify(validate.errors, null, 1)}`);
}

function checkEnvelope(envelope, label) {
  check(validateEnvelope, envelope, label);
  assert.equal(sha256(envelope.computationJSON), envelope.computationSha256, `${label}: computationSha256`);
  const computation = JSON.parse(envelope.computationJSON);
  check(validateComputation, computation, `${label} computation`);
  if (envelope.itemsJSONL !== null) {
    assert.equal(sha256(envelope.itemsJSONL), envelope.itemsSha256, `${label}: itemsSha256`);
    assert(envelope.itemsJSONL.endsWith('\n'), `${label}: itemsJSONL ends with a line feed`);
    const lines = envelope.itemsJSONL.slice(0, -1).split('\n');
    const keys = lines.map((line) => JSON.parse(line).itemKey);
    assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), `${label}: items sorted by itemKey`);
    assert.equal(new Set(keys).size, keys.length, `${label}: unique itemKey`);
    assert.equal(lines.length, computation.runs.reduce((sum, run) => sum + run.items.count, 0), `${label}: item count`);
    lines.forEach((line, index) => check(validateItem, JSON.parse(line), `${label} item ${index + 1}`));
  }
  const inputs = computation.inputs.map((input) => input.sha256);
  assert.deepEqual(Object.values(envelope.provenance.inputHashes), inputs, `${label}: provenance.inputHashes`);
  return computation;
}

const given = args.find((value, index) => (packageIndex < 0 || (index !== packageIndex && index !== packageIndex + 1)) && !value.startsWith('--'));
if (given) {
  checkEnvelope(read(resolve(given)), given);
  console.log(`PASS genai-result/0.1 envelope ${given}: hashes, computation and item records`);
  process.exit(0);
}

// 1. The design-time reference records and run metadata (absent from the extracted runtime package,
// which ships no engine tests; the example envelope below still carries item records).
const fixtures = new URL('../engine/tests/fixtures/genai/', import.meta.url);
const exampleEnvelope = read(new URL('./fixtures/genai-result.example.json', import.meta.url));
const haveFixtures = existsSync(new URL('normalized-items.jsonl', fixtures));
const referenceLines = haveFixtures
  ? readFileSync(new URL('normalized-items.jsonl', fixtures), 'utf8').split('\n').filter(Boolean)
  : exampleEnvelope.itemsJSONL.split('\n').filter(Boolean);
referenceLines.forEach((line, index) => check(validateItem, JSON.parse(line), `reference item ${index + 1}`));
let runs = 0;
if (haveFixtures) {
  const examples = read(new URL('normalized-examples.json', fixtures));
  for (const bundle of Object.values(examples.bundles)) {
    for (const run of bundle.runs) {
      check(validateMetadata, run.runMetadata, run.runKey);
      check(validateItem, run.firstItem, run.runKey);
      runs += 1;
    }
  }
}

// 2. The committed example envelope (the #33 acceptance scenario: judged_qa_30 with the validated judge).
const example = exampleEnvelope;
const computation = checkEnvelope(example, 'genai-result.example.json');
assert.equal(computation.criteria[0].outcome, 'pass');
assert.equal(computation.judgeValidation[0].bindings[0].validated, true);
check(validatePlan, computation.plan.normalized, 'normalized plan');

// 3. Tampering and malformed records are rejected.
const tampered = {...example, computationJSON: example.computationJSON.replace('"L2"', '"L1"')};
assert.throws(() => checkEnvelope(tampered, 'tampered'), /computationSha256/);
const tamperedItems = {...example, itemsJSONL: example.itemsJSONL.replace('"scored"', '"error"')};
assert.throws(() => checkEnvelope(tamperedItems, 'tampered items'), /itemsSha256/);
const envelopeMutations = [
  (v) => { v.schemaVersion = 'genai-result/0.2'; },
  (v) => { v.computationSha256 = 'A'.repeat(64); },
  (v) => { v.provenance.executionMode = 'auditor_model'; },
  (v) => { v.provenance.channel = 'email'; },
  (v) => { v.extra = true; },
];
for (const mutate of envelopeMutations) {
  const value = structuredClone(example);
  mutate(value);
  assert.equal(validateEnvelope(value), false, `Malformed envelope accepted: ${mutate}`);
}
const item = JSON.parse(referenceLines[0]);
const itemMutations = [
  (v) => { v.itemKey = 'bad key'; },
  (v) => { v.status = 'passed'; },
  (v) => { v.outcome.value = 1.5; },
  (v) => { v.scores[0].scorer.kind = 'trusted'; },
  (v) => { v.labels.nested = {a: 1}; },
  (v) => { v.promptSha256 = 'abc'; },
  (v) => { v.rawPrompt = 'text'; },
];
for (const mutate of itemMutations) {
  const value = structuredClone(item);
  mutate(value);
  assert.equal(validateItem(value), false, `Malformed item accepted: ${mutate}`);
}
const manifest = {
  schemaVersion: 'genai-bundle/0.1',
  origin: 'auditee_supplied',
  inputs: [{name: 'judged_qa_30.eval', sha256: 'a'.repeat(64), bytes: 1, format: 'inspect_eval', role: 'log'}],
  declared: {systemUnderTest: {family: 'other-fixture-sut'}, judges: [{ref: 'J1', model: 'mockllm/judge', family: 'anthropic'}]},
};
check(validateManifest, manifest, 'manifest');
for (const mutate of [
  (v) => { v.declared.systemUnderTest.family = 'meta-llama'; },
  (v) => { v.declared.systemUnderTest.family = 'other-openai'; },
  (v) => { v.origin = 'vendor'; },
  (v) => { v.inputs[0].format = 'csv'; },
  (v) => { v.inputs[0].runKey = 'bad|key'; },
]) {
  const value = structuredClone(manifest);
  mutate(value);
  assert.equal(validateManifest(value), false, `Malformed manifest accepted: ${mutate}`);
}
const plan = {schemaVersion: 'genai-plan/0.1', criteria: [{id: 'acc', kind: 'genai_mean', metric: 'accuracy', band: {lower: 0.7}}]};
check(validatePlan, plan, 'plan');
for (const mutate of [
  (v) => { v.minimums = {sampleSize: 10}; },
  (v) => { v.judgeValidation = {minimumKappaLowerBound: 0.5}; },
  (v) => { v.judgeValidation = {requireDifferentFamily: false}; },
  (v) => { v.excerpts = 'all'; },
  (v) => { v.criteria[0].kind = 'genai_vibes'; },
]) {
  const value = structuredClone(plan);
  mutate(value);
  assert.equal(validatePlan(value), false, `Malformed plan accepted: ${mutate}`);
}

console.log(
  `PASS GenAI evidence contracts: ${referenceLines.length} ${haveFixtures ? 'reference records' : 'example-envelope records (no engine test fixtures here)'}, ${runs} run-metadata blocks, the example envelope (hashes, computation, items) and malformed or tampered rejection`,
);
