"""Statistics 1.0.0 branches of the run schema; callable and idempotent on regeneration.

docs/design/audit-statistics.md section 11: engine report 1.3 (#21 E2) and the
compiled external audit run 1.5 (#21 E4). Every result that statistics 1.0.0
governs carries a decision object and the shared metric shape; results it does
not govern (drift, unavailable capabilities, model-backed procedures) keep the
1.0 result shape and carry no decision. The plan definition is embedded from
schemas/statistics-plan.schema.json.
"""
import copy
import json
from pathlib import Path

REASONS = [
    'below_minimum_sample_size', 'undefined_zero_denominator', 'single_class', 'below_minimum_class_count',
    'group_suppressed_below_minimum', 'group_below_minimum_size', 'insufficient_coverage', 'empty_declared_group',
    'insufficient_groups', 'too_many_groups', 'small_cell_exact_test_not_significant', 'chance_exact_test_not_significant',
    'interval_straddles_band', 'within_criterion_multiplicity', 'multiplicity_adjustment', 'estimate_on_band_boundary',
    'degenerate_interval', 'no_threshold', 'undecidable_metric', 'invalid_band', 'interval_requires_engine',
    'clustered_design_requires_engine', 'bootstrap_insufficient_valid_replicates', 'bootstrap_budget_exceeded',
    'small_cell_clustered']
METHODS = ['wilson', 'newcombe_hybrid_score', 'katz_log', 'koopman_score', 'mover_wilson', 'jaccard_wilson',
    'jaccard_wilson_bonferroni', 'wilson_bonferroni_mean', 'normal_approximation', 'normal_approximation_mse',
    'percentile_bootstrap', 'cluster_percentile_bootstrap', 'worst_member_bounds']
KINDS = ['performance', 'multiclass_performance', 'regression_performance', 'group_comparison', 'calibration']
# Section 11.5 limits.
MAX_METRICS, MAX_SLICES, MAX_NAME, MAX_RESULTS = 2451, 1000, 20480, 20


def ref(name):
    return {'$ref': '#/$defs/' + name}


def st(minimum=0, maximum=5000):
    return {'type': 'string', 'minLength': minimum, 'maxLength': maximum}


def nullable(value):
    return {'anyOf': [value, {'type': 'null'}]}


def obj(properties, required=None):
    return {'type': 'object', 'additionalProperties': False, 'properties': properties, 'required': list(properties) if required is None else required}


def arr(items, minimum=0, maximum=None, unique=False):
    value = {'type': 'array', 'items': items, 'minItems': minimum}
    if maximum is not None:
        value['maxItems'] = maximum
    if unique:
        value['uniqueItems'] = True
    return value


RATIO = {'type': 'number', 'minimum': 0, 'maximum': 1}
COUNT = {'type': 'integer', 'minimum': 0}


def _rename(value, names):
    if isinstance(value, dict):
        return {key: (('#/$defs/' + names[item.split('/')[-1]]) if key == '$ref' else _rename(item, names)) for key, item in value.items()}
    if isinstance(value, list):
        return [_rename(item, names) for item in value]
    return value


def add_plan(defs):
    """Embed the live plan schema as statisticsPlan, its own definitions prefixed with 'plan'."""
    plan = json.loads(Path(__file__).with_name('statistics-plan.schema.json').read_text(encoding='utf-8'))
    inner = plan.pop('$defs')
    names = {name: 'plan' + name[0].upper() + name[1:] for name in inner}
    for name, value in inner.items():
        defs[names[name]] = _rename(value, names)
    for key in ('$schema', '$id', 'title'):
        plan.pop(key, None)
    defs['statisticsPlan'] = _rename(plan, names)


