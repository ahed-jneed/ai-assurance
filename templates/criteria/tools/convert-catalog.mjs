/**
 * The one-off migration converter of docs/design/criteria-model.md section 11:
 * turns the methodology catalogue (templates/catalog.json) and the obligation
 * catalogue (docs/obligation-subitems.json) into the EU AI Act framework
 * document and pack #1, "EU AI Act (amended)". Deterministic: the same inputs
 * always give the same documents, and `legacyCatalog` and `obligationCatalog`
 * project them back to the inputs without loss (section 11.3).
 *
 *   node templates/criteria/tools/convert-catalog.mjs            print what it would write
 *   node templates/criteria/tools/convert-catalog.mjs --write    write the two documents
 *
 * The documents are written at the catalogue's methodology version. A document
 * that already exists is never overwritten with different content: released
 * documents are immutable, so a changed catalogue needs a new methodology
 * version. The index entries are added by hand after review (section 11.2).
 *
 * Since phase 2 (#61) the pack also carries the Annex IV map
 * (templates/annex-iv-map.json) as `annexIvMap`, and the obligation file and
 * the map are generated from the default pack by `npm run sync` in site-app,
 * so converting a new methodology version carries both forward unchanged.
 * Pack #1 2026.11.2 was converted before the map was embedded; 2026.11.3 is
 * that pack with the map added. The module's projections and `serialise` are
 * also what the sync script generates the two files with.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');

export const FRAMEWORK_ID = 'eu-ai-act';
export const PACK_ID = 'eu-ai-act-amended';

const SERVICE_DESK = 'https://ai-act-service-desk.ec.europa.eu/en/ai-act/';
/** Headings the design checked against the Service Desk on 5 November 2026. */
const CHECKED = new Set(['9', '16', '17', '50']);
/**
 * Our curated table of official article and annex headings (the AI Act is
 * full_text under Decision 2011/833/EU). Only the four of CHECKED were checked
 * against the Commission AI Act Service Desk; the others are marked unverified
 * until the legal review (#57) checks them.
 */
const HEADINGS = {
  2: 'Scope',
  3: 'Definitions',
  4: 'AI literacy',
  '4a': 'Processing of special categories of personal data for bias detection and correction',
  5: 'Prohibited AI practices',
  6: 'Classification rules for high-risk AI systems',
  9: 'Risk management system',
  10: 'Data and data governance',
  11: 'Technical documentation',
  12: 'Record-keeping',
  13: 'Transparency and provision of information to deployers',
  14: 'Human oversight',
  15: 'Accuracy, robustness and cybersecurity',
  16: 'Obligations of providers of high-risk AI systems',
  17: 'Quality management system',
  18: 'Documentation keeping',
  19: 'Automatically generated logs',
  20: 'Corrective actions and duty of information',
  22: 'Authorised representatives of providers of high-risk AI systems',
  23: 'Obligations of importers',
  24: 'Obligations of distributors',
  25: 'Responsibilities along the AI value chain',
  26: 'Obligations of deployers of high-risk AI systems',
  27: 'Fundamental rights impact assessment for high-risk AI systems',
  40: 'Harmonised standards and standardisation deliverables',
  41: 'Common specifications',
  43: 'Conformity assessment',
  47: 'EU declaration of conformity',
  48: 'CE marking',
  49: 'Registration',
  50: 'Transparency obligations for providers and deployers of certain AI systems',
  72: 'Post-market monitoring by providers and post-market monitoring plan for high-risk AI systems',
  73: 'Reporting of serious incidents',
  111: 'AI systems already placed on the market or put into service and general-purpose AI models already placed on the market',
  113: 'Entry into force and application',
  'Annex I': 'List of Union harmonisation legislation',
  'Annex III': 'High-risk AI systems referred to in Article 6(2)',
  'Annex IV': 'Technical documentation referred to in Article 11(1)',
};
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13 };

