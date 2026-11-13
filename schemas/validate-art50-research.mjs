/**
 * Checks the Article 50 research data, docs/research/art50-transparency-2026-11.json,
 * which the methodology catalogue (WP-XC-07, WP-XC-10 to WP-XC-12), the rule pack
 * and the classification consume: the file against
 * art50-transparency-research.schema.json, then what portable JSON Schema cannot
 * express (section 14 of the research report, "What the validation also checked"):
 * unique ids, resolving references, reciprocal lists, typed predicates over the
 * declared facts, real calendar dates, the rule-pack and catalogue links, and the
 * statistical criteria against the threshold library (A50-ED-40): each criterion's
 * entry exists, its parameters are in range and give the criterion's band. Run
 * from the repository root:
 *
 *   node schemas/validate-art50-research.mjs [--ajv-package path/to/package.json]
 *
 * It also proves that the checks reject a set of single mutations. Uses Ajv from
 * the Site's dependency tree, like the other validators here. The runtime package
 * ships this file and the schema but no docs/ folder; there it only checks that
 * the schema compiles.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(directory, '..');
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
export const researchPath = 'docs/research/art50-transparency-2026-11.json';

/** Compiles the research schema with Ajv 2020 from site-app/node_modules (or the given package). */
export function loadValidator(schema = readJSON(resolve(directory, 'art50-transparency-research.schema.json')), ajvPackage = resolve(workspace, 'site-app/package.json')) {
  const require = createRequire(resolve(ajvPackage));
  const Ajv2020 = require('ajv/dist/2020').default;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  if (!ajv.validateSchema(schema)) throw new Error('Invalid Art 50 research schema: ' + JSON.stringify(ajv.errors));
  return ajv.compile(schema);
}