def add_shapes(defs):
    band = obj({'lower': {'type': ['number', 'null']}, 'upper': {'type': ['number', 'null']}})
    defs['statisticsBand'] = band
    defs['statisticsInterval'] = obj({'lower': {'type': 'number'}, 'upper': {'type': 'number'}, 'level': {'type': 'number', 'exclusiveMinimum': 0, 'exclusiveMaximum': 1}, 'method': {'enum': METHODS}})
    defs['statisticsReasons'] = arr({'enum': REASONS}, 0, len(REASONS))
    defs['statisticsMetricDetails'] = obj({
        'role': {'enum': ['headline', 'member', 'descriptive']}, 'metric': st(1, 100),
        'subject': nullable(st(0, 5000)), 'comparator': nullable(st(0, 5000)),
        'counts': {'type': ['object', 'null']}, 'band': nullable(ref('statisticsBand')),
        'status': {'enum': ['evaluated', 'undefined', 'insufficient_support', 'suppressed']},
        'direction': {'enum': ['pass', 'fail', 'none']}, 'smallCell': {'type': 'boolean'},
        'fisherExactP': nullable(RATIO), 'chanceExactP': nullable(RATIO), 'reasons': ref('statisticsReasons')})
    defs['statisticsMetric'] = obj({
        'name': st(1, MAX_NAME), 'value': {'type': ['number', 'null']}, 'unit': st(1, 100), 'sampleSize': COUNT,
        'numerator': nullable(COUNT), 'denominator': nullable(COUNT), 'threshold': nullable(ref('thresholdRule')),
        'confidenceInterval': nullable(ref('statisticsInterval')), 'slices': arr({'type': 'object'}, 0, MAX_SLICES),
        'details': ref('statisticsMetricDetails'), 'pValue': nullable(RATIO)})
    # Section 4.4: descriptive entries carry no band, direction or p-value.
    defs['statisticsMetric']['allOf'] = [{'if': {'properties': {'details': {'properties': {'role': {'const': 'descriptive'}}}}}, 'then': {'properties': {'pValue': {'type': 'null'}, 'details': {'properties': {'band': {'type': 'null'}, 'direction': {'const': 'none'}}}}}}]
    coverage = obj({'eligibleRows': COUNT, 'populationRows': COUNT, 'unknownGroupRows': COUNT, 'value': RATIO, 'minimum': RATIO})
    library = obj({'id': st(1, 300), 'version': {'type': 'integer', 'minimum': 1}, 'legalStatus': {'enum': ['screening_heuristic', 'reporting_only', 'no_legal_safe_harbour']}, 'caveat': st(1, 5000)})
    defs['statisticsDecision'] = obj({
        'statisticsVersion': {'const': '1.0.0'}, 'confidenceLevel': {'enum': [0.9, 0.95, 0.99]},
        'role': {'enum': ['confirmatory', 'exploratory']}, 'kind': {'enum': KINDS},
        'direction': {'enum': ['pass', 'fail', 'none']}, 'pValue': RATIO, 'adjustedPValue': RATIO,
        'adjustment': {'enum': ['bonferroni', 'benjamini_hochberg']}, 'familySize': {'type': 'integer', 'minimum': 1, 'maximum': MAX_RESULTS},
        'unadjustedOutcome': {'enum': ['pass', 'fail', 'inconclusive']}, 'decidingMemberId': nullable(st(1, MAX_NAME)),
        'sampleSize': COUNT, 'coverage': nullable(coverage), 'suppressedGroups': nullable(arr(obj({'group': st(0, 5000), 'n': COUNT}), 0, 1000)),
        'libraryEntry': nullable(library), 'reasons': ref('statisticsReasons')})
    decision_rules = [
        {'if': {'properties': {'role': {'const': 'confirmatory'}}}, 'then': {'properties': {'adjustment': {'const': 'bonferroni'}}}, 'else': {'properties': {'adjustment': {'const': 'benjamini_hochberg'}}}},
        {'if': {'properties': {'direction': {'const': 'none'}}}, 'then': {'properties': {'unadjustedOutcome': {'const': 'inconclusive'}}}},
    ]
    defs['statisticsDecision']['allOf'] = decision_rules
    result = obj({'testId': ref('id'), 'label': st(1, 300), 'article': {'enum': ['10', '15']},
        'outcome': {'enum': ['pass', 'fail', 'inconclusive']}, 'metrics': arr(ref('statisticsMetric'), 0, MAX_METRICS),
        'limitations': arr(st(1, 10000), 0, 1000), 'decision': ref('statisticsDecision')})
    # The article follows the criterion kind (section 11.2); an outcome needs evidence or a reason.
    result['allOf'] = [
        {'if': {'properties': {'decision': {'properties': {'kind': {'const': 'group_comparison'}}}}}, 'then': {'properties': {'article': {'const': '10'}}}, 'else': {'properties': {'article': {'const': '15'}}}},
        {'if': {'properties': {'outcome': {'enum': ['pass', 'fail']}}}, 'then': {'properties': {'metrics': {'minItems': 1}}}},
        {'if': {'properties': {'outcome': {'const': 'inconclusive'}}}, 'then': {'properties': {'limitations': {'minItems': 1}}}},
    ]
    defs['statisticsResult'] = result


