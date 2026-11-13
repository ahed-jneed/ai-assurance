/**
 * Checks the criteria documents of templates/criteria/ (docs/design/criteria-model.md,
 * section 14): every document against criteria-pack.schema.json, the integrity
 * rules 1 to 12 that JSON Schema cannot express, and rule 13, the index history
 * against a base commit. Run from the repository root:
 *
 *   node schemas/validate-criteria.mjs                       schema and integrity
 *   node schemas/validate-criteria.mjs --base <commit>       also rule 13 against that commit
 *   node schemas/validate-criteria.mjs --stamp               fill in the digests of released entries
 *   node schemas/validate-criteria.mjs --legacy-check <json> the pre-deploy check of section 11.4
 *   node schemas/validate-criteria.mjs --ajv-package <path>  load Ajv from another package.json
 *
 * The module exports the same checks for the Site's tests and for the sync
 * script, which writes site-app/lib/criteria/bundle.generated.json. The
 * runtime package ships this file and the schema but no templates/ folder;
 * there it only checks that the schema compiles.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(directory, '..');
export const criteriaRoot = resolve(workspace, 'templates/criteria');
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));

// ---------------------------------------------------------------------------
// RFC 8785 (JCS) canonical form and digests (design section 6.5)

/** The RFC 8785 serialisation: sorted keys (UTF-16 order), no whitespace, ECMAScript forms. */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('JCS cannot represent ' + value);
    if (value === undefined) throw new Error('JCS cannot represent undefined');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value)
    .filter(key => value[key] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
}
/** SHA-256 of the JCS form of a parsed document. */
export const digest = document => createHash('sha256').update(canonicalize(document), 'utf8').digest('hex');

// ---------------------------------------------------------------------------
// Loading

/** Compiles the criteria schema with Ajv 2020 and ajv-formats from site-app/node_modules (or the given package). */
export function loadValidator(schema = readJSON(resolve(directory, 'criteria-pack.schema.json')), ajvPackage = resolve(workspace, 'site-app/package.json')) {
  const require = createRequire(resolve(ajvPackage));
  const Ajv2020 = require('ajv/dist/2020').default;
  const addFormats = require('ajv-formats');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  if (!ajv.validateSchema(schema)) throw new Error('Invalid criteria schema: ' + JSON.stringify(ajv.errors));
  return ajv.compile(schema);
}

/** Paths, relative to the criteria root, of every document file on disk. */
function documentFiles(root) {
  const found = [];
  for (const folder of ['frameworks', 'packs', 'crosswalks']) {
    const walk = dir => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.json')) found.push(relative(root, path).split('\\').join('/'));
      }
    };
    walk(join(root, folder));
  }
  return found;
}

/** The index and every document file under a criteria root: {index, documents: Map<path, document>}. */
export function readCriteria(root = criteriaRoot) {
  const documents = new Map(documentFiles(root).map(path => [path, readJSON(join(root, path))]));
  return { index: readJSON(join(root, 'index.json')), documents };
}

/**
 * The Annex IV map a pack with features.annexIvIndex is served: its own
 * annexIvMap or, for a version released before phase 2 embedded the map, that
 * of the current (highest released, not withdrawn) version of the same pack
 * id, which is what the build before phase 2 served it from
 * templates/annex-iv-map.json. Mirrors annexIvMapOf in site-app/lib/criteria.
 */
export function servedAnnexMap({ index, documents }, pack) {
  if (pack.annexIvMap) return pack.annexIvMap;
  const current = (index.documents ?? [])
    .filter(e => e.documentType === 'pack' && e.id === pack.id && e.status === 'released')
    .sort((a, b) => compareVersions(b.version, a.version))[0];
  return (current && documents.get(current.path)?.annexIvMap) ?? null;
}

// ---------------------------------------------------------------------------
// Helpers

