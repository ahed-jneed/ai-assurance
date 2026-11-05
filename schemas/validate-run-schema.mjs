/** Repeatable schema checks. Uses the existing Site dependency tree read-only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const defaultPackage = [resolve(workspace, 'site-app/package.json'), resolve(workspace, '../package.json')].find(existsSync);
assert.ok(option('--ajv-package') || defaultPackage, 'Supply --ajv-package pointing to a package with Ajv 2020 and ajv-formats installed.');
const require = createRequire(resolve(option('--ajv-package') ?? defaultPackage));
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');
const ajv = new Ajv2020({ allErrors: true, strict: false, strictNumbers: true });
addFormats(ajv);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const schema = json(resolve(directory, 'test-run.schema.json'));
assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors));
const validate = ajv.compile(schema);
const copy = value => structuredClone(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesDigest = value => createHash('sha256').update(value, 'utf8').digest('hex');
let accepted = 0;
let rejected = 0;

function positive(label, run) {
  assert.equal(validate(run), true, `${label}: ${JSON.stringify(validate.errors)}`);
  accepted++;
}
function negative(label, fixture, mutate) {
  const run = copy(fixture);
  mutate(run);
  assert.equal(validate(run), false, `${label}: malformed run accepted`);
  rejected++;
}

// Equality, checksum recomputation and order are outside portable JSON Schema.
// These fixture assertions mirror the application's frozen-manifest checks;
// they are not a substitute for authorization, custody verification or review.
function hostedBindings(run) {
  const { model, dataset, profile } = run.manifest;
  const hashes = run.provenance.inputHashes;
  if (run.procedureBinding) assert.equal(hashes.auditBinding, digest(run.procedureBinding));
  if (run.retryOf) assert.notEqual(run.retryOf, run.id, 'A retry must create a different immutable run identity');
  assert.equal(model.id, run.modelId);
  assert.equal(dataset.id, run.datasetId);
  assert.equal(model.artifactId, run.datasetId);
  assert.equal(model.task, run.task);
  assert.equal(hashes.dataset, dataset.sha256);
  assert.equal(hashes.modelArtifact, dataset.sha256);
  if (model.sourceSha256) assert.equal(model.sourceSha256, dataset.sha256);
  assert.equal(hashes.modelMetadata, digest(model));
  assert.equal(hashes.manifest, digest(run.manifest));
  assert.equal(hashes.configuration, digest({ modelId: run.modelId, datasetId: run.datasetId, task: run.task, suite: run.suite, config: run.config, seed: run.seed }));
  for (const key of Object.keys(run.config)) assert.deepEqual(run.thresholds[key], run.config[key]);
  assert.equal(run.provenance.policyVersion, run.thresholds.policyVersion);
  if (profile) {
    assert.equal(run.profileId, profile.id);
    assert.equal(hashes.protocol, digest(profile));
    assert.equal(profile.task, run.task);
    assert.deepEqual(profile.suite, run.suite);
    assert.deepEqual(profile.config, run.config);
    assert.equal(run.thresholds.policyId, profile.id);
    assert.equal(run.thresholds.policyVersion, profile.version);
  }
  if (run.startedAt) assert.ok(Date.parse(run.startedAt) >= Date.parse(run.createdAt));
  if (run.completedAt) assert.ok(Date.parse(run.completedAt) >= Date.parse(run.startedAt ?? run.createdAt));
  if (run.state === 'succeeded') {
    assert.deepEqual(run.results.map(result => result.testId).sort(), [...run.suite].sort());
    // Hosted working papers consolidate results by regulatory article.
    assert.equal(run.paperIds.length, new Set(run.results.map(result => result.article)).size);
    const outcomes = run.results.map(result => result.outcome);
    const aggregate = outcomes.includes('fail') ? 'fail' : outcomes.includes('inconclusive') ? 'inconclusive' : outcomes.includes('pass') ? 'pass' : 'not_applicable';
    assert.equal(run.outcome, aggregate);
    for (const result of run.results) for (const metric of result.metrics) assert.ok(metric.sampleSize <= dataset.rowCount);
  }
}

for (const name of ['report.json', 'report-v1.1.1.json']) {
  positive(`Python ${name}`, json(resolve(workspace, 'engine/examples', name)));
}
const fixturePath = resolve(option('--fixtures') ?? resolve(directory, 'fixtures/hosted-runs.v1.1.json'));
assert.ok(existsSync(fixturePath), `Missing hosted fixtures: ${fixturePath}`);
const hosted = json(fixturePath);
assert.ok(Array.isArray(hosted) && hosted.length > 0);
for (const [index, run] of hosted.entries()) {
  positive(`Hosted fixture ${index}: ${run.task}/${run.state}`, run);
  hostedBindings(run);
}

// Keep the previous browser contract readable after the v1.1 migration.
const complete = hosted.find(run => run.state === 'succeeded' && run.task === 'Binary classification');
const queued = hosted.find(run => run.state === 'queued');
const regression = hosted.find(run => run.state === 'succeeded' && run.task === 'Regression');
const multiclass = hosted.find(run => run.state === 'succeeded' && run.task === 'Multiclass classification');
const cardFixture = hosted.find(run => run.manifest.model.card);
assert.ok(complete && queued && regression && multiclass && cardFixture, 'Expected queued, binary, regression, multiclass and full-card fixtures');
const legacy = copy(complete);
legacy.contractVersion = '1.0';
for (const key of ['task', 'profileId', 'manifest']) delete legacy[key];
legacy.provenance = { inputHashes: { dataset: complete.provenance.inputHashes.dataset, modelMetadata: complete.provenance.inputHashes.modelMetadata }, runnerVersion: 'interactive-predictions-1.0', policyVersion: '1.0' };
positive('Legacy interactive completed', legacy);
const oldConfig = copy(legacy);
for (const key of ['minimumSampleSize', 'minimumClassCount', 'maximumOddsGap', 'minimumRecall', 'minimumMacroF1', 'maximumRmse']) {
  delete oldConfig.config[key];
  delete oldConfig.thresholds[key];
}
positive('Legacy interactive original configuration', oldConfig);
for (const state of ['queued', 'running', 'cancelled']) {
  const previous = copy(legacy);
  previous.state = state;
  previous.results = [];
  previous.paperIds = [];
  previous.outcome = state === 'cancelled' ? 'inconclusive' : null;
  previous.overallOutcome = state === 'cancelled' ? 'inconclusive' : undefined;
  if (state !== 'cancelled') previous.completedAt = null;
  positive(`Legacy interactive ${state}`, previous);
}

const running = copy(queued);
running.state = 'running';
running.startedAt = running.createdAt;
positive('Hosted running', running);
const undefinedR2 = copy(regression);
undefinedR2.results[0].metrics.find(metric => metric.name === 'r2').value = null;
undefinedR2.results[0].limitations.push('R² is undefined for this target population.');
positive('Hosted null R² evidence', undefinedR2);
// Test definitions 2.1.0: binary performance freezes its positive class and
// reports specificity, prevalence and the majority-class baseline.
const perClass = copy(complete);
perClass.config.performancePositiveLabel = perClass.config.positiveLabel;
perClass.thresholds.performancePositiveLabel = perClass.config.positiveLabel;
const perClassResult = perClass.results.find(result => result.testId === 'performance');
for (const name of ['specificity', 'prevalence', 'majority_baseline_accuracy']) perClassResult.metrics.push({ name, value: 0.5, unit: 'ratio', sampleSize: perClassResult.metrics[0].sampleSize });
positive('Hosted performance positive class and per-class evidence', perClass);
negative('per-class ratio outside range', perClass, run => { run.results.find(result => result.testId === 'performance').metrics.at(-1).value = 1.5; });
negative('per-class metric on a fairness result', perClass, run => { run.results.find(result => result.testId === 'demographic_parity').metrics.push({ name: 'specificity', value: 0.5, unit: 'ratio', sampleSize: 1 }); });

const mutations = [
  ['unknown contract', complete, run => { run.contractVersion = '2.0'; }],
  ['downgrade frozen hosted manifest', complete, run => { run.contractVersion = '1.0'; }],
  ['unknown top-level field', complete, run => { run.arbitrary = {}; }],
  ['missing manifest', complete, run => { delete run.manifest; }],
  ['unknown manifest field', complete, run => { run.manifest.arbitrary = {}; }],
  ['missing frozen model ID', complete, run => { delete run.manifest.model.id; }],
  ['quarantined model cannot be executed', complete, run => { run.manifest.model.status = 'quarantined'; }],
  ['binary model bytes are not saved predictions', complete, run => { run.manifest.model.format = 'ONNX'; }],
  ['unknown model field', complete, run => { run.manifest.model.arbitrary = {}; }],
  ['invalid dataset digest', complete, run => { run.manifest.dataset.sha256 = 'abc'; }],
  ['duplicate dataset columns', complete, run => { run.manifest.dataset.columns = ['actual', 'actual']; }],
  ['oversized dataset', complete, run => { run.manifest.dataset.size = 1048577; }],
  ['unknown dataset field', complete, run => { run.manifest.dataset.query = 'select *'; }],
  ['missing profile dataset context', queued, run => { delete run.manifest.profile.datasetContext; }],
  ['invalid profile split', queued, run => { run.manifest.profile.datasetContext.split = 'holdout'; }],
  ['missing profile binding ID', queued, run => { delete run.profileId; }],
  ['missing protocol hash', queued, run => { delete run.provenance.inputHashes.protocol; }],
  ['absent profile with protocol binding', queued, run => { run.manifest.profile = null; }],
  ['unknown protocol config', queued, run => { run.manifest.profile.config.arbitrary = {}; }],
  ['missing normalized config key', complete, run => { delete run.config.maximumOddsGap; }],
  ['unknown configuration field', complete, run => { run.config.arbitrary = {}; }],
  ['invalid probability cutoff', complete, run => { run.config.minimumAccuracy = 1.1; }],
  ['zero RMSE acceptance criterion', complete, run => { run.config.maximumRmse = 0; }],
  ['missing policy freeze actor', complete, run => { delete run.thresholds.frozenBy; }],
  ['unknown provenance field', complete, run => { run.provenance.arbitrary = {}; }],
  ['missing manifest digest', complete, run => { delete run.provenance.inputHashes.manifest; }],
  ['unknown hash field', complete, run => { run.provenance.inputHashes.arbitrary = 'a'.repeat(64); }],
  ['wrong runner family', complete, run => { run.provenance.runnerVersion = '1.1.1'; }],
  ['queued run cannot pass', queued, run => { run.outcome = 'pass'; }],
  ['queued run cannot have results', queued, run => { run.results = copy(complete.results); }],
  ['completed run missing timestamp', complete, run => { delete run.completedAt; }],
  ['contradictory completed outcomes', complete, run => { run.overallOutcome = run.outcome === 'pass' ? 'fail' : 'pass'; }],
  ['empty successful evidence', complete, run => { run.results = []; }],
  ['pass result without metrics', complete, run => { run.results[0].outcome = 'pass'; run.results[0].metrics = []; }],
  ['metric ratio outside range', complete, run => { run.results[0].metrics[0].value = 1.5; }],
  ['unknown metric detail shape', complete, run => { run.results[0].metrics[0].details = { arbitrary: 42 }; }],
  ['regression cannot select fairness', regression, run => { run.suite = ['demographic_parity']; }],
  ['multiclass cannot emit binary fairness', multiclass, run => { run.results[0].testId = 'equalized_odds'; }],
  ['inventory-only NLP cannot execute', complete, run => { run.task = 'Classical NLP'; }],
  ['card unknown field', cardFixture, run => { run.manifest.model.card.arbitrary = {}; }],
  ['Hugging Face floating revision', cardFixture, run => { run.manifest.model.card.source.revision = 'main'; }],
  ['Hugging Face path traversal', cardFixture, run => { run.manifest.model.card.source.filename = '../model.onnx'; }],
];
for (const mutation of mutations) negative(...mutation);

// Current importJob retains the exact completed worker envelope separately.
// Its 1.2 projection uses frozen request declarations, one compilation paper,
// and the worker's rich metric evidence. These are synthetic local fixtures;
// signature validity, enrolled origin and native execution are not asserted.
function externalBindings(fixture) {
  const { run, requestJSON, resultJSON } = fixture;
  const request = JSON.parse(requestJSON);
  const packet = JSON.parse(resultJSON);
  const { profile, model, dataset } = run.manifest;
  const hashes = run.provenance.inputHashes;
  assert.equal(run.contractVersion, '1.2');
  assert.equal(run.externalJobId, run.id);
  assert.equal(run.id, request.engineConfig.id);
  assert.equal(run.engagementId, request.engineConfig.engagementId);
  assert.equal(run.modelId, model.id);
  assert.equal(run.datasetId, dataset.id);
  assert.equal(run.profileId, profile.id);
  assert.equal(run.task, model.task);
  assert.equal(run.task, profile.task);
  assert.deepEqual(run.suite, profile.suite);
  assert.deepEqual(run.config, profile.config);
  assert.deepEqual(run.config, request.engineConfig.config);
  assert.equal(run.seed, request.seed);
  assert.equal(run.seed, request.engineConfig.seed);
  assert.equal(run.manifest.executionMode, request.executionMode);
  assert.equal(run.manifest.testDefinitionVersion, packet.provenance.translationVersion);
  assert.equal(run.provenance.runnerVersion, packet.provenance.workerVersion);
  assert.equal(run.provenance.policyVersion, profile.version);
  assert.equal(run.thresholds.policyId, profile.id);
  assert.equal(run.thresholds.policyVersion, profile.version);
  for (const key of Object.keys(run.config)) assert.deepEqual(run.thresholds[key], run.config[key]);
  for (const [key, pin] of Object.entries(request.inputHashes)) assert.equal(hashes[key], pin);
  assert.equal(hashes.dataset, dataset.sha256);
  assert.equal(hashes.protocol, digest(profile));
  assert.equal(hashes.auditBinding, digest(run.procedureBinding));
  assert.equal(hashes.externalRequest, bytesDigest(requestJSON));
  assert.equal(hashes.externalResult, bytesDigest(resultJSON));
  assert.equal(packet.provenance.requestSha256, hashes.externalRequest);
  assert.equal(packet.provenance.inputHashes.dataset, hashes.dataset);
  assert.equal(packet.externalReport.provenance.inputHashes.data, hashes.dataset);
  // Model/source pins are declarations unless the worker actually consumed
  // model bytes; provided/client-local must not assert independent scoring.
  if (request.executionMode !== 'auditor_model') {
    assert.equal(packet.provenance.execution.kind, 'provided_predictions');
    assert.equal(packet.provenance.inputHashes.modelArtifact, undefined);
  } else {
    assert.equal(packet.provenance.execution.kind, 'model_inference');
    assert.equal(packet.provenance.inputHashes.modelArtifact, hashes.modelArtifact);
  }
  assert.deepEqual(run.results, packet.hostedResults);
  assert.deepEqual(run.results.map(result => result.testId).sort(), [...run.suite].sort());
  const sampleCount = Math.max(0, ...run.results.flatMap(result => result.metrics.map(metric => metric.sampleSize)));
  assert.equal(dataset.rowCount, sampleCount, 'Projection sample count is derived, not a population census');
  assert.deepEqual(dataset.columns, [run.config.labelColumn, run.config.predictionColumn]);
  assert.equal(run.paperIds.length, 1, 'External compilation creates one supplementary paper');
  const outcomes = run.results.map(result => result.outcome);
  const aggregate = ['fail', 'inconclusive', 'pass', 'not_applicable'].find(outcome => outcomes.includes(outcome)) ?? 'inconclusive';
  assert.equal(run.outcome, aggregate);
  assert.equal(run.overallOutcome, aggregate);
  assert.ok(Date.parse(run.startedAt) >= Date.parse(run.createdAt));
  assert.ok(Date.parse(run.completedAt) >= Date.parse(run.startedAt));
}

const external = json(resolve(option('--external-fixtures') ?? resolve(directory, 'fixtures/external-runs.v1.2.json')));
if (option('--external-run')) positive('Supplied actual external import projection', json(resolve(option('--external-run'))));
assert.ok(Array.isArray(external) && external.length >= 4, 'Expected real computed binary, multiclass, regression and client-local fixtures');
assert.equal(schema.$id, 'urn:ai-assurance:test-run:1.2', 'Regeneration must preserve the 1.2 discriminator');
for (const fixture of external) {
  positive(`External 1.2 ${fixture.fixture}`, fixture.run);
  positive(`Worker report ${fixture.fixture}`, JSON.parse(fixture.resultJSON).externalReport);
  externalBindings(fixture);
}
const ext = external[0].run;
const rich = ext.results.flatMap(result => result.metrics);
assert.ok(rich.some(metric => metric.confidenceInterval && metric.denominator > 0));
assert.ok(rich.some(metric => metric.slices?.length > 0));
assert.ok(rich.some(metric => metric.threshold?.source === 'internal_policy'));
assert.ok(external.some(fixture => fixture.run.manifest.model.format === 'ONNX' && fixture.run.manifest.executionMode === 'client_local'));
const nativeProjection = copy(ext);
nativeProjection.manifest.executionMode = 'auditor_model';
nativeProjection.manifest.model.format = 'ONNX';
nativeProjection.manifest.model.status = 'quarantined';
positive('External native-mode inventory shape only; no native execution validation', nativeProjection);
const emptyExternal = copy(ext);
emptyExternal.results = emptyExternal.suite.map(testId => ({ testId, label: 'Missing diagnostic evidence', article: testId === 'performance' ? '15' : '10', outcome: 'inconclusive', metrics: [], limitations: ['Synthetic missing-input example.'] }));
emptyExternal.outcome = emptyExternal.overallOutcome = 'inconclusive';
emptyExternal.manifest.dataset.rowCount = 0;
positive('External zero observed metric samples', emptyExternal);
const notApplicableExternal = copy(emptyExternal);
notApplicableExternal.results.forEach(result => { result.outcome = 'not_applicable'; });
notApplicableExternal.outcome = notApplicableExternal.overallOutcome = 'not_applicable';
positive('External all-not-applicable shape', notApplicableExternal);
const externalMutations = [
  ['external missing job ID', run => { delete run.externalJobId; }],
  ['external queued result projection', run => { run.state = 'queued'; }],
  ['external missing binding', run => { delete run.procedureBinding; }],
  ['external missing request hash', run => { delete run.provenance.inputHashes.externalRequest; }],
  ['external corrupted result hash shape', run => { run.provenance.inputHashes.externalResult = 'oops'; }],
  ['external no protocol', run => { run.manifest.profile = null; }],
  ['external saved-prediction hosted mode', run => { run.manifest.executionMode = 'saved_predictions'; }],
  ['external wrong lineage', run => { run.manifest.lineage = 'registered_prediction_artifact'; }],
  ['external wrong regulatory mapping', run => { run.results[0].article = '10'; }],
  ['external passed without metrics', run => { run.results[0].outcome = 'pass'; run.results[0].metrics = []; }],
  ['external inconclusive without reason', run => { run.results[0].outcome = 'inconclusive'; run.results[0].limitations = []; }],
  ['external negative denominator', run => { run.results[0].metrics[0].denominator = -1; }],
  ['external unknown metric attribute', run => { run.results[0].metrics[0].fabricated = true; }],
  ['external oversized dataset', run => { run.manifest.dataset.size = 104857601; }],
  ['external contradictory outcome', run => { run.overallOutcome = run.outcome === 'fail' ? 'pass' : 'fail'; }],
];
for (const [label, mutate] of externalMutations) negative(label, ext, mutate);
for (const [label, mutate] of [
  ['changed exact result bytes', fixture => { fixture.resultJSON += ' '; }],
  ['changed exact request bytes', fixture => { fixture.requestJSON += ' '; }],
  ['changed projected metric', fixture => { fixture.run.results[0].metrics[0].value = .123; }],
  ['changed protocol identity', fixture => { fixture.run.profileId = 'PROTOCOL-other'; }],
  ['changed model pin', fixture => { fixture.run.provenance.inputHashes.modelArtifact = 'b'.repeat(64); }],
  ['changed derived sample count', fixture => { fixture.run.manifest.dataset.rowCount += 1; }],
  ['duplicated selected output', fixture => { fixture.run.results.push(copy(fixture.run.results[0])); }],
  ['all-not-applicable must not pass', fixture => { fixture.run.results.forEach(result => { result.outcome = 'not_applicable'; }); fixture.run.outcome = fixture.run.overallOutcome = 'pass'; }],
]) {
  const fixture = copy(external[0]);
  mutate(fixture);
  assert.throws(() => externalBindings(fixture), undefined, `${label}: binding tamper accepted`);
  rejected++;
}
const engine = json(resolve(workspace, 'engine/examples/report-v1.1.1.json'));
negative('Python runtime missing implementation', engine, run => { delete run.provenance.dependencies.python.implementation; });
negative('Python dependency version is not text', engine, run => { run.provenance.dependencies.packages.numpy = {}; });
negative('Python definition version is malformed', engine, run => { run.provenance.inputs.testDefinitions['PERF-BINARY'] = 'latest'; });
negative('Python unknown configuration option', engine, run => { run.configuration.arbitrary = {}; });
console.log(`PASS: Draft 2020-12 schema selfcheck; ${accepted} valid runs; ${rejected} rejected malformed runs/bindings; ${hosted.length} frozen hosted and ${external.length} exact-byte external fixtures verified.`);