def add_engine_report(schema):
    """Engine report contract 1.3 (section 11.1): the legacy engine shape plus decisions and the plan."""
    defs = schema['$defs']
    config = copy.deepcopy(defs['pythonConfig'])
    config['properties']['contractVersion'] = {'enum': ['1.0', '1.3']}
    config['properties']['statistics'] = nullable(ref('statisticsPlan'))
    # Configuration 1.3: an explicit plan, empty legacy thresholds and minimums at or above the floors.
    floors = {'minSampleSize': 30, 'minGroupSize': 30, 'minClassCount': 10}
    config['allOf'] = config.get('allOf', []) + [
        {'if': {'properties': {'contractVersion': {'const': '1.3'}}}, 'then': {'required': ['statistics'], 'properties': {'statistics': ref('statisticsPlan'), 'thresholds': {'properties': {'values': {'maxProperties': 0}}}, **{key: {'minimum': value} for key, value in floors.items()}}}},
    ]
    defs['pythonConfigStatistics'] = config
    report = copy.deepcopy(defs['legacyRun'])
    report.pop('allOf', None)
    report.pop('description', None)
    props = report['properties']
    props['contractVersion'] = {'const': '1.3'}
    props['state'] = {'const': 'succeeded'}
    props['outcome'] = {'enum': ['pass', 'fail', 'inconclusive', 'not_applicable']}
    props['reviewFlags'] = arr(ref('id'), 0, MAX_RESULTS, True)
    props['configuration'] = ref('pythonConfigStatistics')
    # A result without a decision (drift, unavailable capabilities, model-backed procedures) keeps the 1.0
    # shape; its metrics never carry a statistics role, so a decided result cannot drop its decision.
    undecided = copy.deepcopy(defs['result'])
    undecided['properties']['metrics'] = {'type': 'array', 'items': {'allOf': [ref('metric'), {'properties': {'details': {'not': {'type': 'object', 'required': ['role']}}}}]}}
    defs['undecidedResult'] = undecided
    props['results'] = arr({'oneOf': [ref('statisticsResult'), ref('undecidedResult')]}, 1)
    props['provenance'] = copy.deepcopy(props['provenance'])
    props['provenance']['properties']['statisticsPlanSha256'] = nullable(ref('sha256'))
    props['provenance']['required'] = list(dict.fromkeys(props['provenance']['required'] + ['statisticsPlanSha256']))
    report['required'] = list(dict.fromkeys(report['required'] + ['overallOutcome', 'reviewFlags', 'results', 'configuration', 'startedAt', 'completedAt']))
    report['allOf'] = [{'if': {'properties': {'outcome': {'const': value}}}, 'then': {'properties': {'overallOutcome': {'const': value}}}} for value in ('pass', 'fail', 'inconclusive', 'not_applicable')]
    report['description'] = ('Engine report under statistics 1.0.0: every performance, calibration and group criterion of the recorded plan '
        'is one result with a decision; drift, unavailable capabilities and model-backed procedures keep the 1.0 result shape without one.')
    defs['engineReport'] = report


