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

// RFC 8785 canonical JSON: keys sorted by UTF-16 code units, ECMAScript number text (section 9.2).
const jcs = value => Array.isArray(value) ? '[' + value.map(jcs).join(',') + ']'
  : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}'
  : JSON.stringify(value);
const close = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
function benjaminiHochberg(values) {
  const order = values.map((_, index) => index).sort((a, b) => values[a] - values[b]);
  const adjusted = new Array(values.length).fill(1);
  let running = 1;
  for (let rank = values.length - 1; rank >= 0; rank--) {
    running = Math.min(running, values.length * values[order[rank]] / (rank + 1));
    adjusted[order[rank]] = Math.min(1, running);
  }
  return adjusted;
}

// Statistics 1.0.0 cross-field rules (docs/design/audit-statistics.md section 11.6) shared by engine
// report 1.3 and external run 1.5: plan hash, result ids in plan order, outcome against the decision,
// family adjustments, run aggregation over confirmatory criteria and undecided results, review flags.
function statisticsBindings(run, plan = run.configuration?.statistics, planHash = run.provenance?.statisticsPlanSha256) {
  const decided = run.results.filter(result => result.decision);
  if (plan === null) {
    assert.equal(decided.length, 0);
  } else {
    assert.equal(createHash('sha256').update(jcs(plan), 'utf8').digest('hex'), planHash, 'statistics plan hash');
    assert.deepEqual(decided.map(result => result.testId), plan.criteria.map(criterion => criterion.id), 'results follow the plan order');
    const alpha = 1 - plan.confidenceLevel;
    for (const role of ['confirmatory', 'exploratory']) {
      const family = decided.filter(result => result.decision.role === role);
      const bh = benjaminiHochberg(family.map(result => result.decision.pValue));
      family.forEach((result, index) => {
        const d = result.decision;
        assert.equal(d.familySize, family.length);
        assert.ok(close(d.adjustedPValue, role === 'confirmatory' ? Math.min(1, family.length * d.pValue) : bh[index]), `${result.testId}: family adjustment`);
        const outcome = p => (d.direction === 'pass' || d.direction === 'fail') && p <= alpha + 1e-12 ? d.direction : 'inconclusive';
        assert.equal(result.outcome, outcome(d.adjustedPValue), `${result.testId}: outcome follows the adjusted decision`);
        assert.equal(d.unadjustedOutcome, outcome(d.pValue));
      });
    }
  }
  const counted = run.results.filter(result => !result.decision || result.decision.role === 'confirmatory').map(result => result.outcome);
  const aggregate = ['fail', 'inconclusive', 'pass'].find(outcome => counted.includes(outcome)) ?? 'not_applicable';
  assert.equal(run.outcome, aggregate, 'run outcome aggregates confirmatory criteria and undecided results');
  assert.deepEqual(run.reviewFlags, decided.filter(result => result.decision.role === 'exploratory' && result.outcome === 'fail').map(result => result.testId));
}