/** The research file and what it is checked against: the rule-pack research it builds on, the threshold library and the catalogue. */
export function loadInputs({
  research = resolve(workspace, researchPath),
  library = resolve(workspace, 'schemas/threshold-library.json'),
  catalog = resolve(workspace, 'templates/catalog.json'),
} = {}) {
  const data = readJSON(research);
  const basedOn = typeof data?.basedOn?.file === 'string' ? resolve(workspace, data.basedOn.file) : null;
  return {
    research: data,
    rulePack: basedOn && existsSync(basedOn) ? readJSON(basedOn) : null,
    library: readJSON(library),
    catalog: readJSON(catalog),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = value => {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = values => [...new Set(values)].sort();

/**
 * The band a threshold-library entry gives for the parameter values: a fixed
 * `lower` bound, or a bound derived from a declared value and a tolerance
 * (docs/design/audit-statistics.md section 10).
 */
export function libraryBand(entry, parameters) {
  if ('lower' in parameters) return { lower: parameters.lower };
  if ('upper' in parameters) return { upper: parameters.upper };
  const { declaredValue, tolerance } = parameters;
  if (typeof declaredValue !== 'number' || typeof tolerance !== 'number') return null;
  const value = Math.round((entry.band === 'upper' ? declaredValue + tolerance : declaredValue - tolerance) * 1e9) / 1e9;
  return { [entry.band]: value };
}

/**
 * The criterion metrics a library entry decides: its own metric, and for the
 * disclosure-compliance entry the attribute tests its methodology default
 * (MD-A50-05) names.
 */
const coveredMetrics = {
  disclosure_compliance_rate: [
    'disclosure_compliance_rate',
    'exempt_feature_correct_classification_rate',
    'deep_fake_disclosure_compliance_rate',
    'population_completeness_rate',
    'public_interest_text_compliance_rate',
  ],
};

/** Every problem with the research file; empty when it passes. */
export function checkResearch({ research: r, rulePack, library, catalog, validate = loadValidator() }) {
  const problems = [];
  const fail = message => problems.push(message);
  if (!validate(r)) {
    for (const e of validate.errors ?? []) fail(`schema: ${e.instancePath || '/'} ${e.message}`);
    return problems;
  }

  // Unique ids. An exclusion may recur, identical, in several procedures.
  const ids = new Map();
  const claim = (id, label) => {
    if (ids.has(id)) fail(`duplicate id ${id} (${ids.get(id)} and ${label})`);
    else ids.set(id, label);
  };
  const exclusions = new Map();
  r.sources.forEach(x => claim(x.id, 'source'));
  r.guidance.forEach(x => claim(x.id, 'guidance'));
  r.codeOfPractice.measures.forEach(x => claim(x.id, 'Code measure'));
  r.obligations.forEach(x => claim(x.id, 'obligation'));
  r.timeline.forEach(x => claim(x.id, 'timeline entry'));
  r.evidenceItems.forEach(x => claim(x.id, 'evidence item'));
  r.sampling.methodologyDefaults.forEach(x => claim(x.id, 'methodology default'));
  r.sampling.rules.forEach(x => claim(x.id, 'sampling rule'));
  r.standards.forEach(x => claim(x.id, 'standard'));
  r.consistencyChecks.forEach(x => claim(x.id, 'consistency check'));
  r.repositoryChanges.forEach(x => claim(x.id, 'repository change'));
  r.legalReviewItems.forEach(x => claim(x.id, 'legal-review item'));
  r.unverified.forEach(x => claim(x.id, 'unverified claim'));
  for (const p of r.procedures) {
    claim(p.id, 'procedure');
    p.testSteps.forEach(s => {
      claim(s.id, 'test step');
      if (!s.id.startsWith(p.id + '-S')) fail(`${s.id}: step id is not under ${p.id}`);
    });
    p.criteria.forEach(c => {
      claim(c.id, 'criterion');
      if (!c.id.startsWith(p.id + '-C')) fail(`${c.id}: criterion id is not under ${p.id}`);
    });
    for (const x of p.applicability.exclusions) {
      const seen = exclusions.get(x.id);
      if (seen && !same(seen, x)) fail(`exclusion ${x.id} differs between procedures`);
      exclusions.set(x.id, x);
    }
  }

  // References.
  const has = list => new Set(list.map(x => x.id));
  const sources = has(r.sources),
    evidence = has(r.evidenceItems),
    rules = has(r.sampling.rules),
    measures = has(r.codeOfPractice.measures),
    obligations = has(r.obligations),
    procedures = has(r.procedures),
    reviewItems = new Set([...r.legalReviewItems.map(x => x.id), ...(rulePack?.legalReviewItems ?? []).map(x => x.id)]),
    ruleEntries = new Set([...(rulePack?.applicationDates ?? []), ...(rulePack?.authorityDeadlines ?? [])].map(x => x.id));
  if (!rulePack) fail(`basedOn.file ${r.basedOn.file} is missing`);
  const cited = new Set();
  const cite = (label, list) => {
    for (const id of list ?? []) {
      cited.add(id);
      if (!sources.has(id)) fail(`${label}: unknown source ${id}`);
    }
  };
  const citeRefs = (label, refs) => cite(label, (refs ?? []).map(x => x.sourceId));
  const review = (label, lr) => {
    for (const id of lr?.itemIds ?? []) if (!reviewItems.has(id)) fail(`${label}: unknown legal-review item ${id}`);
  };
  const entry = (label, id) => {
    if (rulePack && !ruleEntries.has(id)) fail(`${label}: unknown rule-pack entry ${id}`);
  };
  for (const id of r.basedOn.entryIds) entry('basedOn', id);
  for (const id of r.basedOn.legalReviewIds ?? []) if (!reviewItems.has(id)) fail(`basedOn: unknown legal-review item ${id}`);
  for (const g of r.guidance) cite(g.id, g.sourceIds);
  cite('codeOfPractice', r.codeOfPractice.sourceIds);
  for (const m of r.codeOfPractice.measures) citeRefs(m.id, m.sourceRefs);
  for (const x of r.codeOfPractice.parameters) citeRefs(`codeOfPractice parameter ${x.id}`, x.sourceRefs);
  for (const o of r.obligations) {
    cite(o.id, o.sourceIds);
    review(o.id, o.legalReview);
    entry(o.id, o.ruleEntryId);
    for (const id of o.procedureIds) if (!procedures.has(id)) fail(`${o.id}: unknown procedure ${id}`);
    for (const id of o.exceptionIds) if (!exclusions.has(id)) fail(`${o.id}: unknown exception ${id}`);
  }
  for (const t of r.timeline) {
    cite(t.id, t.sourceIds);
    for (const id of t.ruleEntryIds ?? []) entry(t.id, id);
  }
  for (const c of r.consistencyChecks) {
    cite(c.id, c.sourceIds);
    for (const id of String(c.rulePackRef).split(/[,;]\s*/).filter(x => /^aia-/.test(x))) entry(c.id, id);
  }
  for (const s of r.standards) cite(s.id, s.sourceIds);
  for (const e of r.repositoryChanges) cite(e.id, e.sourceIds);
  for (const u of r.unverified) cite(u.id, u.sourceIds);
  cite('sampling', r.sampling.sourceIds);
  const facts = r.vocabularies.factVocabulary;
  const predicate = (label, q) => {
    const fact = facts[q.fact];
    if (!fact) return fail(`${label}: undeclared fact ${q.fact}`);
    if (fact.type === 'boolean_or_unknown' && !(q.op === 'eq' && typeof q.value === 'boolean')) fail(`${label}: ${q.fact} takes eq with true or false`);
    if (fact.type === 'date_or_unknown' && !(['before', 'onOrAfter'].includes(q.op) && typeof q.value === 'string' && realDate(q.value))) fail(`${label}: ${q.fact} takes before or onOrAfter with a date`);
  };
  for (const [id, fact] of Object.entries(facts)) {
    cite(`fact ${id}`, fact.sourceIds);
    for (const lr of fact.legalReviewItemIds ?? []) if (!reviewItems.has(lr)) fail(`fact ${id}: unknown legal-review item ${lr}`);
    for (const from of fact.derivation?.anyOf ?? []) if (!facts[from]) fail(`fact ${id}: derived from undeclared fact ${from}`);
  }
  const catalogItems = new Map((catalog?.items ?? []).map(i => [i.id, i]));
  const usedBy = new Map();
  for (const p of r.procedures) {
    cite(p.id, p.sourceIds);
    review(p.id, p.legalReview);
    for (const id of p.obligationIds) {
      if (!obligations.has(id)) fail(`${p.id}: unknown obligation ${id}`);
      else if (!r.obligations.find(o => o.id === id).procedureIds.includes(p.id)) fail(`${p.id}: obligation ${id} does not list the procedure`);
    }
    const a = p.applicability;
    a.appliesIf.forEach(q => predicate(`${p.id} appliesIf`, q));
    entry(`${p.id} timing`, a.timing.ruleEntryId);
    if (!realDate(a.timing.appliesFrom)) fail(`${p.id}: impossible date ${a.timing.appliesFrom}`);
    for (const t of a.timing.transitional) {
      entry(`${p.id} transitional`, t.ruleEntryId);
      t.appliesIf.forEach(q => predicate(`${p.id} transitional`, q));
    }
    for (const x of a.exclusions) {
      x.ifAll.forEach(q => predicate(x.id, q));
      citeRefs(x.id, x.sourceRefs);
      review(x.id, x.legalReview);
    }
    for (const s of p.testSteps) {
      citeRefs(s.id, s.sourceRefs);
      for (const id of s.evidenceItemIds) {
        if (!evidence.has(id)) fail(`${s.id}: unknown evidence item ${id}`);
        usedBy.set(id, [...(usedBy.get(id) ?? []), p.id]);
      }
      if (s.samplingRuleId && !rules.has(s.samplingRuleId)) fail(`${s.id}: unknown sampling rule ${s.samplingRuleId}`);
      for (const id of s.codeMeasureIds) if (!measures.has(id)) fail(`${s.id}: unknown Code measure ${id}`);
      (s.onlyIf ?? []).forEach(q => predicate(s.id, q));
    }
    // The criteria the pass, fail and inconclusive text names are declared.
    const declared = new Set(p.criteria.map(c => c.id));
    for (const text of [...p.passCriteria, ...p.failCriteria, ...p.inconclusiveCriteria])
      for (const [ref] of text.matchAll(/A50-P-[0-9]{2}[A-F]?-C[0-9]{2}/g)) if (!declared.has(ref)) fail(`${p.id}: criteria text names undeclared criterion ${ref}`);
    // The catalogue item the steps go to takes them from this procedure.
    const item = catalogItems.get(p.catalogItemId);
    if (!item) fail(`${p.id}: unknown catalogue item ${p.catalogItemId}`);
    else {
      const rp = item.researchProcedures?.procedures?.find(x => x.procedureId === p.id);
      if (!rp) fail(`${p.id}: catalogue item ${p.catalogItemId} does not list the procedure`);
      else if (!same(rp.criterionIds, p.criteria.map(c => c.id))) fail(`${p.id}: catalogue item ${p.catalogItemId} lists other criteria (${rp.criterionIds.join(', ')})`);
    }
    for (const c of p.criteria) checkCriterion(p.id, c, r, library, fail);
  }
  for (const e of r.evidenceItems) if (!same(sorted(e.usedBy), sorted(usedBy.get(e.id) ?? []))) fail(`${e.id}: usedBy differs from the procedures whose steps use it`);
  for (const s of r.sources) if (!cited.has(s.id)) fail(`source ${s.id} is never cited`);

  // Real calendar dates.
  const dates = [r.researchedOn, ...r.timeline.map(t => t.date), ...r.obligations.map(o => o.appliesFrom), ...r.sources.map(s => s.retrievedOn)];
  for (const g of r.guidance) dates.push(...g.dates.map(x => x.date));
  for (const value of dates) if (typeof value === 'string' && !realDate(value)) fail(`impossible date ${value}`);
  return problems;
}

/** A statistical criterion against the threshold library (A50-ED-40). */
function checkCriterion(procedureId, c, r, library, fail) {
  const label = `${procedureId} ${c.id}`;
  if (c.role === 'descriptive' || c.bandBasis === 'descriptive') {
    if (c.role !== 'descriptive' || c.bandBasis !== 'descriptive') fail(`${label}: a descriptive criterion has role and band basis descriptive`);
    if (c.band !== null || c.libraryEntry !== null) fail(`${label}: a descriptive criterion has no band and no library entry`);
    return;
  }
  if (!c.band || !c.libraryEntry) return fail(`${label}: a deciding criterion needs a band and a threshold-library entry`);
  const ref = c.libraryEntry;
  const entry = library.entries.find(e => e.id === ref.id && e.version === ref.version);
  if (!entry) return fail(`${label}: threshold-library entry ${ref.id}@${ref.version} does not exist`);
  if (entry.legalStatus !== 'no_legal_safe_harbour') fail(`${label}: ${ref.id} is not labelled no_legal_safe_harbour`);
  if (entry.kind !== 'attribute_sampling') fail(`${label}: ${ref.id} is not an attribute-sampling entry`);
  if (entry.caveat !== r.sampling.caveat) fail(`${label}: the caveat of ${ref.id} differs from sampling.caveat`);
  if (!r.sampling.methodologyDefaults.some(d => d.id === entry.research)) fail(`${label}: ${ref.id} names no methodology default of this research`);
  if (!(coveredMetrics[entry.metric] ?? [entry.metric]).includes(c.metric)) fail(`${label}: metric ${c.metric} is not decided by ${ref.id} (${entry.metric})`);
  if (!same(Object.keys(ref.parameters).sort(), Object.keys(entry.parameters).sort())) fail(`${label}: parameters differ from those of ${ref.id}`);
  for (const [name, value] of Object.entries(ref.parameters)) {
    const spec = entry.parameters[name];
    if (spec && (value < spec.minimum || value > spec.maximum)) fail(`${label}: ${name} ${value} is outside ${spec.minimum} to ${spec.maximum}`);
  }
  if (!same(Object.keys(c.band), [entry.band])) fail(`${label}: band bound differs from the ${entry.band} bound of ${ref.id}`);
  const band = libraryBand(entry, ref.parameters);
  if (!same(band, c.band)) fail(`${label}: ${ref.id} with ${JSON.stringify(ref.parameters)} gives ${JSON.stringify(band)}, not ${JSON.stringify(c.band)}`);
}

/** Single mutations the checks must each reject. */
export const mutations = [
  ['unknown schema version', r => { r.schemaVersion = '1.0.0'; }],
  ['free-text library entry', r => { r.procedures.find(p => p.id === 'A50-P-01').criteria[0].libraryEntry = 'policy.eu-aia.art50-disclosure-probe@1 (proposed)'; }],
  ['unknown library entry', r => { r.procedures.find(p => p.id === 'A50-P-01').criteria[0].libraryEntry.id = 'policy.eu-aia.art50-unknown'; }],
  ['unknown library entry version', r => { r.procedures.find(p => p.id === 'A50-P-01').criteria[0].libraryEntry.version = 2; }],
  ['band that differs from the library entry', r => { r.procedures.find(p => p.id === 'A50-P-01').criteria[0].band = { lower: 0.95 }; }],
  ['parameter outside the library range', r => { const c = r.procedures.find(p => p.id === 'A50-P-01').criteria[0]; c.libraryEntry.parameters.lower = 0.9; c.band = { lower: 0.9 }; }],
  ['derived band that differs from the declared tolerance', r => { r.procedures.find(p => p.id === 'A50-P-02C').criteria[0].libraryEntry.parameters.tolerance = 0.03; }],
  ['upper bound on a lower-bound entry', r => { r.procedures.find(p => p.id === 'A50-P-02A').criteria[0].band = { upper: 0.95 }; }],
  ['metric the entry does not decide', r => { r.procedures.find(p => p.id === 'A50-P-02A').criteria[0].metric = 'self_identification_rate'; }],
  ['deciding criterion without a library entry', r => { r.procedures.find(p => p.id === 'A50-P-04B').criteria[0].libraryEntry = null; }],
  ['descriptive criterion with a band', r => { r.procedures.find(p => p.id === 'A50-P-02C').criteria[2].band = { lower: 0.9 }; }],
  ['criterion under another procedure', r => { r.procedures.find(p => p.id === 'A50-P-01').criteria[0].id = 'A50-P-02A-C09'; }],
  ['criteria text naming an undeclared criterion', r => { r.procedures.find(p => p.id === 'A50-P-01').passCriteria.push('A50-P-01-C02 passes.'); }],
  ['duplicate id', r => { r.evidenceItems[1].id = r.evidenceItems[0].id; }],
  ['unknown source id', r => { r.obligations[0].sourceIds.push('SRC-UNKNOWN'); }],
  ['uncited source', r => { r.sources.push({ ...r.sources[0], id: 'SRC-NEVER-CITED' }); }],
  ['unknown evidence item', r => { r.procedures[1].testSteps[0].evidenceItemIds.push('EV-A50-99'); }],
  ['evidence usedBy out of step', r => { r.evidenceItems[0].usedBy.pop(); }],
  ['unknown sampling rule', r => { r.procedures.flatMap(p => p.testSteps).find(s => s.samplingRuleId).samplingRuleId = 'SR-A50-99'; }],
  ['unknown legal-review item', r => { r.procedures[1].legalReview.itemIds.push('LR-A50-99'); }],
  ['undeclared predicate fact', r => { r.procedures.find(p => p.id === 'A50-P-01').applicability.appliesIf[0].fact = 'inventedFact'; }],
  ['predicate value of the wrong type', r => { r.procedures.find(p => p.id === 'A50-P-01').applicability.appliesIf[0].value = 'yes'; }],
  ['unknown rule-pack entry', r => { r.procedures[0].applicability.timing.ruleEntryId = 'aia-2099-01-01-unknown'; }],
  ['unknown catalogue item', r => { r.procedures[0].catalogItemId = 'WP-XC-99'; }],
  ['obligation and procedure lists out of step', r => { r.obligations[0].procedureIds = r.obligations[0].procedureIds.filter(id => id !== 'A50-P-01'); }],
  ['impossible calendar date', r => { r.timeline[0].date = '2026-02-30'; }],
];

function main() {
  const args = process.argv.slice(2);
  const validate = args.includes('--ajv-package') ? loadValidator(undefined, args[args.indexOf('--ajv-package') + 1]) : loadValidator();
  if (!existsSync(resolve(workspace, researchPath))) {
    console.log('PASS Art 50 research schema compiles; docs/ absent (runtime package), research not checked');
    return;
  }
  const inputs = loadInputs();
  const problems = checkResearch({ ...inputs, validate });
  if (problems.length) {
    console.error(`FAIL ${researchPath}: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(' - ' + problem);
    process.exit(1);
  }
  let rejected = 0;
  for (const [label, mutate] of mutations) {
    const research = structuredClone(inputs.research);
    mutate(research);
    if (checkResearch({ ...inputs, research, validate }).length) rejected++;
    else {
      console.error(`FAIL mutation accepted: ${label}`);
      process.exit(1);
    }
  }
  const r = inputs.research;
  const criteria = r.procedures.flatMap(p => p.criteria);
  console.log(
    `PASS ${researchPath} (schema ${r.schemaVersion}): ${r.procedures.length} procedures, ${r.procedures.reduce((n, p) => n + p.testSteps.length, 0)} steps, ` +
      `${criteria.length} statistical criteria (${criteria.filter(c => c.libraryEntry).length} on threshold-library entries), ${r.evidenceItems.length} evidence items, ${r.sources.length} sources; ` +
      `references resolve; ${rejected}/${mutations.length} mutations rejected`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