def add_external_run(schema):
    """Compiled external audit run 1.5 (section 11.1, #21 E4 with #22 H4): the 1.2 projection with results
    keyed by criterion id, each carrying the engine's copied decision, the plan in manifest.statistics and
    its hash in provenance.inputHashes.statisticsPlan. A profile with a stored plan (schemaVersion 1.1)
    keeps only column mappings and the declared labels in config (section 9.1)."""
    defs = schema['$defs']
    # Interim until #22 (H4) compiles 1.5 runs: worker 1.2.0 copies the engine's decision into every hosted
    # result, and the platform still compiles those results into a 1.2 run. The 1.2 result therefore
    # admits that copied decision; its other rules are unchanged.
    defs['externalHostedResult']['properties']['decision'] = ref('statisticsDecision')
    profile = copy.deepcopy(defs['evaluationProfile'])
    profile['properties'].update(schemaVersion={'const': '1.1'}, config=ref('hostedPlanConfig'), statistics=ref('statisticsPlan'))
    profile['required'] = list(dict.fromkeys(profile['required'] + ['statistics']))
    profile.pop('allOf', None)
    defs['evaluationProfilePlan'] = profile
    thresholds = obj({'source': {'const': 'internal_policy'}, 'policyId': st(1, 300), 'policyVersion': st(1, 300), 'frozenAt': {'type': 'string', 'format': 'date-time'}, 'frozenBy': ref('actorId'), **copy.deepcopy(defs['hostedPlanConfig']['properties'])}, ['source', 'policyId', 'policyVersion', 'frozenAt', 'frozenBy'])
    defs['planThresholds'] = thresholds
    manifest = copy.deepcopy(defs['externalRunManifest'])
    manifest['properties']['profile'] = {'anyOf': [ref('evaluationProfile'), ref('evaluationProfilePlan')]}
    manifest['properties']['statistics'] = ref('statisticsPlan')
    manifest['required'] = list(dict.fromkeys(manifest['required'] + ['statistics']))
    defs['externalStatisticsManifest'] = manifest
    run = copy.deepcopy(defs['externalAuditRun'])
    props = run['properties']
    props['contractVersion'] = {'const': '1.5'}
    props['config'] = {'anyOf': [ref('hostedConfig'), ref('hostedPlanConfig')]}
    props['thresholds'] = {'anyOf': [ref('hostedThresholds'), ref('planThresholds')]}
    props['manifest'] = ref('externalStatisticsManifest')
    props['results'] = arr(ref('statisticsResult'), 0, MAX_RESULTS)
    props['reviewFlags'] = arr(ref('id'), 0, MAX_RESULTS, True)
    props['provenance'] = copy.deepcopy(props['provenance'])
    props['provenance']['properties']['inputHashes']['required'] = list(dict.fromkeys(props['provenance']['properties']['inputHashes']['required'] + ['statisticsPlan']))
    run['required'] = list(dict.fromkeys(run['required'] + ['reviewFlags', 'overallOutcome']))
    kinds = {'Binary classification': ['performance', 'group_comparison'], 'Multiclass classification': ['multiclass_performance'], 'Regression': ['regression_performance']}
    rules = []
    for rule in run['allOf']:
        results = rule.get('then', {}).get('properties', {}).get('results', {}).get('items', {}).get('properties', {}).get('testId')
        if results is not None:
            # The per-task rule on result test ids becomes a rule on decision.kind (section 11.2, H2/H4).
            task = rule['if']['properties']['task']['const']
            rule = copy.deepcopy(rule)
            rule['then']['properties']['results'] = {'items': {'properties': {'decision': {'properties': {'kind': {'enum': kinds[task]}}}}}}
        rules.append(rule)
    run['allOf'] = rules
    run['description'] = ('Authenticated external attempt under statistics 1.0.0: results are the criteria of the recorded plan, each '
        'with the engine decision the worker copied; exploratory criteria never change the outcome and failing ones are reviewFlags.')
    defs['externalStatisticsRun'] = run
    branch = ref('externalStatisticsRun')
    if branch not in schema['oneOf']:
        schema['oneOf'].append(branch)
    schema['description'] = ('Version-discriminated diagnostic contract: legacy 1.0, hosted 1.1, authenticated external audit '
        'projection 1.2, engine report 1.3 and compiled external audit run 1.5 under statistics 1.0.0 '
        '(docs/design/audit-statistics.md). Schema validity is distinct from result origin, input custody, statistical '
        'suitability and legal sufficiency.')
    return schema


def add_statistics(schema):
    defs = schema['$defs']
    add_plan(defs)
    add_shapes(defs)
    add_engine_report(schema)
    branch = ref('engineReport')
    if branch not in schema['oneOf']:
        schema['oneOf'].append(branch)
    return schema