/** "Art.4a" → {kind, key, number}; "Annex IV" → the annex. Anything else is unsupported. */
function parseRef(ref) {
  let m = /^Art\.(\d+)([a-z]?)$/.exec(ref);
  if (m) return { kind: 'article', key: m[1] + m[2], number: Number(m[1]), suffix: m[2] };
  m = /^Annex ([IVX]+)$/.exec(ref);
  if (m && ROMAN[m[1]]) return { kind: 'annex', key: 'Annex ' + m[1], roman: m[1], number: ROMAN[m[1]] };
  throw new Error(`Unsupported catalogue reference ${JSON.stringify(ref)}`);
}
const articleNodeId = parsed => (parsed.kind === 'article' ? `AIA-ART-${parsed.number}${parsed.suffix.toUpperCase()}` : `AIA-ANNEX-${parsed.roman}`);
/** The article or annex an obligation item belongs to: the leading number of `article`, or Annex IV. */
function obligationParent(article) {
  const annex = /^Annex ([IVX]+)/.exec(article);
  if (annex) return `AIA-ANNEX-${annex[1]}`;
  const m = /^(\d+)([a-z]?)/.exec(article);
  if (!m) throw new Error(`Cannot place obligation article ${JSON.stringify(article)}`);
  return `AIA-ART-${m[1]}${m[2].toUpperCase()}`;
}
const obligationRef = article => (article.startsWith('Annex') ? article : 'Art. ' + article);

/** Item fields of an obligation subitem that the framework node has a field for. */
const NODE_FIELDS = ['code', 'article', 'title', 'actor', 'trigger', 'evidenceCategories', 'reviewNote'];
/** Top-level fields of the obligation file that are framework fields, not compat. */
const FRAMEWORK_FIELDS = ['items', 'triggerProfiles', 'factTypes'];

const MIGRATED_JUSTIFICATION = (item, refs) =>
  `Migrated from the catalogue regulatoryRefs of ${item.id} (${refs.join(', ')}). The catalogue does not say how much of the provision the paper tests, so the link claims partial overlap only until a methodology reviewer replaces it.`;

/**
 * Converts the catalogue and obligation file into {framework, pack}, with the
 * Annex IV map in the pack when one is given. Inputs are parsed JSON; they
 * are not modified.
 */
