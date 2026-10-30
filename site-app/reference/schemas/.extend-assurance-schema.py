"""Add authenticated external projections; callable and idempotent on regeneration."""
import copy
import json
from pathlib import Path


def extend_schema(schema):
    defs = schema['$defs']
    defs['predictionDataset']['properties']['cardPin'] = {
        'type': 'object', 'additionalProperties': False,
        'required': ['recordId', 'sha256', 'card'], 'properties': {
            'recordId': {'$ref': '#/$defs/id'},
            'sha256': {'$ref': '#/$defs/sha256'},
            'card': {'type': 'object', 'description': 'Frozen governance card validated by the application.'}}}
    external = copy.deepcopy(defs['hostedRun'])
    external['description'] = ('Authenticated external attempt projected into an audit run. '
        'Exact external report bytes remain preserved separately; application validation '
        'enforces request, lease, nonce, input and authority bindings.')
    external['properties']['contractVersion'] = {'const': '1.2'}
    external['properties']['externalJobId'] = {'$ref': '#/$defs/id'}
    external['required'] = list(dict.fromkeys(external['required'] +
        ['externalJobId', 'procedureBinding', 'profileId', 'startedAt', 'completedAt']))
    external['properties']['state'] = {'const': 'succeeded'}
    manifest = copy.deepcopy(defs['runManifest'])
    manifest['properties']['executionMode'] = {'enum': ['provided_predictions', 'auditor_model', 'client_local']}
    manifest['properties']['lineage'] = {'const': 'authenticated_external_attempt'}
    manifest['properties']['model'] = {'$ref': '#/$defs/registeredModel'}
    manifest['properties']['profile'] = {'$ref': '#/$defs/evaluationProfile'}
    manifest['properties']['testDefinitionVersion'] = {'type': 'string', 'minLength': 1, 'maxLength': 300}
    dataset = copy.deepcopy(defs['predictionDataset'])
    dataset['description'] = ('External immutable input snapshot. rowCount is the maximum '
        'reported metric sample size in this projection, not a verified source-population census.')
    dataset['properties']['size']['maximum'] = 104857600
    dataset['properties']['rowCount'].update(minimum=0, maximum=1000000)
    defs['externalPredictionDataset'] = dataset
    manifest['properties']['dataset'] = {'$ref': '#/$defs/externalPredictionDataset'}
    defs['externalRunManifest'] = manifest
    external['properties']['manifest'] = {'$ref': '#/$defs/externalRunManifest'}
    external['properties']['provenance'] = {'type': 'object', 'additionalProperties': False,
        'required': ['inputHashes', 'runnerVersion', 'policyVersion'], 'properties': {
            'inputHashes': {'type': 'object', 'required': ['dataset', 'modelArtifact', 'system',
                'protocol', 'auditBinding', 'externalRequest', 'externalResult'],
                'additionalProperties': {'$ref': '#/$defs/sha256'}},
            'runnerVersion': {'type': 'string', 'minLength': 1, 'maxLength': 300},
            'policyVersion': {'type': 'string', 'minLength': 1, 'maxLength': 300}}}
    # Preserve the worker's full metric evidence rather than flattening it.
    metric = copy.deepcopy(defs['metric'])
    metric['properties']['name'].update(maxLength=300)
    metric['properties']['unit'].update(maxLength=100)
    metric['properties']['sampleSize'].update(maximum=1000000)
    defs['externalMetric'] = metric
    result = {'type': 'object', 'additionalProperties': False,
        'required': ['testId', 'label', 'article', 'outcome', 'metrics', 'limitations'], 'properties': {
            'testId': copy.deepcopy(external['properties']['suite']['items']),
            'label': {'type': 'string', 'minLength': 1, 'maxLength': 300},
            'article': {'enum': ['10', '15']},
            'outcome': {'enum': ['pass', 'fail', 'inconclusive', 'not_applicable']},
            'metrics': {'type': 'array', 'items': {'$ref': '#/$defs/externalMetric'}, 'maxItems': 100},
            'limitations': {'type': 'array', 'items': {'type': 'string', 'minLength': 1, 'maxLength': 10000}, 'maxItems': 100}},
        'allOf': [
            {'if': {'properties': {'outcome': {'enum': ['pass', 'fail']}}},
                'then': {'properties': {'metrics': {'minItems': 1}}}},
            {'if': {'properties': {'outcome': {'enum': ['inconclusive', 'not_applicable']}}},
                'then': {'properties': {'limitations': {'minItems': 1}}}},
            {'if': {'properties': {'testId': {'enum': ['performance', 'regression']}}},
                'then': {'properties': {'article': {'const': '15'}}},
                'else': {'properties': {'article': {'const': '10'}}}}]}
    defs['externalHostedResult'] = result
    external['properties']['results']['items'] = {'$ref': '#/$defs/externalHostedResult'}
    defs['externalAuditRun'] = external
    ref = {'$ref': '#/$defs/externalAuditRun'}
    if ref not in schema['oneOf']:
        schema['oneOf'].append(ref)
    schema['$id'] = 'urn:ai-assurance:test-run:1.2'
    schema['description'] = ('Version-discriminated diagnostic contract: legacy 1.0, hosted 1.1 '
        'and authenticated external audit projection 1.2. Schema validity is distinct from '
        'result origin, input custody, statistical suitability and legal sufficiency.')
    return schema


if __name__ == '__main__':
    file = Path(__file__).with_name('test-run.schema.json')
    file.write_text(json.dumps(extend_schema(json.loads(file.read_text(encoding='utf-8'))),
        indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
