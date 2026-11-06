/**
 * Checks the canonical rule pack: the regulatorySnapshot of templates/catalog.json
 * against rule-pack.schema.json, then what portable JSON Schema cannot express:
 * unique ids, source / legal-review / cross-reference resolution, real calendar
 * dates, typed predicates over the declared facts, the approval and legal-review
 * rules (D-02), secondary-only sourcing, and agreement with the verified research
 * file the pack names. Run from the repository root:
 *
 *   node schemas/validate-rule-pack.mjs [--ajv-package path/to/package.json]
 *
 * It also proves that the checks reject a set of single mutations. Uses Ajv from
 * the existing Site dependency tree, like the other validators here. The runtime
 * package ships this file and the schema but no templates/ folder; there it only
 * checks that the schema compiles.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(directory, '..');
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));

/** Compiles the rule-pack schema with Ajv 2020 from site-app/node_modules (or the given package). */
export function loadValidator(schema = readJSON(resolve(directory, 'rule-pack.schema.json')), ajvPackage = resolve(workspace, 'site-app/package.json')) {
  const require = createRequire(resolve(ajvPackage));
  const Ajv2020 = require('ajv/dist/2020').default;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  if (!ajv.validateSchema(schema)) throw new Error('Invalid rule-pack schema: ' + JSON.stringify(ajv.errors));
  return ajv.compile(schema);
}