export function convertCatalog(catalog, obligations, annexMap) {
  const snapshot = catalog.regulatorySnapshot;
  const version = catalog.methodologyVersion;
  const edition = snapshot.celex;
  const obligationSource = obligations.source?.url;
  const children = new Map();
  for (const o of obligations.items) {
    const parent = obligationParent(o.article);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(o);
  }

  // Article and annex nodes, one per distinct catalogue reference, articles
  // numerically and then annexes.
  const refs = [...new Set(catalog.items.flatMap(i => i.regulatoryRefs))].map(ref => ({ ref, parsed: parseRef(ref) }));
  refs.sort((a, b) =>
    a.parsed.kind !== b.parsed.kind
      ? a.parsed.kind === 'article'
        ? -1
        : 1
      : a.parsed.number - b.parsed.number || a.parsed.key.localeCompare(b.parsed.key),
  );
  const articleIds = new Set(refs.map(r => articleNodeId(r.parsed)));
  for (const parent of children.keys())
    if (!articleIds.has(parent)) throw new Error(`Obligation items under ${parent}, which no catalogue item cites`);
  const requirements = [];
  for (const { ref, parsed } of refs) {
    const id = articleNodeId(parsed);
    const title = HEADINGS[parsed.key];
    if (!title) throw new Error(`No heading for ${ref} in the converter's table`);
    const checked = parsed.kind === 'article' && CHECKED.has(parsed.key);
    const own = children.get(id) ?? [];
    requirements.push({
      id,
      ref: parsed.kind === 'article' ? `Art. ${parsed.key}` : parsed.key,
      title,
      type: own.length ? 'group' : 'requirement',
      ...(own.length ? { exhaustive: false } : {}),
      aliases: [ref],
      provenance: checked
        ? {
            source: `${SERVICE_DESK}article-${parsed.key}`,
            sourceKind: 'official_consolidation',
            verification: 'verified',
            checkedAt: '2026-11-05',
            legalReview: 'not_required',
            note: 'Article heading as shown by the Commission AI Act Service Desk, which reproduces the EUR-Lex consolidated text of 27 July 2026.',
          }
        : {
            source: snapshot.consolidatedTextUrl,
            sourceKind: 'official_consolidation',
            verification: 'unverified',
            legalReview: 'required',
            note: 'Heading from the converter table (templates/criteria/tools/convert-catalog.mjs); not yet checked against the consolidated text.',
          },
    });
    for (const o of own) requirements.push(obligationNode(o, id, obligations));
  }

  const { items: _items, triggerProfiles, factTypes, ...rest } = obligations;
  const framework = {
    documentType: 'framework',
    schemaVersion: '1.0.0',
    id: FRAMEWORK_ID,
    edition,
    version,
    title: 'Regulation (EU) 2024/1689 (Artificial Intelligence Act), consolidated text as amended by Regulation (EU) 2026/1744',
    shortTitle: 'EU AI Act (amended)',
    kind: 'legislation',
    publisher: 'European Union',
    jurisdiction: 'EU',
    status: 'in_force',
    consolidatedAsOf: snapshot.consolidatedAsOf,
    researchedAsOf: snapshot.researchedAsOf,
    amendingActs: [snapshot.amendingRegulation],
    sources: [
      { role: 'official_text', url: snapshot.consolidatedTextUrl },
      { role: 'authentic_amendment', url: snapshot.authenticAmendmentUrl },
      { role: 'explorer', url: snapshot.explorerUrl },
      { role: 'timeline', url: snapshot.timelineUrl },
      ...(obligationSource ? [{ role: 'consolidated_html', url: obligationSource }] : []),
    ],
    licence: {
      holder: 'European Union',
      textPolicy: 'full_text',
      status: 'confirmed',
      basis:
        'Commission Decision 2011/833/EU on the reuse of Commission documents: reuse is authorised provided the source is acknowledged. Consolidated texts are research aids; the Official Journal acts are authentic.',
      url: 'https://eur-lex.europa.eu/eli/dec/2011/833/oj',
      attribution: '© European Union, https://eur-lex.europa.eu',
    },
    applicationSummary: snapshot.applicationDates.map(d => ({ reference: d.title, date: d.date })),
    guidance: snapshot.guidance,
    triggerProfiles,
    factTypes,
    requirements,
    notes: `Converted from templates/catalog.json (methodology ${version}, rule pack ${snapshot.rulePackVersion}) and docs/obligation-subitems.json (${obligations.catalogVersion}) by templates/criteria/tools/convert-catalog.mjs. Article nodes come from the catalogue regulatoryRefs, child requirements from the obligation catalogue, which is selective, so every group is non-exhaustive. The dated application entries of the rule pack stay in the pack's compat.catalog.regulatorySnapshot; applicationSummary lists their titles and dates. Requirement-level applicability rows are not yet derived from them.`,
    compat: { obligations: { ...rest, order: obligations.items.map(o => o.code) } },
  };

  const objectives = [];
  const items = catalog.items.map(item => {
    if (item.kind !== 'working_paper') return { ...structuredClone(item), objectiveIds: [] };
    const objectiveId = `CO-${item.id}`;
    objectives.push({
      id: objectiveId,
      statement: item.objective,
      addresses: item.regulatoryRefs.map(ref => ({
        requirement: `${FRAMEWORK_ID}:${articleNodeId(parseRef(ref))}`,
        relationship: 'intersects_with',
        rationale: 'semantic',
        justification: MIGRATED_JUSTIFICATION(item, [ref]),
        origin: 'migrated',
      })),
    });
    return { ...structuredClone(item), objectiveIds: [objectiveId] };
  });
  const papers = catalog.items.filter(i => i.kind === 'working_paper').length;
  const pack = {
    documentType: 'pack',
    schemaVersion: '1.0.0',
    id: PACK_ID,
    version,
    title: 'EU AI Act (amended)',
    summary: `Audit programme for AI systems under Regulation (EU) 2024/1689 as amended by Regulation (EU) 2026/1744: the platform's existing ${papers} working papers and ${catalog.items.length - papers} memos, migrated without change.`,
    kind: 'audit_programme',
    methodologyVersion: version,
    criteria: [{ framework: FRAMEWORK_ID, edition, version, role: 'primary' }],
    defaults: structuredClone(catalog.defaults),
    roles: {
      limitationMemo: 'MEM-EX-01',
      diagnosticPaperByResultArticle: { 10: 'WP-A10-02', '*': 'WP-A15-01' },
      externalExecutionPaper: 'WP-A15-01',
    },
    features: { annexIvIndex: true, aiActClassification: true, obligationAssessments: true },
    reporting: {
      regulatorySource: 'https://eur-lex.europa.eu/eli/reg/2024/1689',
      limitations:
        "Diagnostic and assurance conclusions do not constitute a notified-body conformity assessment or legal certification. The platform's diagnostics evaluate traditional ML systems; they do not yet evaluate generative AI outputs, so conclusions on generative systems rest on the auditor's own procedures and evidence.",
    },
    controlObjectives: objectives,
    items,
    ...(annexMap ? { annexIvMap: structuredClone(annexMap) } : {}),
    notes: `Pack #1, converted from templates/catalog.json (methodology ${version}) by templates/criteria/tools/convert-catalog.mjs. Every link is migrated from the catalogue regulatoryRefs and claims partial overlap only (section 9.9 of docs/design/criteria-model.md).`,
    compat: { catalog: { schemaVersion: catalog.schemaVersion, regulatorySnapshot: structuredClone(snapshot) } },
  };
  return { framework, pack };
}