// Equality, checksum recomputation and order are outside portable JSON Schema.
// These fixture assertions mirror the application's frozen-manifest checks;
// they are not a substitute for authorization, custody verification or review.
// A pinned dataset card is the stored record: its hash is the SHA-256 of the
// record text, and it describes the evaluated bytes over a forward period.
function cardPinBindings(run) {
  const { cardPin, sha256 } = run.manifest.dataset;
  assert.equal(digest(cardPin.card), cardPin.sha256, 'dataset-card pin hash');
  assert.equal(cardPin.card.artifactSha256, sha256, 'dataset card of other bytes');
  assert.ok(cardPin.card.periodStart <= cardPin.card.periodEnd, 'dataset card period ends before it starts');
}
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
  if (dataset.cardPin) cardPinBindings(run);
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
  if (run.contractVersion === '1.4') {
    // Statistics 1.0.0 (section 11.6): the frozen plan decides; a 1.1 protocol's plan is the run's plan, and
    // its suite is exactly the families of the plan's criteria (section 11.2).
    const plan = run.manifest.statistics;
    assert.equal(createHash('sha256').update(jcs(plan), 'utf8').digest('hex'), hashes.statisticsPlan, 'statistics plan hash');
    if (profile?.schemaVersion === '1.1') {
      assert.deepEqual(profile.statistics, plan);
      const family = { performance: 'performance', multiclass_performance: 'performance', regression_performance: 'regression', selection_rate_difference: 'demographic_parity', selection_rate_ratio: 'disparate_impact', equalized_odds: 'equalized_odds' };
      assert.deepEqual([...new Set(plan.criteria.map(c => family[c.kind === 'group_comparison' ? c.metric : c.kind]))].sort(), [...run.suite].sort());
    } else assert.notEqual(plan.derivedFrom, null, 'a plan without a stored 1.1 protocol is derived');
    if (run.state === 'succeeded') {
      statisticsBindings(run, plan, hashes.statisticsPlan);
      assert.equal(run.paperIds.length, new Set(run.results.map(result => result.article)).size);
      for (const result of run.results) for (const metric of result.metrics) assert.ok(metric.sampleSize <= dataset.rowCount);
    }
    return;
  }
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
// Engine report 1.3 (statistics 1.0.0): decided criteria carry a decision and the shared metric shape.
const engine13 = json(resolve(workspace, 'engine/examples/report-v1.3.json'));
positive('Python report-v1.3.json', engine13);
statisticsBindings(engine13);
const firstDecided = engine13.results.findIndex(result => result.decision);
const firstDescriptive = engine13.results[firstDecided].metrics.findIndex(metric => metric.details.role === 'descriptive');
for (const [label, mutate] of [
  ['1.3 decided result without its decision', run => { delete run.results[firstDecided].decision; }],
  ['1.3 descriptive entry with a p-value', run => { run.results[firstDecided].metrics[firstDescriptive].pValue = 0.01; }],
  ['1.3 descriptive entry with a band', run => { run.results[firstDecided].metrics[firstDescriptive].details.band = { lower: 0.5, upper: null }; }],
  ['1.3 unknown reason code', run => { run.results[firstDecided].decision.reasons.push('point_estimate_passes'); }],
  ['1.3 Holm adjustment', run => { run.results[firstDecided].decision.adjustment = 'holm'; }],
  ['1.3 configuration minimums below the floors', run => { run.configuration.contractVersion = '1.3'; run.configuration.minSampleSize = 20; }],
  ['1.3 plan below the floors', run => { run.configuration.statistics.minimums.sampleSize = 20; }],
  ['1.3 missing plan hash', run => { delete run.provenance.statisticsPlanSha256; }],
  ['1.3 missing review flags', run => { delete run.reviewFlags; }],
  ['1.3 group result under article 15', run => { run.results.find(result => result.decision?.kind === 'group_comparison').article = '15'; }],
]) {
  negative(label, engine13, mutate);
}
// Hosted runs: the frozen 1.1 fixture, the hosted 1.4 fixture (site-app/lib/hosted-runs-fixture.test.ts
// keeps it equal to the runner's output) and, with --fixtures, runs the integration harness just made.
const hosted = json(resolve(directory, 'fixtures/hosted-runs.v1.1.json'));
const hosted14 = json(resolve(directory, 'fixtures/hosted-runs.v1.4.json'));
// Card-pinned runs the integration harness made through the API
// (capture-api-fixtures.mjs), frozen like the 1.1 fixture.
const hostedApi = json(resolve(directory, 'fixtures/hosted-api-runs.v1.4.json'));
const fresh = option('--fixtures') ? json(resolve(option('--fixtures'))) : [];
assert.ok(Array.isArray(hosted) && hosted.length > 0 && Array.isArray(hosted14) && hosted14.length > 0);
assert.ok(hostedApi.some(run => run.state === 'succeeded' && run.manifest.dataset.cardPin), 'Expected an API-produced card-pinned run');
for (const [index, run] of [...hosted, ...hosted14, ...hostedApi, ...fresh].entries()) {
  positive(`Hosted fixture ${index}: ${run.contractVersion} ${run.task}/${run.state}`, run);
  hostedBindings(run);
}
assert.ok(fresh.every(run => run.contractVersion === '1.4'), 'the hosted runner emits run contract 1.4');
const planned14 = hosted14.find(run => run.state === 'succeeded' && run.manifest.profile?.schemaVersion === '1.1' && run.task === 'Binary classification');
const derived14 = hosted14.find(run => run.state === 'succeeded' && run.manifest.statistics.derivedFrom !== null);
assert.ok(planned14 && derived14, 'Expected a 1.4 run from a stored plan and one from a derived plan');
assert.ok(planned14.results.some(result => !planned14.suite.includes(result.testId)), 'an explicit plan names its own criterion ids');
const member14 = planned14.results[0].metrics.findIndex(metric => metric.details.role === 'member');
for (const [label, fixture, mutate] of [
  ['1.4 result without its decision', planned14, run => { delete run.results[0].decision; }],
  ['1.4 result keyed by an invalid id', planned14, run => { run.results[0].testId = 'not an id'; }],
  ['1.4 more than 20 results', planned14, run => { run.results = Array.from({ length: 21 }, () => copy(run.results[0])); }],
  ['1.4 missing plan in the manifest', planned14, run => { delete run.manifest.statistics; }],
  ['1.4 missing plan hash', planned14, run => { delete run.provenance.inputHashes.statisticsPlan; }],
  ['1.4 succeeded without review flags', planned14, run => { delete run.reviewFlags; }],
  ['1.4 plan below the floors', planned14, run => { run.manifest.statistics.minimums.groupSize = 5; }],
  ['1.4 member without an interval method', planned14, run => { run.results[0].metrics[member14].confidenceInterval.method = 'point_estimate'; }],
  ['1.4 not-applicable criterion outcome', planned14, run => { run.results[0].outcome = 'not_applicable'; }],
  ['1.4 group criterion in a multiclass run', hosted14.find(run => run.task === 'Multiclass classification'), run => { run.results[0].decision.kind = 'group_comparison'; run.results[0].article = '10'; }],
  ['1.4 plan profile with legacy thresholds', planned14, run => { run.manifest.profile.config.minimumAccuracy = 0.8; }],
  ['1.4 legacy hosted metric names only', derived14, run => { run.results[0].metrics = [{ name: 'accuracy', value: 0.9, unit: 'ratio', sampleSize: 10 }]; }],
]) negative(label, fixture, mutate);
for (const [label, mutate] of [
  ['1.4 changed plan after freezing', run => { run.manifest.statistics.criteria[0].members[0].band.lower = 0.5; }],
  ['1.4 results out of plan order', run => { run.results.reverse(); }],
  ['1.4 outcome counting an exploratory criterion', run => { run.results.find(r => r.decision.role === 'exploratory').outcome = 'fail'; run.results.find(r => r.decision.role === 'exploratory').decision.direction = 'fail'; }],
]) {
  const run = copy(planned14);
  mutate(run);
  assert.throws(() => hostedBindings(run), undefined, label);
  rejected++;
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
// Contract 1.0 also predates the rule-pack and methodology stamps that fresh
// `--fixtures` runs carry.
for (const key of ['task', 'profileId', 'manifest', 'rulePack', 'methodologyVersion']) delete legacy[key];
// Contract 1.0 predates the performance positive class of test definitions
// 2.1.0, which fresh `--fixtures` runs freeze.
delete legacy.config.performancePositiveLabel;
delete legacy.thresholds.performancePositiveLabel;
legacy.provenance ={ inputHashes: { dataset: complete.provenance.inputHashes.dataset, modelMetadata: complete.provenance.inputHashes.modelMetadata }, runnerVersion: 'interactive-predictions-1.0', policyVersion: '1.0' };
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
// Rule-pack stamp (#18): optional, because older runs lack it, and strict when present.
const stamped = copy(complete);
stamped.rulePack = { version: '2026.11.1', legalVersion: '02024R1689-20260727', researchedAsOf: '2026-11-05', legalReview: 'pending' };
stamped.methodologyVersion = '2026.11.1';
positive('Hosted run with rule-pack stamp', stamped);
negative('rule-pack stamp with unknown field', stamped, run => { run.rulePack.approvedBy = 'counsel'; });
negative('rule-pack stamp without legal-review status', stamped, run => { delete run.rulePack.legalReview; });
negative('malformed methodology version', stamped, run => { run.methodologyVersion = 'latest'; });
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

// queueRun and queueExternal pin the selected dataset governance card into the
// manifest. The card is dataset-card.schema.json's registered card; the server
// checks it against the record and the evaluated bytes.
const cardPin = copy(hostedApi.find(run => run.state === 'succeeded').manifest.dataset.cardPin);
const pinnedHosted = copy(complete);
pinnedHosted.manifest.dataset.cardPin = copy(cardPin);
positive('Hosted run with dataset-card pin', pinnedHosted);
for (const [label, mutate] of [
  ['dataset-card pin malformed hash', run => { run.manifest.dataset.cardPin.sha256 = 'invalid'; }],
  ['dataset-card pin missing record', run => { delete run.manifest.dataset.cardPin.recordId; }],
  ['dataset-card pin missing card', run => { delete run.manifest.dataset.cardPin.card; }],
  ['dataset-card pin unknown field', run => { run.manifest.dataset.cardPin.arbitrary = true; }],
  ['dataset-card pin with an empty card', run => { run.manifest.dataset.cardPin.card = {}; }],
  ['dataset-card pin without the described bytes', run => { delete run.manifest.dataset.cardPin.card.artifactSha256; }],
  ['dataset-card pin unknown card field', run => { run.manifest.dataset.cardPin.card.arbitrary = true; }],
  ['dataset-card pin impossible period date', run => { run.manifest.dataset.cardPin.card.periodEnd = '2026-02-30'; }],
]) negative(label, pinnedHosted, mutate);
const pinnedApi = hostedApi.find(run => run.state === 'succeeded');
for (const [label, mutate] of [
  ['card changed after pinning', run => { run.manifest.dataset.cardPin.card.population = 'Another population'; }],
  ['card of other bytes', run => { run.manifest.dataset.cardPin.card.artifactSha256 = 'e'.repeat(64); run.manifest.dataset.cardPin.sha256 = digest(run.manifest.dataset.cardPin.card); }],
]) {
  const run = copy(pinnedApi);
  mutate(run);
  assert.throws(() => cardPinBindings(run), undefined, `${label}: card-pin tamper accepted`);
  rejected++;
}

// Current importJob retains the exact completed worker envelope separately.
// Its 1.2 projection uses frozen request declarations, one compilation paper,
// and the worker's rich metric evidence. These are synthetic local fixtures;
// signature validity, enrolled origin and native execution are not asserted.
function externalBindings(fixture, version = '1.2') {
  const { run, requestJSON, resultJSON } = fixture;
  const request = JSON.parse(requestJSON);
  const packet = JSON.parse(resultJSON);
  const { profile, model, dataset } = run.manifest;
  const hashes = run.provenance.inputHashes;
  assert.equal(run.contractVersion, version);
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
  const sampleCount = Math.max(0, ...run.results.flatMap(result => result.metrics.map(metric => metric.sampleSize)));
  assert.equal(dataset.rowCount, sampleCount, 'Projection sample count is derived, not a population census');
  assert.deepEqual(dataset.columns, [run.config.labelColumn, run.config.predictionColumn]);
  assert.equal(run.paperIds.length, 1, 'External compilation creates one supplementary paper');
  if (version === '1.5') {
    // Statistics 1.0.0: the result-id rule replaces the suite check; the worker copied the engine's plan
    // and decisions, and the run aggregates confirmatory criteria only (sections 4.6 and 11.6).
    const plan = run.manifest.statistics;
    assert.deepEqual(plan, packet.externalReport.configuration.statistics);
    assert.equal(packet.externalReport.contractVersion, '1.3');
    const families = { selection_rate_difference: 'demographic_parity', selection_rate_ratio: 'disparate_impact', equalized_odds: 'equalized_odds' };
    const suite = new Set(plan.criteria.map(c => c.kind === 'group_comparison' ? families[c.metric] : c.kind === 'regression_performance' ? 'regression' : 'performance'));
    assert.deepEqual([...suite].sort(), [...run.suite].sort(), 'suite equals the families of the plan criteria');
    const engineResults = Object.fromEntries(packet.externalReport.results.filter(result => result.decision).map(result => [result.testId, result]));
    for (const result of run.results) {
      assert.deepEqual(result.decision, engineResults[result.testId].decision, 'decisions are copied, never re-decided');
      assert.equal(result.outcome, engineResults[result.testId].outcome);
    }
    statisticsBindings(run, plan, hashes.statisticsPlan);
    return;
  }
  assert.deepEqual(run.results.map(result => result.testId).sort(), [...run.suite].sort());
  const outcomes = run.results.map(result => result.outcome);
  const aggregate = ['fail', 'inconclusive', 'pass', 'not_applicable'].find(outcome => outcomes.includes(outcome)) ?? 'inconclusive';
  assert.equal(run.outcome, aggregate);
  assert.equal(run.overallOutcome, aggregate);
  assert.ok(Date.parse(run.startedAt) >= Date.parse(run.createdAt));
  assert.ok(Date.parse(run.completedAt) >= Date.parse(run.startedAt));
}

// Compiled external audit run 1.5 (statistics 1.0.0) from actual worker computations.
const external15 = json(resolve(option('--external-fixtures-1.5') ?? resolve(directory, 'fixtures/external-runs.v1.5.json')));
assert.ok(Array.isArray(external15) && external15.length >= 5, 'Expected binary, multiclass, regression, client-local and explicit-plan 1.5 fixtures');
for (const fixture of external15) {
  positive(`External 1.5 ${fixture.fixture}`, fixture.run);
  positive(`Worker report 1.3 ${fixture.fixture}`, JSON.parse(fixture.resultJSON).externalReport);
  externalBindings(fixture, '1.5');
}
const explicit15 = external15.find(fixture => fixture.run.manifest.statistics.derivedFrom === null);
assert.ok(explicit15 && explicit15.run.results.some(result => !explicit15.run.suite.includes(result.testId)), 'An explicit plan uses ids that differ from the suite names');
const ext15 = external15[0].run;
for (const [label, mutate] of [
  ['1.5 result without decision', run => { delete run.results[0].decision; }],
  ['1.5 missing plan', run => { delete run.manifest.statistics; }],
  ['1.5 missing plan hash', run => { delete run.provenance.inputHashes.statisticsPlan; }],
  ['1.5 missing review flags', run => { delete run.reviewFlags; }],
  ['1.5 group criterion under article 15', run => { run.results.find(result => result.decision.kind === 'group_comparison').article = '15'; }],
  ['1.5 regression criterion in a binary run', run => { run.results[0].decision.kind = 'regression_performance'; }],
  ['1.5 more than 20 criteria', run => { run.results = Array.from({ length: 21 }, () => copy(run.results[0])); }],
]) {
  negative(label, ext15, mutate);
}
for (const [label, mutate] of [
  ['1.5 re-decided outcome', fixture => { fixture.run.results[0].outcome = fixture.run.results[0].outcome === 'pass' ? 'fail' : 'pass'; }],
  ['1.5 changed plan hash', fixture => { fixture.run.provenance.inputHashes.statisticsPlan = 'c'.repeat(64); }],
  ['1.5 reordered criteria', fixture => { fixture.run.results.reverse(); }],
  ['1.5 exploratory flag invented', fixture => { fixture.run.reviewFlags = ['performance']; }],
]) {
  const fixture = copy(external15[0]);
  mutate(fixture);
  assert.throws(() => externalBindings(fixture, '1.5'), undefined, `${label}: binding tamper accepted`);
  rejected++;
}

const external = json(resolve(option('--external-fixtures') ?? resolve(directory, 'fixtures/external-runs.v1.2.json')));
assert.ok(Array.isArray(external) && external.length >= 4, 'Expected real computed binary, multiclass, regression and client-local fixtures');
assert.equal(schema.$id, 'urn:ai-assurance:test-run:2.0', 'Regeneration must preserve the schema identifier');
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
positive('External run with rule-pack stamp', { ...copy(ext), rulePack: copy(stamped.rulePack), methodologyVersion: stamped.methodologyVersion });
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
  // Results with a copied decision compile into 1.5 (#22 H4); the frozen 1.2 result has none.
  ['external 1.2 result with a copied decision', run => { run.results[0].decision = copy(engine13.results[firstDecided].decision); }],
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
const pinnedExternal = copy(ext);
pinnedExternal.manifest.dataset.cardPin = copy(cardPin);
positive('External run with dataset-card pin', pinnedExternal);
negative('external dataset-card pin malformed hash', pinnedExternal, run => { run.manifest.dataset.cardPin.sha256 = 'invalid'; });
// A fresh platform projection, e.g. the assurance harness's
// tmp/assurance-worker-fixture/hosted-external-run.json and its run contract
// 1.5 sibling. --external-run may be given more than once.
for (const [position, flag] of args.entries()) {
  if (flag !== '--external-run') continue;
  const current = json(resolve(args[position + 1]));
  positive(`Supplied external import projection (contract ${current.contractVersion})`, current);
  if (current.manifest?.dataset?.cardPin) {
    negative('Supplied projection malformed dataset-card hash', current, run => { run.manifest.dataset.cardPin.sha256 = 'invalid'; });
    negative('Supplied projection missing dataset-card identity', current, run => { delete run.manifest.dataset.cardPin.recordId; });
  }
}
const engine = json(resolve(workspace, 'engine/examples/report-v1.1.1.json'));
negative('Python runtime missing implementation', engine, run => { delete run.provenance.dependencies.python.implementation; });
negative('Python dependency version is not text', engine, run => { run.provenance.dependencies.packages.numpy = {}; });
negative('Python definition version is malformed', engine, run => { run.provenance.inputs.testDefinitions['PERF-BINARY'] = 'latest'; });
negative('Python unknown configuration option', engine, run => { run.configuration.arbitrary = {}; });
console.log(`PASS: Draft 2020-12 schema selfcheck; ${accepted} valid runs; ${rejected} rejected malformed runs/bindings; ${hosted.length} frozen hosted, ${hostedApi.length} card-pinned API, ${external.length} exact-byte external 1.2 and ${external15.length} external 1.5 fixtures verified.`);