/** The canonical files by default; pass paths to check the copies the Site imports. */
export function loadInputs({
  catalog = resolve(workspace, 'templates/catalog.json'),
  obligations = resolve(workspace, 'docs/obligation-subitems.json'),
  annexMap = resolve(workspace, 'templates/annex-iv-map.json'),
} = {}) {
  const pack = readJSON(catalog);
  const { data, report, revisions = [] } = pack.regulatorySnapshot?.research ?? {};
  const present = file => typeof file === 'string' && existsSync(resolve(workspace, file));
  return {
    catalog: pack,
    obligations: readJSON(obligations),
    annexMap: readJSON(annexMap),
    research: present(data) ? readJSON(resolve(workspace, data)) : null,
    researchReportExists: present(report),
    // The research files of later revisions, by the path the pack names.
    revisionResearch: Object.fromEntries(
      revisions.filter(r => present(r?.data)).map(r => [r.data, { data: readJSON(resolve(workspace, r.data)), reportExists: present(r.report) }]),
    ),
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
/**
 * Research summaries that point at a research data key ("See
 * specialCategoryData") and the sentence the rule pack shows instead, pointing
 * at content the product renders under the same entry. Nothing else may differ.
 */
const summaryPointers = {
  'aia-2025-02-02-prohibitions': ['See prohibitedPractices.', 'The eight practices are listed under this entry.'],
  'aia-2026-07-27-art4a-bias-data': ['See specialCategoryData for the exact conditions.', 'The Art 4a(1) and (2) conditions are listed under this entry.'],
};
const versionKey = v => v.split('.').map(n => n.padStart(6, '0')).join('.');

/** Visits every object in a JSON value with its JSON pointer. */
function walk(value, visit, path = '') {
  if (Array.isArray(value)) value.forEach((item, i) => walk(item, visit, path + '/' + i));
  else if (value && typeof value === 'object') {
    visit(value, path);
    for (const [key, item] of Object.entries(value)) walk(item, visit, path + '/' + key);
  }
}
function strings(value, visit, path = '') {
  if (typeof value === 'string') visit(value, path);
  else if (Array.isArray(value)) value.forEach((item, i) => strings(item, visit, path + '/' + i));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) strings(item, visit, path + '/' + key);
}

/**
 * Returns the problems found, an empty array when the rule pack is sound.
 * `research` is the verified research JSON the pack names (research.data).
 */
export function checkRulePack({ catalog, obligations, annexMap, research = null, researchReportExists = true, revisionResearch = {}, validate = loadValidator() }) {
  const problems = [];
  const fail = message => problems.push(message);
  const pack = catalog?.regulatorySnapshot;
  if (!pack || typeof pack !== 'object') return ['catalog has no regulatorySnapshot'];
  if (!validate(pack)) for (const e of validate.errors ?? []) fail(`schema ${e.instancePath || '/'} ${e.message}${e.params?.allowedValue !== undefined ? ' ' + JSON.stringify(e.params.allowedValue) : ''}`);
  const list = key => (Array.isArray(pack[key]) ? pack[key] : []);

  // Versions and dates shared with the other methodology files.
  if (catalog.methodologyVersion !== pack.rulePackVersion) fail(`methodologyVersion ${catalog.methodologyVersion} differs from rulePackVersion ${pack.rulePackVersion}`);
  if (obligations?.rulePackVersion !== pack.rulePackVersion) fail('docs/obligation-subitems.json rulePackVersion differs from the rule pack');
  if (obligations?.source?.researchedAsOf !== pack.researchedAsOf) fail('docs/obligation-subitems.json source.researchedAsOf differs from the rule pack');
  if (obligations?.source?.version !== pack.celex) fail('docs/obligation-subitems.json source.version differs from the rule pack celex');
  if (annexMap?.source?.researchedAsOf !== pack.researchedAsOf || annexMap?.source?.rulePackVersion !== pack.rulePackVersion) fail('templates/annex-iv-map.json source differs from the rule pack research date or version');
  if (annexMap?.source?.celex !== pack.celex) fail('templates/annex-iv-map.json source.celex differs from the rule pack');
  if (pack.consolidatedVersion?.celex !== pack.celex || pack.consolidatedVersion?.consolidatedAsOf !== pack.consolidatedAsOf) fail('consolidatedVersion differs from celex / consolidatedAsOf');
  if (pack.amendingActs?.[0]?.number !== pack.amendingRegulation) fail('amendingRegulation differs from the first amending act');
  if (!researchReportExists) fail(`research report ${pack.research?.report} does not exist`);

  // Unique ids.
  const ids = new Map();
  const register = (id, where) => {
    if (typeof id !== 'string') return;
    if (ids.has(id)) fail(`duplicate id ${id} (${ids.get(id)} and ${where})`);
    else ids.set(id, where);
  };
  for (const key of ['applicationDates', 'authorityDeadlines', 'standards', 'guidanceDocuments', 'legalReviewItems', 'unverified', 'sources'])
    for (const item of list(key)) register(item.id, key);
  const points = new Set();
  for (const p of list('prohibitedPractices')) {
    if (points.has(p.point)) fail(`duplicate prohibited practice ${p.point}`);
    points.add(p.point);
  }
  const titles = new Set();
  for (const e of list('applicationDates')) {
    if (titles.has(e.title)) fail(`duplicate application-date title "${e.title}"`);
    titles.add(e.title);
  }
  const entries = new Map(list('applicationDates').map(e => [e.id, e]));
  const deadlines = new Map(list('authorityDeadlines').map(d => [d.id, d]));
  const reviewItems = new Map(list('legalReviewItems').map(i => [i.id, i]));
  const sources = new Map(list('sources').map(s => [s.id, s]));

  // Calendar dates, everywhere a date-shaped string appears.
  strings(pack, (value, path) => {
    if (DATE.test(value) && !realDate(value)) fail(`${path}: ${value} is not a calendar date`);
    const stamp = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
    if (stamp && !realDate(stamp[1])) fail(`${path}: ${value} is not a calendar date`);
  });

  // Sources: every reference resolves, every source is cited, and a secondary
  // source only backs content marked secondary_only.
  const cited = new Set();
  walk(pack, (node, path) => {
    if (path.startsWith('/sources/')) return;
    if (!Array.isArray(node.sourceIds)) return;
    for (const id of node.sourceIds) {
      cited.add(id);
      if (!sources.has(id)) fail(`${path}: unknown source ${id}`);
      else if (sources.get(id).kind === 'secondary' && node.status !== 'secondary_only') fail(`${path}: secondary source ${id} backs content not marked secondary_only`);
    }
  });
  for (const id of sources.keys()) if (!cited.has(id)) fail(`source ${id} is never cited`);

  // Legal-review flags and approvals (D-02).
  const flagged = new Set();
  const flags = (owner, review) => {
    for (const id of review?.itemIds ?? []) {
      flagged.add(id);
      if (!reviewItems.has(id)) fail(`${owner}: unknown legal-review item ${id}`);
    }
  };
  const pendingItems = review => (review?.itemIds ?? []).filter(id => reviewItems.get(id)?.status !== 'resolved');
  for (const e of entries.values()) {
    flags(e.id, e.legalReview);
    if (e.approval?.status === 'approved' && pendingItems(e.legalReview).length) fail(`${e.id}: approved while legal review ${pendingItems(e.legalReview).join(', ')} is pending`);
    if (e.effectiveFrom !== e.date) fail(`${e.id}: effectiveFrom ${e.effectiveFrom} differs from date ${e.date}`);
    if (e.effectiveTo !== null && e.effectiveTo !== undefined && !(e.effectiveTo > e.effectiveFrom)) fail(`${e.id}: effectiveTo is not after effectiveFrom`);
    const history = e.history ?? [];
    if (history.some((h, i) => i && versionKey(h.rulePackVersion) < versionKey(history[i - 1].rulePackVersion))) fail(`${e.id}: history is not in version order`);
    if (history.some(h => versionKey(h.rulePackVersion) > versionKey(pack.rulePackVersion ?? '0.0.0'))) fail(`${e.id}: history names a rule pack later than ${pack.rulePackVersion}`);
  }
  for (const s of list('standards')) flags(s.id, s.legalReview);
  const art4a = pack.specialCategoryData;
  if (art4a) {
    flags('specialCategoryData', art4a.legalReview);
    const entry = entries.get(art4a.entryId);
    if (!entry) fail(`specialCategoryData: unknown entry ${art4a.entryId}`);
    else {
      if (entry.date !== art4a.inForceFrom) fail(`specialCategoryData: inForceFrom ${art4a.inForceFrom} differs from ${art4a.entryId} (${entry.date})`);
      for (const id of art4a.legalReview?.itemIds ?? []) if (!entry.legalReview?.itemIds?.includes(id)) fail(`specialCategoryData: legal-review item ${id} is not flagged on ${art4a.entryId}`);
    }
  }
  for (const item of obligations?.items ?? []) if (item.legalReview) flags('obligation ' + item.code, item.legalReview);
  const unapproved = [...entries.values()].filter(e => e.approval?.status !== 'approved').map(e => e.id);
  const openItems = [...reviewItems.values()].filter(i => i.status !== 'resolved').map(i => i.id);
  if (pack.approval?.status === 'approved' && (unapproved.length || openItems.length)) fail(`rule pack approved while ${[...unapproved, ...openItems].slice(0, 5).join(', ')} are pending`);
  // Related ids name entries, deadlines, standards or a whole section of the pack.
  const sections = ['specialCategoryData', 'provisionReferences'].filter(key => pack[key] !== undefined);
  const known = new Set([...entries.keys(), ...deadlines.keys(), ...list('standards').map(s => s.id), ...sections]);
  const revisions = Array.isArray(pack.research?.revisions) ? pack.research.revisions : [];
  const revisionData = revisions.map(r => revisionResearch[r?.data]?.data ?? null);
  // Ids a revision's research defines (procedures, checks, facts and so on):
  // a legal-review item that research introduced may relate to them.
  const researchIds = new Map();
  for (const data of revisionData) {
    if (!data) continue;
    const defined = new Set(Object.keys(data.vocabularies?.factVocabulary ?? {}));
    walk(data, node => typeof node.id === 'string' && defined.add(node.id));
    for (const item of data.legalReviewItems ?? []) researchIds.set(item.id, defined);
  }
  for (const item of reviewItems.values()) {
    if (!flagged.has(item.id)) fail(`legal-review item ${item.id} is not referenced by any entry`);
    const defined = researchIds.get(item.id);
    for (const id of item.relatedIds ?? []) if (!known.has(id) && (id.startsWith('aia-') || !defined?.has(id))) fail(`${item.id}: unknown related id ${id}`);
  }

  // Predicates over the declared fact vocabulary.
  const factTypes = obligations?.factTypes ?? {};
  const factValues = obligations?.factValues ?? {};
  const checkPredicates = (owner, predicates = []) => {
    for (const p of predicates) {
      const type = factTypes[p.fact];
      if (!type) {
        fail(`${owner}: predicate fact ${p.fact} is not declared in docs/obligation-subitems.json factTypes`);
        continue;
      }
      const ok =
        type === 'boolean_or_unknown'
          ? p.op === 'eq' && typeof p.value === 'boolean'
          : type === 'date_or_unknown'
            ? ['before', 'onOrAfter'].includes(p.op) && typeof p.value === 'string' && realDate(p.value)
            : type === 'enumeration_or_unknown'
              ? (p.op === 'eq' && (factValues[p.fact] ?? []).includes(p.value)) ||
                (p.op === 'in' && Array.isArray(p.value) && p.value.length > 0 && p.value.every(v => (factValues[p.fact] ?? []).includes(v)))
              : false;
      if (!ok) fail(`${owner}: predicate ${p.fact} ${p.op} ${JSON.stringify(p.value)} does not suit the fact type ${type}`);
    }
  };
  for (const e of entries.values()) {
    checkPredicates(e.id, e.appliesIf);
    checkPredicates(e.id, e.exceptIf);
    for (const [i, t] of (e.transitional ?? []).entries()) {
      const owner = `${e.id}/transitional/${i}`;
      checkPredicates(owner, t.appliesIf);
      checkPredicates(owner, t.exceptIf);
      checkPredicates(owner, t.obligationsApplyOnlyIf);
      if (t.entryId !== undefined) {
        if (t.entryId === e.id) fail(`${owner}: cross-reference to its own entry`);
        else if (!entries.has(t.entryId) && !deadlines.has(t.entryId)) fail(`${owner}: unknown cross-reference ${t.entryId}`);
      } else if (t.deadline && [...entries.values()].some(x => x.date === t.deadline && x.id !== e.id && same(x.appliesIf, t.appliesIf))) {
        fail(`${owner}: restates a standalone entry; list the rule once and link it with entryId`);
      }
    }
  }
  for (const p of list('prohibitedPractices')) {
    const entry = entries.get(p.entryId);
    if (!entry) fail(`${p.point}: unknown entry ${p.entryId}`);
    else if (entry.date !== p.appliesFrom) fail(`${p.point}: appliesFrom ${p.appliesFrom} differs from ${p.entryId} (${entry.date})`);
  }
  for (const [id, values] of Object.entries(factValues)) if (factTypes[id] !== 'enumeration_or_unknown') fail(`factValues ${id} is not an enumeration fact`);

  // Standards register (D-03): our titles, presumption only for cited standards.
  for (const s of list('standards')) {
    if (typeof s.title === 'string' && s.title.length > 80) fail(`${s.id}: title longer than 80 characters`);
    if (s.category === 'harmonised_standard_cited' && s.presumptionOfConformity?.clauseScope?.status === 'secondary_only' && !s.legalReview?.required) fail(`${s.id}: an unverified presumption scope needs a legal-review flag`);
    const scope = s.presumptionOfConformity?.clauseScope;
    const overlap = (scope?.covers ?? []).filter(clause => (scope?.excludes ?? []).includes(clause));
    if (overlap.length) fail(`${s.id}: clause scope both covers and excludes ${overlap.join(', ')}`);
  }

  // Later revisions: each names further verified research, applies every edit
  // that research addresses to the rule pack (#18), and declares the fields it
  // changes in entries taken from the base research.
  const amended = new Map(); // target id -> fields a revision amends
  const revisedFrom = new Map(); // research guidance id -> research entry
  const revisionSources = new Map();
  const revisionReviewItems = new Map();
  const resolvedClaims = new Set();
  revisions.forEach((revision, i) => {
    const label = `research.revisions/${i}`;
    const data = revisionData[i];
    const applied = revision.edits ?? [];
    if (i && versionKey(revision.rulePackVersion) <= versionKey(revisions[i - 1].rulePackVersion)) fail(`${label}: revisions are not in version order`);
    if (versionKey(revision.rulePackVersion ?? '0') > versionKey(pack.rulePackVersion ?? '0.0.0')) fail(`${label}: names a rule pack later than ${pack.rulePackVersion}`);
    if (!data) {
      fail(`${label}: research data ${revision.data} is missing`);
      return;
    }
    if (!revisionResearch[revision.data]?.reportExists) fail(`${label}: research report ${revision.report} does not exist`);
    if (data.basedOn?.file !== pack.research?.data) fail(`${label}: the research is not based on ${pack.research?.data}`);
    const edits = new Map((data.repositoryChanges ?? []).map(e => [e.id, e]));
    for (const id of applied)
      if (!edits.has(id)) fail(`${label}: unknown research edit ${id}`);
      else if (edits.get(id).target !== '#18') fail(`${label}: research edit ${id} is not addressed to the rule pack`);
    for (const e of edits.values()) if (e.target === '#18' && !applied.includes(e.id)) fail(`${label}: research edit ${e.id} is not applied`);
    for (const a of revision.amendments ?? []) {
      if (!applied.includes(a.edit)) fail(`${label}: amendment of ${a.target} cites ${a.edit}, which the revision does not apply`);
      amended.set(a.target, new Set([...(amended.get(a.target) ?? []), ...(a.fields ?? [])]));
    }
    for (const g of data.guidance ?? []) revisedFrom.set(g.id, g);
    for (const s of data.sources ?? []) if (!revisionSources.has(s.id)) revisionSources.set(s.id, s);
    for (const item of data.legalReviewItems ?? []) revisionReviewItems.set(item.id, item);
    for (const id of revision.resolvesUnverified ?? []) {
      if (!(data.consistencyChecks ?? []).some(c => c.rulePackRef === id && c.finding === 'resolved')) fail(`${label}: the research does not resolve ${id}`);
      resolvedClaims.add(id);
    }
  });
  for (const target of amended.keys()) if (!entries.has(target) && !reviewItems.has(target)) fail(`a research revision amends unknown entry ${target}`);
  const extends_ = (list, base) => Array.isArray(list) && Array.isArray(base) && list.length > base.length && base.every((x, i) => same(list[i], x));
  const amends = (x, field) => amended.get(x.id)?.has(field) ?? false;

  // Agreement with the verified research.
  if (!research) fail(`research data ${pack.research?.data} is missing`);
  else {
    if (research.researchedOn !== pack.researchedAsOf) fail(`researchedAsOf ${pack.researchedAsOf} differs from the research date ${research.researchedOn}`);
    if (research.legalText?.consolidatedVersion?.celex !== pack.celex) fail('celex differs from the research');
    // An entry a revision amends, replaces or adds is checked against that
    // revision (below) for what it declares, and against the base otherwise.
    const compare = (label, ours, theirs, fields, { skip = () => false, removed = new Set(), added = () => false } = {}) => {
      const mine = new Map(ours.map(x => [x.id ?? x.point, x]));
      const verified = new Map(theirs.map(x => [x.id ?? x.point, x]));
      for (const id of verified.keys()) if (!mine.has(id) && !removed.has(id)) fail(`${label}: research entry ${id} is missing`);
      for (const id of removed) if (mine.has(id)) fail(`${label}: ${id} was resolved by a research revision but is still listed`);
      for (const [id, x] of mine) {
        const r = verified.get(id);
        if (!r) {
          if (!added(x)) fail(`${label}: ${id} is not in the research`);
          continue;
        }
        for (const field of fields) if (!skip(x, field) && !same(x[field], r[field])) fail(`${label} ${id}: ${field} differs from the research`);
      }
    };
    compare('applicationDates', list('applicationDates'), research.applicationDates ?? [], ['date', 'dateType', 'provisions', 'scope', 'actors', 'conditions', 'appliesIf', 'exceptIf', 'notes', 'sourceIds', 'verification', 'legalReview', 'legalBasis'], { skip: amends });
    // Amended fields extend the base: notes are appended to, source and
    // legal-review lists keep the base items first and add to them.
    for (const r of research.applicationDates ?? []) {
      const e = entries.get(r.id);
      if (!e || !amended.has(r.id)) continue;
      const fields = amended.get(r.id);
      if (fields.has('notes') && !(typeof e.notes === 'string' && e.notes.startsWith(r.notes ?? '') && e.notes.length > (r.notes ?? '').length)) fail(`applicationDates ${r.id}: amended notes do not extend the research notes`);
      if (fields.has('sourceIds') && !extends_(e.sourceIds, r.sourceIds)) fail(`applicationDates ${r.id}: amended sources do not extend the research sources`);
      if (fields.has('legalReview')) {
        const base = r.legalReview?.itemIds ?? [];
        const ids = e.legalReview?.itemIds ?? [];
        if (!e.legalReview?.required || !extends_(ids, base)) fail(`applicationDates ${r.id}: amended legal review does not extend the research flags`);
        for (const id of ids.slice(base.length)) if (!revisionReviewItems.has(id)) fail(`applicationDates ${r.id}: legal-review item ${id} is not in a revision's research`);
      }
      if (!(e.history ?? []).some(h => revisions.some(v => v.rulePackVersion === h.rulePackVersion))) fail(`applicationDates ${r.id}: amended without a history record of the revision`);
    }
    // The summary is the research text, except that a pointer to a research
    // data key reads as a pointer the product resolves (summaryPointers).
    for (const r of research.applicationDates ?? []) {
      const e = entries.get(r.id);
      if (!e) continue;
      const [from, to] = summaryPointers[r.id] ?? ['', ''];
      if (e.summary !== (from ? r.summary?.replace(from, to) : r.summary)) fail(`applicationDates ${r.id}: summary differs from the research`);
    }
    if (art4a) {
      const { entryId, ...ours } = art4a;
      if (!same(ours, research.specialCategoryData)) fail('specialCategoryData differs from the research');
    } else if (research.specialCategoryData) fail('specialCategoryData is missing');
    if (!same(pack.provisionReferences, research.provisionReferences)) fail('provisionReferences differ from the research');
    for (const r of research.applicationDates ?? []) {
      const e = entries.get(r.id);
      if (!e) continue;
      const theirs = r.transitional ?? [];
      const ours = e.transitional ?? [];
      if (ours.length !== theirs.length) fail(`${r.id}: transitional records differ from the research`);
      theirs.forEach((t, i) => {
        const o = ours[i] ?? {};
        if (t.entryId) {
          if (o.entryId !== t.entryId || o.reference !== t.reference) fail(`${r.id}/transitional/${i}: cross-reference differs from the research`);
          const target = entries.get(t.entryId) ?? deadlines.get(t.entryId);
          if (target && t.deadline && target.date !== t.deadline) fail(`${r.id}/transitional/${i}: deadline ${t.deadline} differs from ${t.entryId} (${target.date})`);
          if (target && entries.has(t.entryId) && (!same(target.appliesIf, t.appliesIf) || !same(target.exceptIf, t.exceptIf))) fail(`${r.id}/transitional/${i}: predicates differ from ${t.entryId}`);
        } else if (!same(o, t)) fail(`${r.id}/transitional/${i}: differs from the research`);
      });
    }
    compare('authorityDeadlines', list('authorityDeadlines'), research.authorityDeadlines ?? [], ['date', 'provision', 'actor', 'summary', 'sourceIds', 'verification']);
    compare('prohibitedPractices', list('prohibitedPractices'), research.prohibitedPractices ?? [], ['label', 'appliesFrom', 'conditions', 'entryId', 'sourceIds', 'verification']);
    compare('standards', list('standards'), research.standards ?? [], ['reference', 'category', 'sourceIds', 'verification']);
    for (const s of list('standards')) {
      const r = (research.standards ?? []).find(x => x.id === s.id);
      if (!r) continue;
      if (!same(s.legalReview ?? { required: false, itemIds: [] }, r.legalReview ?? { required: false, itemIds: [] })) fail(`standards ${s.id}: legalReview differs from the research`);
      if (!same(s.reportedOutcome, r.reportedOutcome)) fail(`standards ${s.id}: reportedOutcome differs from the research`);
      if (!same(s.cen, r.cen)) fail(`standards ${s.id}: CEN stage data differ from the research`);
      const scope = r.presumptionOfConformity?.clauseScope;
      if (scope && (s.presumptionOfConformity?.clauseScope?.status !== scope.status || !same(s.presumptionOfConformity?.clauseScope?.sourceIds, scope.sourceIds))) fail(`standards ${s.id}: clause scope differs from the research`);
      if (r.ojCitation && (s.ojCitation?.celex !== r.ojCitation.celex || s.ojCitation?.publicationDate !== r.ojCitation.publicationDate || s.ojCitation?.eli !== r.ojCitation.eli)) fail(`standards ${s.id}: OJ citation differs from the research`);
    }
    // A guidance entry with researchRef reproduces a revision's research entry.
    const revised = g => typeof g.researchRef === 'string';
    compare('guidanceDocuments', list('guidanceDocuments'), research.guidance ?? [], ['title', 'status', 'sourceIds', 'verification', 'statutoryDeadline', 'draftPublished', 'expectedFinal'], { skip: revised, added: revised });
    for (const g of list('guidanceDocuments').filter(revised)) {
      const r = revisedFrom.get(g.researchRef);
      if (!r) {
        fail(`guidanceDocuments ${g.id}: researchRef ${g.researchRef} is not in a revision's research`);
        continue;
      }
      if (r.rulePackGuidanceId && r.rulePackGuidanceId !== g.id) fail(`guidanceDocuments ${g.id}: the research revises ${r.rulePackGuidanceId} from ${r.id}`);
      for (const field of ['title', 'status', 'reference', 'legalEffect', 'dates', 'sourceIds', 'verification']) if (!same(g[field], r[field])) fail(`guidanceDocuments ${g.id}: ${field} differs from ${r.id} in the research`);
      if (r.notes !== undefined && g.note !== r.notes) fail(`guidanceDocuments ${g.id}: note differs from ${r.id} in the research`);
    }
    for (const r of revisedFrom.values())
      if (r.rulePackGuidanceId && !list('guidanceDocuments').some(g => g.id === r.rulePackGuidanceId && g.researchRef === r.id)) fail(`guidanceDocuments ${r.rulePackGuidanceId}: not revised from ${r.id} as the research requires`);
    const fromRevision = x => revisionReviewItems.has(x.id);
    compare('legalReviewItems', list('legalReviewItems'), research.legalReviewItems ?? [], ['topic', 'question', 'relatedIds'], { skip: amends, added: fromRevision });
    for (const r of research.legalReviewItems ?? []) {
      const item = reviewItems.get(r.id);
      if (item && amends(item, 'question') && !(item.question.startsWith(r.question) && item.question.length > r.question.length)) fail(`legalReviewItems ${r.id}: amended question does not extend the research question`);
    }
    for (const item of list('legalReviewItems').filter(fromRevision)) {
      const r = revisionReviewItems.get(item.id);
      for (const field of ['topic', 'question', 'relatedIds']) if (!same(item[field], r[field])) fail(`legalReviewItems ${item.id}: ${field} differs from the research revision`);
    }
    compare('unverified', list('unverified'), research.unverified ?? [], ['claim', 'status', 'reason', 'sourceIds'], { removed: resolvedClaims });
    const sourceFields = ['title', 'publisher', 'kind', 'canonicalUrl', 'accessUrl', 'sha256', 'retrievedOn'];
    const baseSources = new Set((research.sources ?? []).map(s => s.id));
    compare('sources', list('sources'), research.sources ?? [], sourceFields, { added: s => revisionSources.has(s.id) });
    for (const s of list('sources').filter(s => !baseSources.has(s.id) && revisionSources.has(s.id))) {
      const r = revisionSources.get(s.id);
      for (const field of sourceFields) if (!same(s[field], r[field])) fail(`sources ${s.id}: ${field} differs from the research revision`);
    }
    if (research.approval?.status !== 'approved' && pack.approval?.status === 'approved') fail('rule pack approved although the research is unapproved');
  }
  return problems;
}

/** Single mutations the checks must each reject. */
export const mutations = [
  ['unknown source id', p => { p.applicationDates[0].sourceIds.push('SRC-UNKNOWN'); }],
  ['uncited source', p => { p.sources.push({ ...p.sources[0], id: 'SRC-NEVER-CITED' }); }],
  ['impossible calendar date', p => { p.applicationDates[0].date = '2026-02-30'; p.applicationDates[0].effectiveFrom = '2026-02-30'; }],
  ['unknown legal-review item', p => { p.applicationDates[1].legalReview = { required: true, itemIds: ['LR-99'] }; }],
  ['approved without reviewer', p => { p.applicationDates[0].approval = { status: 'approved', reviewer: null, approvedAt: null }; }],
  ['approved while legal review is pending', p => { const e = p.applicationDates.find(x => x.legalReview.required); e.approval = { status: 'approved', reviewer: 'counsel', approvedAt: '2026-11-20' }; }],
  ['rule pack approved while entries are pending', p => { p.approval = { ...p.approval, status: 'approved', reviewer: 'counsel', approvedAt: '2026-11-20' }; }],
  ['resolved legal-review item without reviewer', p => { p.legalReviewItems[0].status = 'resolved'; }],
  ['secondary source backing a verified field', p => { p.applicationDates[0].sourceIds.push('SEC-KLA-JTC21'); }],
  ['undeclared predicate fact', p => { p.applicationDates.find(x => x.appliesIf).appliesIf[0].fact = 'inventedFact'; }],
  ['predicate value of the wrong type', p => { p.applicationDates.find(x => x.id === 'aia-2026-12-02-art50-2-legacy-transition').appliesIf[0].value = '2026-08-02'; }],
  ['cross-reference to an unknown entry', p => { p.applicationDates.find(x => x.transitional?.some(t => t.entryId)).transitional.find(t => t.entryId).entryId = 'aia-2099-01-01-unknown'; }],
  ['practice date differs from its entry', p => { p.prohibitedPractices.find(x => x.point === 'Art 5(1)(ba)').appliesFrom = '2026-08-02'; }],
  ['standard title over 80 characters', p => { p.standards[1].title = 'x'.repeat(81); }],
  ['draft without the not-harmonised label', p => { p.standards.find(s => s.category === 'draft_not_harmonised').label = 'Draft standard'; }],
  ['presumption claimed for an uncited standard', p => { p.standards.find(s => s.category === 'international_standard_not_cited').presumptionOfConformity.status = 'limited_to_covered_clauses'; }],
  ['date differs from the verified research', p => { const e = p.applicationDates.find(x => x.id === 'aia-2027-12-02-high-risk-annex-iii'); e.date = '2027-08-02'; e.effectiveFrom = '2027-08-02'; }],
  ['legal-review flag dropped', p => { const e = p.applicationDates.find(x => x.id === 'aia-2026-12-02-art5-new-prohibitions'); e.legalReview = { required: false, itemIds: [] }; }],
  ['duplicate id', p => { p.authorityDeadlines[0].id = p.applicationDates[0].id; }],
  ['rule-pack version differs from the methodology version', p => { p.rulePackVersion = '2099.1.1'; }],
  ['consolidated text presented as having legal effect', p => { p.consolidatedTextLegalEffect = 'authentic'; }],
  ['summary differs from the verified research', p => { const e = p.applicationDates.find(x => x.id === 'aia-2026-12-02-art50-2-legacy-transition'); e.summary = e.summary.replace('2 Dec 2026', '2 Feb 2027'); }],
  ['condition differs from the verified research', p => { const e = p.applicationDates.find(x => x.id === 'aia-2026-12-02-art5-new-prohibitions'); e.conditions[1] = e.conditions[1].replace('only where', 'where'); }],
  ['summary pointer to a research data key', p => { const e = p.applicationDates.find(x => x.id === 'aia-2026-07-27-art4a-bias-data'); e.summary = e.summary.replace('The Art 4a(1) and (2) conditions are listed under this entry.', 'See specialCategoryData for the exact conditions.'); }],
  ['Art 4a condition differs from the verified research', p => { p.specialCategoryData.paragraph1.allConditionsRequired.pop(); }],
  ['Art 4a conditions linked to an unknown entry', p => { p.specialCategoryData.entryId = 'aia-2026-07-27-unknown'; }],
  ['Art 4a legal-review flag dropped', p => { p.specialCategoryData.legalReview = { required: false, itemIds: [] }; }],
  ['legal-review related id dropped', p => { p.legalReviewItems.find(i => i.id === 'LR-06').relatedIds = ['aia-2026-07-27-art4a-bias-data']; }],
  ['clause scope covers and excludes the same clause', p => { const scope = p.standards.find(s => s.presumptionOfConformity.clauseScope).presumptionOfConformity.clauseScope; scope.excludes.push(scope.covers[0]); }],
  ['research edit for the rule pack not applied', p => { p.research.revisions[0].edits = p.research.revisions[0].edits.filter(id => id !== 'A50-ED-11'); }],
  ['unknown research edit', p => { p.research.revisions[0].edits.push('A50-ED-99'); }],
  ['revised guidance differs from the Art 50 research', p => { p.guidanceDocuments.find(g => g.id === 'GUID-ART50-TRANSPARENCY').status = 'published'; }],
  ['guidance revision dropped', p => { delete p.guidanceDocuments.find(g => g.id === 'GUID-ART50-COP-OPINION').researchRef; }],
  ['resolved unverified claim still listed', p => { p.unverified.push({ id: 'UV-05', claim: 'Final Code of Practice on marking and labelling published 10 Jun 2026 (earlier research)', status: 'secondary_only', reason: 'Not fetched.' }); }],
  ['unverified claim dropped without a resolving revision', p => { p.research.revisions[0].resolvesUnverified = ['UV-05']; }],
  ['amended legal review drops a base flag', p => { const e = p.applicationDates.find(x => x.id === 'aia-2026-08-02-art50-transparency'); e.legalReview.itemIds = e.legalReview.itemIds.filter(id => id !== 'LR-04'); }],
  ['Art 50 legal-review item differs from the research', p => { p.legalReviewItems.find(x => x.id === 'LR-A50-10').question = 'Changed.'; }],
  ['amended question rewrites the research question', p => { const i = p.legalReviewItems.find(x => x.id === 'LR-03'); i.question = 'Is Art 50 deferred? ' + i.question; }],
  ['undeclared change to an entry from the base research', p => { p.research.revisions[0].amendments = p.research.revisions[0].amendments.filter(a => a.target !== 'aia-2026-08-02-art50-transparency'); }],
  ['revision source differs from the research', p => { p.sources.find(s => s.id === 'SRC-EC-A50-GUIDELINES').sha256 = '0'.repeat(64); }],
];

function main() {
  const args = process.argv.slice(2);
  const validate = args.includes('--ajv-package') ? loadValidator(undefined, args[args.indexOf('--ajv-package') + 1]) : loadValidator();
  if (!existsSync(resolve(workspace, 'templates/catalog.json'))) {
    console.log('PASS rule-pack schema compiles; templates/ absent (runtime package), rule pack not checked');
    return;
  }
  const inputs = loadInputs();
  const problems = checkRulePack({ ...inputs, validate });
  if (problems.length) {
    console.error(`FAIL rule pack: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(' - ' + problem);
    process.exit(1);
  }
  let rejected = 0;
  for (const [label, mutate] of mutations) {
    const catalog = structuredClone(inputs.catalog);
    mutate(catalog.regulatorySnapshot);
    if (checkRulePack({ ...inputs, catalog, validate }).length) rejected++;
    else {
      console.error(`FAIL mutation accepted: ${label}`);
      process.exit(1);
    }
  }
  const pack = inputs.catalog.regulatorySnapshot;
  const pending = pack.legalReviewItems.filter(i => i.status !== 'resolved').length;
  console.log(
    `PASS rule pack ${pack.rulePackVersion} (researched ${pack.researchedAsOf}): ${pack.applicationDates.length} application dates, ${pack.authorityDeadlines.length} authority deadlines, ` +
      `${pack.prohibitedPractices.length} Art 5 practices, ${pack.standards.length} standards, ${pack.sources.length} sources; ${pending} legal-review items pending; ` +
      `references resolve and match the research; ${rejected}/${mutations.length} mutations rejected`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