function obligationNode(o, parent, obligations) {
  const extensions = Object.fromEntries(Object.entries(o).filter(([key]) => !NODE_FIELDS.includes(key)));
  return {
    id: o.code,
    ref: obligationRef(o.article),
    title: o.title,
    type: 'requirement',
    parent,
    actors: [...o.actor],
    trigger: structuredClone(o.trigger),
    evidenceCategories: [...o.evidenceCategories],
    ...(o.reviewNote !== undefined ? { reviewNote: o.reviewNote } : {}),
    ...(Object.keys(extensions).length ? { extensions: structuredClone(extensions) } : {}),
    provenance: {
      source: obligations.source?.url,
      sourceKind: 'official_consolidation',
      verification: 'unverified',
      legalReview: 'required',
      note: `Migrated from docs/obligation-subitems.json (catalogVersion ${obligations.catalogVersion}, status ${obligations.status}).`,
    },
  };
}

/** The catalogue a pack projects to (section 11.3). Without compat.catalog the snapshot is empty. */
export function legacyCatalog(pack) {
  return {
    schemaVersion: pack.compat?.catalog?.schemaVersion ?? '1.0.0',
    methodologyVersion: pack.methodologyVersion,
    regulatorySnapshot: pack.compat?.catalog?.regulatorySnapshot ?? {},
    defaults: pack.defaults,
    items: pack.items.map(({ objectiveIds, phase, derivedFrom, ...item }) => item),
  };
}

/** The obligation catalogue a framework projects to (section 11.3), or null without compat.obligations. */
export function obligationCatalog(framework) {
  const compat = framework.compat?.obligations;
  if (!compat) return null;
  const { order, ...fields } = compat;
  const nodes = new Map(framework.requirements.map(r => [r.id, r]));
  return {
    ...fields,
    triggerProfiles: framework.triggerProfiles,
    factTypes: framework.factTypes,
    items: order.map(code => {
      const n = nodes.get(code);
      return {
        code: n.id,
        article: n.ref.startsWith('Art. ') ? n.ref.slice(5) : n.ref,
        title: n.title,
        actor: n.actors,
        trigger: n.trigger,
        evidenceCategories: n.evidenceCategories,
        ...(n.reviewNote !== undefined ? { reviewNote: n.reviewNote } : {}),
        ...n.extensions,
      };
    }),
  };
}

/** Two-space JSON with a final newline and LF line endings. */
export const serialise = document => JSON.stringify(document, null, 2) + '\n';

export const documentPaths = ({ framework, pack }) => ({
  framework: `frameworks/${framework.id}/${framework.edition}/${framework.version}.json`,
  pack: `packs/${pack.id}/${pack.version}.json`,
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = file => JSON.parse(readFileSync(resolve(repo, file), 'utf8'));
  const converted = convertCatalog(read('templates/catalog.json'), read('docs/obligation-subitems.json'), read('templates/annex-iv-map.json'));
  const paths = documentPaths(converted);
  const write = process.argv.includes('--write');
  let failed = false;
  for (const kind of ['framework', 'pack']) {
    const target = resolve(repo, 'templates/criteria', paths[kind]);
    const text = serialise(converted[kind]);
    if (existsSync(target)) {
      const same = JSON.stringify(JSON.parse(readFileSync(target, 'utf8'))) === JSON.stringify(converted[kind]);
      console.log(`${paths[kind]}: ${same ? 'unchanged' : 'EXISTS WITH DIFFERENT CONTENT'}`);
      if (!same) failed = true;
      continue;
    }
    if (write) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
      console.log(`Wrote ${paths[kind]}`);
    } else console.log(`Would write ${paths[kind]} (${text.length} bytes); pass --write`);
  }
  if (failed) {
    console.error('A document exists with different content. Released documents never change: raise the catalogue methodologyVersion and convert again.');
    process.exit(1);
  }
}