const LEGISLATION = new Set(['legislation', 'implementing_act', 'local_law']);
const isReleased = entry => entry.status === 'released' || entry.status === 'withdrawn';
const versionParts = v => v.split('.').map(Number);
/** Compares two YEAR.MONTH.SEQUENCE versions numerically, part by part. */
export function compareVersions(a, b) {
  const x = versionParts(a),
    y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
/** The ids of a node's groups, nearest first (cycles are reported by rule 2). */
function ancestors(nodes, node) {
  const out = [];
  for (let p = node.parent === undefined ? undefined : nodes.get(node.parent); p && !out.includes(p.id); p = p.parent === undefined ? undefined : nodes.get(p.parent)) out.push(p.id);
  return out;
}
const entryName = e => `${e.documentType} ${e.id}${e.edition ? '@' + e.edition : ''} ${e.version}`;
const personKey = by => String(by).trim().toLowerCase();
const expectedPath = doc =>
  doc.documentType === 'framework'
    ? `frameworks/${doc.id}/${doc.edition}/${doc.version}.json`
    : doc.documentType === 'pack'
      ? `packs/${doc.id}/${doc.version}.json`
      : `crosswalks/${doc.id}/${doc.version}.json`;

/** Index lookups shared by the rules. */
function indexer(index, documents) {
  const entries = index.documents ?? [];
  const docOf = entry => documents.get(entry.path);
  const frameworkEntry = (id, edition, version) =>
    entries.find(e => e.documentType === 'framework' && e.id === id && e.edition === edition && e.version === version);
  const frameworkVersions = (id, edition) => entries.filter(e => e.documentType === 'framework' && e.id === id && e.edition === edition);
  /** The latest data version of an edition: released only, or with drafts too. */
  const latestFramework = (id, edition, withDrafts) =>
    frameworkVersions(id, edition)
      .filter(e => (withDrafts ? e.status !== 'withdrawn' : e.status === 'released'))
      .sort((a, b) => compareVersions(b.version, a.version))[0];
  return { entries, docOf, frameworkEntry, frameworkVersions, latestFramework };
}

// ---------------------------------------------------------------------------
// Rules 1 to 12 (section 14.2)

/**
 * Runs the schema and integrity rules over an index and its documents.
 * Returns {errors, warnings}; each message starts with its rule number.
 */
export function checkCriteria({ index, documents, validate = loadValidator() }) {
  const errors = [],
    warnings = [];
  const fail = (rule, message) => errors.push(`rule ${rule}: ${message}`);
  if (!validate(index)) errors.push('schema: index.json: ' + JSON.stringify(validate.errors.slice(0, 5)));
  for (const [path, doc] of documents)
    if (!validate(doc)) errors.push(`schema: ${path}: ` + JSON.stringify(validate.errors.slice(0, 5)));
  if (errors.length) return { errors, warnings };
  const { entries, docOf, frameworkEntry, frameworkVersions, latestFramework } = indexer(index, documents);

  // 12a. Structure, drafts included.
  const listed = new Set();
  const seen = new Map();
  for (const entry of entries) {
    if (listed.has(entry.path)) fail('12a', `${entry.path} is listed twice`);
    listed.add(entry.path);
    const doc = docOf(entry);
    if (!doc) {
      fail('12a', `${entry.path} is listed but missing`);
      continue;
    }
    if (doc.documentType !== entry.documentType || doc.id !== entry.id || doc.version !== entry.version || (doc.edition ?? undefined) !== (entry.edition ?? undefined))
      fail('12a', `${entry.path}: the index entry (${entryName(entry)}) does not match the document (${entryName(doc)})`);
    if (expectedPath(doc) !== entry.path) fail('12a', `${entry.path} should be at ${expectedPath(doc)}`);
    const key = `${entry.documentType}:${entry.id}@${entry.edition ?? ''}`;
    const previous = seen.get(key);
    if (previous && compareVersions(entry.version, previous) <= 0) fail('12a', `${entryName(entry)}: versions must increase in index order (after ${previous})`);
    seen.set(key, entry.version);
    if (entry.selectable !== undefined && (doc.documentType !== 'pack' || doc.kind !== 'audit_programme'))
      fail('12a', `${entryName(entry)}: only audit programmes are selectable`);
  }
  for (const path of documents.keys()) if (!listed.has(path)) fail('12a', `${path} is not listed in index.json`);

  const frameworks = entries.filter(e => e.documentType === 'framework' && docOf(e));
  const packs = entries.filter(e => e.documentType === 'pack' && docOf(e));
  const crosswalks = entries.filter(e => e.documentType === 'crosswalk' && docOf(e));

  // 1 and 2. Framework trees.
  for (const entry of frameworks) {
    const doc = docOf(entry),
      ids = new Map(),
      aliases = new Set();
    for (const r of doc.requirements) {
      if (ids.has(r.id)) fail(1, `${entryName(entry)}: duplicate requirement id ${r.id}`);
      ids.set(r.id, r);
      for (const alias of r.aliases ?? []) {
        if (aliases.has(alias)) fail(1, `${entryName(entry)}: duplicate alias ${alias}`);
        aliases.add(alias);
      }
    }
    const childCount = new Map();
    for (const r of doc.requirements) {
      if (r.parent === undefined) continue;
      const parent = ids.get(r.parent);
      if (!parent || parent.type !== 'group') fail(2, `${entryName(entry)}: ${r.id} has parent ${r.parent}, which is not a group of this document`);
      childCount.set(r.parent, (childCount.get(r.parent) ?? 0) + 1);
      const path = new Set([r.id]);
      for (let p = ids.get(r.parent); p; p = p.parent === undefined ? undefined : ids.get(p.parent)) {
        if (path.has(p.id)) {
          fail(2, `${entryName(entry)}: the parents of ${r.id} form a cycle`);
          break;
        }
        path.add(p.id);
      }
    }
    for (const r of doc.requirements) if (r.type === 'group' && !childCount.get(r.id)) fail(2, `${entryName(entry)}: group ${r.id} has no children`);
    for (const r of doc.requirements) for (const target of r.replacedBy ?? []) if (!ids.has(target)) fail(3, `${entryName(entry)}: ${r.id} is replaced by ${target}, which does not exist`);
  }

  // 3. Released ids persist in later released data versions of an edition.
  const editions = new Set(frameworks.map(e => `${e.id}\u0000${e.edition}`));
  for (const key of editions) {
    const [id, edition] = key.split('\u0000');
    const released = frameworkVersions(id, edition)
      .filter(e => isReleased(e) && docOf(e))
      .sort((a, b) => compareVersions(a.version, b.version));
    for (let i = 0; i < released.length; i++)
      for (let j = i + 1; j < released.length; j++) {
        const later = new Set(docOf(released[j]).requirements.map(r => r.id));
        for (const r of docOf(released[i]).requirements)
          if (!later.has(r.id)) fail(3, `${id}@${edition}: ${r.id} of ${released[i].version} is missing from ${released[j].version}`);
      }
  }

  // 4 to 8, 11. Packs.
  for (const entry of packs) {
    const pack = docOf(entry),
      name = entryName(entry);
    const sets = new Map();
    for (const set of pack.criteria) {
      if (sets.has(set.framework)) fail(4, `${name}: two criteria sets for framework ${set.framework}`);
      const fwEntry = frameworkEntry(set.framework, set.edition, set.version);
      const fw = fwEntry && docOf(fwEntry);
      if (!fw) {
        fail(4, `${name}: criteria set ${set.framework}@${set.edition} ${set.version} is not an indexed framework document`);
        continue;
      }
      const nodes = new Map(fw.requirements.map(r => [r.id, r]));
      for (const id of set.include ?? []) if (!nodes.has(id)) fail(4, `${name}: include ${id} is not a requirement of ${set.framework}`);
      sets.set(set.framework, { set, fw, nodes, entry: fwEntry });
    }
    // 5. Objective links.
    for (const o of pack.controlObjectives) {
      const linked = new Set();
      for (const link of o.addresses) {
        const [framework, requirement] = link.requirement.split(':');
        const target = sets.get(framework)?.nodes.get(requirement);
        if (!target) fail(5, `${name}: ${o.id} links ${link.requirement}, which is not in the pack's criteria sets`);
        else if (target.type === 'informative') fail(5, `${name}: ${o.id} links the informative node ${link.requirement}`);
        const key = link.requirement + ' ' + link.rationale;
        if (linked.has(key)) fail(5, `${name}: ${o.id} links ${link.requirement} twice with rationale ${link.rationale}`);
        linked.add(key);
      }
    }
    // 6. Items, steps, objectives and phases.
    const itemIds = new Set(),
      stepIds = new Set(),
      objectiveIds = new Set(pack.controlObjectives.map(o => o.id)),
      used = new Set(),
      phases = new Set((pack.phases ?? []).map(p => p.id));
    if (objectiveIds.size !== pack.controlObjectives.length) fail(6, `${name}: duplicate control objective ids`);
    for (const item of pack.items) {
      if (itemIds.has(item.id)) fail(6, `${name}: duplicate item id ${item.id}`);
      itemIds.add(item.id);
      for (const step of item.procedures) {
        if (stepIds.has(step.id)) fail(6, `${name}: duplicate step id ${step.id}`);
        stepIds.add(step.id);
      }
      for (const id of item.objectiveIds) {
        if (!objectiveIds.has(id)) fail(6, `${name}: ${item.id} uses the unknown objective ${id}`);
        used.add(id);
      }
      if (item.phase !== undefined && !phases.has(item.phase)) fail(6, `${name}: ${item.id} has the unknown phase ${item.phase}`);
      // 7. Catalogue references resolve through aliases of a primary framework.
      for (const ref of item.regulatoryRefs)
        if (![...sets.values()].some(s => s.set.role === 'primary' && s.fw.requirements.some(r => (r.aliases ?? []).includes(ref))))
          fail(7, `${name}: ${item.id} cites ${ref}, which no primary framework lists as an alias`);
    }
    for (const id of objectiveIds) if (!used.has(id)) fail(6, `${name}: objective ${id} is used by no item`);
    // 8. Roles and features.
    const roles = pack.roles ?? {};
    for (const [role, value] of Object.entries(roles))
      for (const templateId of typeof value === 'string' ? [value] : Object.values(value))
        if (!itemIds.has(templateId)) fail(8, `${name}: role ${role} names ${templateId}, which is not an item`);
    const features = pack.features ?? {};
    if (features.annexIvIndex) {
      const annexMap = servedAnnexMap({ index, documents }, pack);
      if (!annexMap) fail(8, `${name}: annexIvIndex needs an annexIvMap, on the pack or on the current version of ${pack.id}`);
      else
        for (const section of annexMap.sections)
          for (const paperId of section.paperIds) if (!itemIds.has(paperId)) fail(8, `${name}: annexIvIndex needs ${paperId} of the Annex IV map as an item`);
    }
    const aiAct = sets.get('eu-ai-act');
    if ((features.aiActClassification || features.obligationAssessments) && !aiAct) fail(8, `${name}: AI Act features need an eu-ai-act criteria set`);
    // The management-system features (#28).
    if (features.statementOfApplicability !== true && pack.soaControls !== undefined) fail(8, `${name}: soaControls needs features.statementOfApplicability`);
    if (features.statementOfApplicability) {
      const [framework, group] = (pack.soaControls ?? '').split(':');
      const set = sets.get(framework);
      const node = set?.nodes.get(group);
      if (!node || node.type !== 'group') fail(8, `${name}: statementOfApplicability needs soaControls naming a group of a criteria set`);
      else {
        const below = id => [...set.nodes.values()].some(n => n.type === 'requirement' && ancestors(set.nodes, n).includes(id));
        if (!below(group)) fail(8, `${name}: soaControls ${pack.soaControls} has no requirement below it`);
      }
    }
    if (features.certificationRecommendation) {
      if (!features.nonconformityGrading || !features.statementOfApplicability)
        fail(8, `${name}: certificationRecommendation needs nonconformityGrading and statementOfApplicability`);
      if (!(pack.engagementTypes ?? []).includes('certification_audit')) fail(8, `${name}: certificationRecommendation needs the certification_audit engagement type`);
    }
    if (features.obligationAssessments && aiAct) {
      const order = aiAct.fw.compat?.obligations?.order;
      if (!order) fail(8, `${name}: obligationAssessments needs compat.obligations on the eu-ai-act framework`);
      else for (const code of order) if (aiAct.nodes.get(code)?.type !== 'requirement') fail(8, `${name}: obligation ${code} is not a requirement node`);
    }
    // 9 (crosswalk-only packs).
    for (const ref of pack.crosswalks ?? []) {
      const cw = crosswalks.find(e => e.id === ref.id && e.version === ref.version);
      if (!cw) fail(9, `${name}: crosswalk ${ref.id} ${ref.version} is not indexed`);
      else {
        const doc = docOf(cw);
        const connects = pack.criteria.some(
          s => (doc.source.framework === s.framework && doc.source.edition === s.edition) || (doc.target.framework === s.framework && doc.target.edition === s.edition),
        );
        if (!connects) fail(9, `${name}: crosswalk ${ref.id} connects none of the pack's criteria editions`);
      }
    }
    // 11. Items copied from another pack.
    for (const item of pack.items) {
      if (!item.derivedFrom) continue;
      const upstreamEntry = packs.find(e => e.id === item.derivedFrom.packId && e.version === item.derivedFrom.version);
      const upstream = upstreamEntry && docOf(upstreamEntry).items.find(i => i.id === item.derivedFrom.itemId);
      const strip = ({ objectiveIds, phase, derivedFrom, ...rest }) => rest;
      if (!upstream) warnings.push(`rule 11: ${name}: ${item.id} derives from ${item.derivedFrom.packId} ${item.derivedFrom.version} ${item.derivedFrom.itemId}, which is not available`);
      else if (canonicalize(strip(item)) !== canonicalize(strip(upstream))) warnings.push(`rule 11: ${name}: upstream changed for ${item.id} (${item.derivedFrom.packId} ${item.derivedFrom.version})`);
    }
  }

  // 9 and 10. Crosswalks.
  for (const entry of crosswalks) {
    const cw = docOf(entry),
      name = entryName(entry);
    const released = isReleased(entry);
    const side = ({ framework, edition }) => {
      const latest = latestFramework(framework, edition, !released);
      return latest && docOf(latest) ? new Set(docOf(latest).requirements.map(r => r.id)) : null;
    };
    const sources = side(cw.source),
      targets = side(cw.target);
    if (!sources) fail(9, `${name}: no ${released ? 'released ' : ''}data version of ${cw.source.framework}@${cw.source.edition}`);
    if (!targets) fail(9, `${name}: no ${released ? 'released ' : ''}data version of ${cw.target.framework}@${cw.target.edition}`);
    const ids = new Set();
    let legalEffect = false;
    for (const [i, e] of cw.entries.entries()) {
      if (e.id !== undefined) {
        if (ids.has(e.id)) fail(9, `${name}: duplicate entry id ${e.id}`);
        ids.add(e.id);
      }
      const label = e.id ?? `#${i + 1}`;
      if (sources) for (const s of e.sources) if (!sources.has(s)) fail(9, `${name}: entry ${label} source ${s} is not in ${cw.source.framework}@${cw.source.edition}`);
      if (targets && !targets.has(e.target)) fail(9, `${name}: entry ${label} target ${e.target} is not in ${cw.target.framework}@${cw.target.edition}`);
      if (e.legalEffect) {
        legalEffect = true;
        if (released && e.legalEffect.provenance.legalReview !== 'completed')
          fail(10, `${name}: entry ${label} has a legal effect whose legal review is not completed`);
      }
    }
    if (released && legalEffect) {
      const roles = new Set((entry.approvals ?? []).map(a => a.role));
      if (!roles.has('legal_reviewer') || !roles.has('methodology_owner'))
        fail(10, `${name}: a crosswalk with a legal effect is released only with the methodology owner's and a legal reviewer's approval`);
    }
  }

  // 12b. Release.
  for (const entry of entries.filter(isReleased)) {
    const doc = docOf(entry),
      name = entryName(entry);
    if (!doc) continue;
    if (digest(doc) !== entry.sha256) fail('12b', `${name}: sha256 ${entry.sha256} is not the JCS digest ${digest(doc)}`);
    const approvals = entry.approvals ?? [];
    if (!approvals.some(a => a.role === 'methodology_owner')) fail('12b', `${name}: a released document needs the methodology owner's approval`);
    if (approvals.length === 2 && personKey(approvals[0].by) === personKey(approvals[1].by))
      fail('12b', `${name}: two approvals of one document must come from two different people`);
    const legislation = doc.documentType === 'framework' && LEGISLATION.has(doc.kind);
    if (legislation && entry.legalReview === undefined) fail('12b', `${name}: a released legislation framework records legalReview (pending or completed)`);
    if (!legislation && entry.legalReview !== undefined) fail('12b', `${name}: only legislation frameworks record legalReview`);
    if (approvals.some(a => a.role === 'legal_reviewer') && !legislation && doc.documentType !== 'crosswalk')
      fail('12b', `${name}: a legal reviewer's approval belongs only on a legislation framework or a crosswalk`);
    if (doc.documentType === 'framework' && doc.licence.status !== 'confirmed') fail('12b', `${name}: a framework with an unconfirmed licence cannot be released`);
    const references = [];
    if (doc.documentType === 'pack') {
      for (const set of doc.criteria) references.push(frameworkEntry(set.framework, set.edition, set.version));
      for (const ref of doc.crosswalks ?? []) references.push(crosswalks.find(e => e.id === ref.id && e.version === ref.version));
    }
    if (doc.documentType === 'crosswalk')
      for (const end of [doc.source, doc.target]) if (!latestFramework(end.framework, end.edition, false)) references.push(undefined);
    for (const ref of references) if (!ref || !isReleased(ref)) fail('12b', `${name}: a released document references a draft or missing document${ref ? ' (' + entryName(ref) + ')' : ''}`);
  }
  const defaultPack = index.defaults?.pack;
  if (defaultPack) {
    const entry = packs.find(e => e.id === defaultPack.id && e.version === defaultPack.version);
    if (!entry || entry.status !== 'released' || !entry.selectable || docOf(entry).kind !== 'audit_programme')
      fail('12b', `defaults.pack ${defaultPack.id} ${defaultPack.version} must be a released, selectable audit programme`);
  }
  const legacy = index.legacy;
  if (legacy)
    for (const version of [legacy.fallbackVersion, ...Object.values(legacy.stamps)]) {
      const entry = packs.find(e => e.id === legacy.packId && e.version === version);
      if (!entry || !isReleased(entry)) fail('12b', `legacy: ${legacy.packId} ${version} must be a released or withdrawn pack version`);
    }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Rule 13: index history against a base

const sameJSON = (a, b) => canonicalize(a ?? null) === canonicalize(b ?? null);
const STATUS_ORDER = { draft: 0, released: 1, withdrawn: 2 };

/** Compares an index with the index at the base (null: the base has none). Returns errors. */
export function checkHistory(base, index) {
  if (!base) return [];
  const errors = [];
  const fail = message => errors.push('rule 13: ' + message);
  const key = e => `${e.documentType}:${e.id}@${e.edition ?? ''}#${e.version}`;
  const now = new Map((index.documents ?? []).map(e => [key(e), e]));
  for (const before of base.documents ?? []) {
    const after = now.get(key(before));
    const name = entryName(before);
    if (!after) {
      if (before.status !== 'draft') fail(`${name} was ${before.status} and has been removed`);
      continue;
    }
    if (STATUS_ORDER[after.status] < STATUS_ORDER[before.status]) fail(`${name} moved back from ${before.status} to ${after.status}`);
    if (!isReleased(before)) continue;
    for (const field of ['sha256', 'releasedAt', 'path']) if (!sameJSON(before[field], after[field])) fail(`${name}: ${field} of a released entry changed`);
    const was = before.approvals ?? [],
      is = after.approvals ?? [];
    const prefix = was.every((a, i) => sameJSON(a, is[i]));
    if (before.legalReview === 'pending' && after.legalReview === 'completed') {
      const appended = is.slice(was.length);
      if (!prefix || appended.length !== 1 || appended[0].role !== 'legal_reviewer' || appended[0].at < before.releasedAt)
        fail(`${name}: completing the legal review appends exactly one legal_reviewer approval, dated no earlier than the release, after the existing approvals`);
    } else {
      if (!sameJSON(was, is)) fail(`${name}: approvals of a released entry changed`);
      if (!sameJSON(before.legalReview, after.legalReview)) fail(`${name}: legalReview of a released entry changed from ${before.legalReview} to ${after.legalReview}`);
    }
  }
  if (base.legacy) {
    const legacy = index.legacy ?? {};
    if (legacy.packId !== base.legacy.packId) fail('legacy.packId is frozen');
    if (legacy.fallbackVersion !== base.legacy.fallbackVersion) fail('legacy.fallbackVersion is frozen');
    for (const [stamp, version] of Object.entries(base.legacy.stamps ?? {}))
      if ((legacy.stamps ?? {})[stamp] !== version) fail(`legacy.stamps[${stamp}] is frozen`);
  }
  return errors;
}

/**
 * The index at a base commit, failing closed: the commit must be present, and
 * only a present commit without templates/criteria/index.json counts as an
 * empty base (null).
 */
export function baseIndex(base, cwd = workspace) {
  const git = args => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const resolved = git(['rev-parse', '--verify', `${base}^{commit}`]);
  if (resolved.status !== 0) throw new Error(`rule 13: the base ${base} cannot be resolved (fetch it, for example with fetch-depth: 2)`);
  const sha = resolved.stdout.trim();
  if (git(['cat-file', '-e', `${sha}^{commit}`]).status !== 0) throw new Error(`rule 13: the base commit ${sha} is not present`);
  if (git(['cat-file', '-e', `${sha}:templates/criteria/index.json`]).status !== 0) return null;
  const shown = git(['show', `${sha}:templates/criteria/index.json`]);
  if (shown.status !== 0) throw new Error(`rule 13: cannot read the base index at ${sha}`);
  return JSON.parse(shown.stdout);
}

// ---------------------------------------------------------------------------
// The pre-deploy legacy check (section 11.4) and the bundle (section 14.3)

/** The pack version a legacy engagement resolves to (M0); throws on an unknown stamp. */
export function legacyVersion(legacy, stamp) {
  if (stamp === null || stamp === undefined) return legacy.fallbackVersion;
  if (!Object.hasOwn(legacy.stamps, stamp)) throw new Error(`Unknown rule-pack stamp ${JSON.stringify(stamp)}: add it to index.legacy.stamps first`);
  return legacy.stamps[stamp];
}

/**
 * Checks query rows {stamp, template} (the output of the section 11.4 queries,
 * as `wrangler d1 execute --json` prints it) against the index: every stamp is
 * known and every template id is an item of the pack version it resolves to.
 */
export function legacyCheck({ index, documents }, output) {
  const rows = (Array.isArray(output) ? output : [output]).flatMap(r => r?.results ?? (r && 'template' in r ? [r] : []));
  const errors = [];
  for (const row of rows) {
    let version;
    try {
      version = legacyVersion(index.legacy, row.stamp);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    const entry = index.documents.find(e => e.documentType === 'pack' && e.id === index.legacy.packId && e.version === version);
    const pack = entry && documents.get(entry.path);
    if (!pack) errors.push(`${index.legacy.packId} ${version} is not available`);
    else if (row.template !== null && row.template !== undefined && !pack.items.some(i => i.id === row.template))
      errors.push(`Template ${row.template} (stamp ${row.stamp ?? 'none'}) is not an item of ${index.legacy.packId} ${version}`);
  }
  return { rows: rows.length, errors: [...new Set(errors)] };
}

/**
 * The generated loader bundle: the index restricted to the documents it
 * carries, and every released or withdrawn document in index order (drafts
 * too with includeDrafts). Serialise it with `canonicalize`.
 *
 * A local draft preview (includeDrafts, never committed: check:sync compares
 * with the bundle built without drafts) gives each draft entry the JCS digest
 * of its document, so that an engagement can be pinned to a draft pack for
 * local development and browser checks. The loader labels such pins as
 * drafts, and coverage clamps every draft link to partial.
 */
export function buildBundle({ index, documents }, { includeDrafts = false } = {}) {
  const kept = index.documents
    .filter(e => includeDrafts || isReleased(e))
    .map(e => (e.status === 'draft' && documents.has(e.path) ? { ...e, sha256: digest(documents.get(e.path)) } : e));
  return {
    documentType: 'bundle',
    schemaVersion: '1.0.0',
    purpose: 'generated',
    title: 'Criteria bundle generated from templates/criteria (do not edit)',
    index: { ...index, documents: kept },
    documents: kept.map(e => documents.get(e.path)),
  };
}

/** Fills in the digest of every released or withdrawn entry that has none. Returns the paths stamped. */
export function stampDigests({ index, documents }) {
  const stamped = [];
  for (const entry of index.documents)
    if (isReleased(entry) && !entry.sha256 && documents.has(entry.path)) {
      entry.sha256 = digest(documents.get(entry.path));
      stamped.push(entry.path);
    }
  return stamped;
}

/**
 * templates/catalog.json stays the methodology file people edit, while the
 * build serves the pinned pack: the default pack must project back to it
 * exactly, otherwise an edit would silently have no effect, and the remedy is
 * a new methodology version converted with
 * templates/criteria/tools/convert-catalog.mjs. Since phase 2 (#61)
 * docs/obligation-subitems.json and templates/annex-iv-map.json are generated
 * from the default pack's AI Act framework and Annex IV map by `npm run sync`
 * in site-app, so a hand edit of either is drift too.
 */
export async function checkMethodologyDrift({ index, documents }, files = {}) {
  const { legacyCatalog, obligationCatalog } = await import(pathToFileURL(join(criteriaRoot, 'tools/convert-catalog.mjs')).href);
  const catalog = files.catalog ?? readJSON(resolve(workspace, 'templates/catalog.json'));
  const obligations = files.obligations ?? readJSON(resolve(workspace, 'docs/obligation-subitems.json'));
  const annexMap = files.annexMap ?? readJSON(resolve(workspace, 'templates/annex-iv-map.json'));
  const entry = index.documents.find(e => e.documentType === 'pack' && e.id === index.defaults.pack.id && e.version === index.defaults.pack.version);
  const pack = entry && documents.get(entry.path);
  if (!pack) return [];
  const remedy = 'raise methodologyVersion, run node templates/criteria/tools/convert-catalog.mjs --write and release the new versions in templates/criteria/index.json';
  const errors = [];
  if (canonicalize(legacyCatalog(pack)) !== canonicalize(catalog))
    errors.push(`drift: templates/catalog.json differs from the default pack ${pack.id} ${pack.version}, which the build serves; ${remedy}`);
  const set = pack.criteria.find(s => s.framework === 'eu-ai-act');
  const fwEntry = set && index.documents.find(e => e.documentType === 'framework' && e.id === set.framework && e.edition === set.edition && e.version === set.version);
  const framework = fwEntry && documents.get(fwEntry.path);
  if (framework && canonicalize(obligationCatalog(framework)) !== canonicalize(obligations))
    errors.push(`drift: docs/obligation-subitems.json differs from the framework ${framework.id} ${framework.version} of the default pack; it is generated, so run npm run sync in site-app`);
  const served = pack.features?.annexIvIndex ? servedAnnexMap({ index, documents }, pack) : null;
  if (served && canonicalize(served) !== canonicalize(annexMap))
    errors.push(`drift: templates/annex-iv-map.json differs from the Annex IV map of the default pack ${pack.id} ${pack.version}; it is generated, so run npm run sync in site-app`);
  return errors;
}

// ---------------------------------------------------------------------------
// CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const ajvPackage = option('--ajv-package');
  const validate = loadValidator(undefined, ajvPackage ? resolve(ajvPackage) : undefined);
  if (!existsSync(join(criteriaRoot, 'index.json'))) {
    console.log('PASS criteria schema compiles (no templates/criteria in this package)');
    process.exit(0);
  }
  const criteria = readCriteria();
  if (args.includes('--stamp')) {
    const stamped = stampDigests(criteria);
    writeFileSync(join(criteriaRoot, 'index.json'), JSON.stringify(criteria.index, null, 2) + '\n');
    console.log(stamped.length ? 'Stamped ' + stamped.join(', ') : 'Every released entry already has its digest');
  }
  const legacyFile = option('--legacy-check');
  if (legacyFile) {
    const result = legacyCheck(criteria, readJSON(resolve(legacyFile)));
    if (result.errors.length) {
      console.error(`FAIL legacy check over ${result.rows} rows:\n` + result.errors.map(e => '  - ' + e).join('\n'));
      process.exit(1);
    }
    console.log(`PASS legacy check: ${result.rows} rows resolve to known pack versions and items`);
    process.exit(0);
  }
  const { errors, warnings } = checkCriteria({ ...criteria, validate });
  errors.push(...(await checkMethodologyDrift(criteria)));
  const base = option('--base') ?? process.env.CRITERIA_BASE;
  if (base) {
    try {
      errors.push(...checkHistory(baseIndex(base), criteria.index));
    } catch (error) {
      errors.push(error.message);
    }
  }
  for (const warning of warnings) console.warn('WARN ' + warning);
  if (errors.length) {
    console.error(`FAIL ${errors.length} criteria problem(s):\n` + errors.map(e => '  - ' + e).join('\n'));
    process.exit(1);
  }
  console.log(
    `PASS ${criteria.documents.size} criteria documents: schema, integrity rules 1 to 12` + (base ? `, index history against ${base}` : ' (no --base: rule 13 skipped)'),
  );
}
