"""Compute synthetic worker evidence and the compiled external run 1.5 projection.

No Site API, native runtime, production data or service credential is used.
The native model registration in one fixture is metadata only; inference is
never claimed for those provided-prediction computations.

Statistics 1.0.0 (docs/design/audit-statistics.md section 14, E4): the datasets
meet the 30/30/10 floors, results are keyed by criterion id and carry the
engine's copied decision, and the run outcome aggregates confirmatory criteria
(section 4.6). One fixture uses an explicit plan (engineConfig 1.4) whose ids
differ from the suite names. schemas/fixtures/external-runs.v1.2.json stays as
the frozen fixture of the 1.2 branch; this script writes external-runs.v1.5.json.
"""
import copy
import json
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from engine.diagnostics import read_csv, run, sha256
from engine.statistics import plan_sha256
from engine.worker_contract import Claim, evidence_envelope, json_bytes, translate_config

DATE = '2026-10-08T16:00:00.000Z'
IMAGE = 'sha256:' + 'a' * 64
BASE = json.loads((ROOT/'schemas/fixtures/hosted-runs.v1.1.json').read_text(encoding='utf-8'))[0]


def binary(errors_b):
    """Group A predicted perfectly; group B misses `errors_b` of its 30 positives. 60 rows per group."""
    rows = ['actual,predicted,group']
    rows += ['1,1,A'] * 30 + ['0,0,A'] * 30
    rows += ['1,1,B'] * (30 - errors_b) + ['1,0,B'] * errors_b + ['0,0,B'] * 30
    return ('\n'.join(rows) + '\n').encode()


BINARY = binary(6)
MULTICLASS = ('actual,predicted\n' + ''.join(f'{label},{label if i < 34 else other}\n' for label, other in (('A', 'B'), ('B', 'C'), ('C', 'A')) for i in range(40))).encode()
REGRESSION = ('actual,predicted\n' + ''.join(f'{i},{i + (0, .5, -.5, 1, -1, 0)[i % 6]}\n' for i in range(60))).encode()
EXPLICIT_PLAN = {'criteria': [
    {'id': 'accuracy-minimum', 'kind': 'performance', 'rationale': 'Synthetic explicit plan whose ids differ from the suite names.', 'members': [{'metric': 'accuracy', 'band': {'lower': 0.8}}, {'metric': 'balanced_accuracy', 'band': {'lower': 0.5}}]},
    {'id': 'parity-0.20', 'kind': 'group_comparison', 'metric': 'selection_rate_difference', 'band': {'lower': -0.2, 'upper': 0.2}},
]}
CASES = [
    ('binary', 'Binary classification', BINARY, ['performance', 'demographic_parity', 'disparate_impact', 'equalized_odds'], 'provided_predictions', None),
    ('multiclass', 'Multiclass classification', MULTICLASS, ['performance'], 'provided_predictions', None),
    ('regression', 'Regression', REGRESSION, ['regression'], 'provided_predictions', None),
    ('client-local', 'Binary classification', BINARY, ['performance'], 'client_local', None),
    ('explicit-plan', 'Binary classification', BINARY, ['performance', 'demographic_parity'], 'provided_predictions', EXPLICIT_PLAN),
]


def project(request, packet, request_text, result_text):
    """The compiled external run 1.5 (section 11): the importJob record shape with statistics 1.0.0 results."""
    model = {key: value for key, value in request['model'].items() if key not in {'sha256', 'size', 'review'}}
    profile = request['profile']
    procedure = request['procedure']
    plan = packet['externalReport']['configuration']['statistics']
    binding = {'procedureId': procedure['id'], 'procedureRevision': procedure['revision'],
        'briefRevision': procedure['briefRevision'], 'programRevision': procedure['programRevision']}
    results = packet['hostedResults']
    counted = [result['outcome'] for result in results if result['decision']['role'] == 'confirmatory']
    overall = next((value for value in ('fail', 'inconclusive', 'pass') if value in counted), 'not_applicable')
    flags = [result['testId'] for result in results if result['decision']['role'] == 'exploratory' and result['outcome'] == 'fail']
    return {'externalJobId': request['engineConfig']['id'], 'contractVersion': '1.5',
        **{key: request['engineConfig'][key] for key in ('id', 'engagementId', 'modelId', 'datasetId', 'task', 'seed')},
        'profileId': profile['id'], 'suite': profile['suite'], 'config': profile['config'],
        'thresholds': {'source': 'internal_policy', 'policyId': profile['id'], 'policyVersion': profile['version'],
            'frozenAt': DATE, 'frozenBy': 'fixture-owner', **profile['config']},
        'state': 'succeeded', 'outcome': overall, 'overallOutcome': overall, 'reviewFlags': flags,
        'results': results, 'paperIds': ['WP-external-'+request['engineConfig']['id']],
        'createdAt': DATE, 'startedAt': DATE, 'completedAt': '2026-10-08T16:00:01.000Z',
        'procedureBinding': binding, 'provenance': {'inputHashes': {**request['inputHashes'],
            'auditBinding': sha256(json.dumps(binding, separators=(',', ':')).encode()),
            'externalRequest': sha256(request_text.encode()), 'externalResult': sha256(result_text.encode()),
            'statisticsPlan': plan_sha256(plan)},
            'runnerVersion': packet['provenance']['workerVersion'], 'policyVersion': profile['version']},
        'manifest': {'schemaVersion': '1.0', 'model': model,
            'dataset': {**request['dataset'], 'rowCount': max([0]+[metric['sampleSize'] for result in results for metric in result['metrics']]),
                'columns': [profile['config']['labelColumn'], profile['config']['predictionColumn']]},
            'profile': profile, 'executionMode': request['executionMode'], 'lineage': 'authenticated_external_attempt',
            'testDefinitionVersion': packet['provenance']['translationVersion'], 'limitations': request['limitations'],
            'statistics': plan}}


def main():
    fixtures = []
    with tempfile.TemporaryDirectory() as temp:
        for name, task, data, suite, mode, plan in CASES:
            model = copy.deepcopy(BASE['manifest']['model'])
            model.update(id='MODEL-external-'+name, familyId='MODEL-external-'+name, task=task,
                sourceSha256=sha256(data), artifactId='EV-external-'+name)
            if mode == 'client_local':
                # A registered native model does not imply independent scoring.
                model.update(format='ONNX', sourceSha256=sha256(b'fictional-unexecuted-model'), artifactId='EV-model-metadata')
            profile = copy.deepcopy(BASE['manifest']['profile'])
            if plan is None:
                config = copy.deepcopy(BASE['config'])
                config.update(groupColumn='group' if 'demographic_parity' in suite else '', minimumGroupSize=30,
                    minimumSampleSize=30, minimumClassCount=10, minimumMacroF1=.6)
                profile.update(id='PROTOCOL-external-'+name, task=task, suite=suite, config=config)
            else:
                # A profile with a stored plan keeps only the column mappings and the declared labels (section 9.1).
                config = {'labelColumn': 'actual', 'predictionColumn': 'predicted', 'groupColumn': 'group', 'positiveLabel': '1', 'negativeLabel': '0'}
                profile.update(id='PROTOCOL-external-'+name, schemaVersion='1.1', task=task, suite=suite, config=config, statistics=plan)
            dataset = {'id': 'EV-external-'+name, 'name': name+'.csv', 'sha256': sha256(data), 'size': len(data)}
            engine_config = {'contractVersion': '1.1' if plan is None else '1.4', 'id': 'JOB-external-'+name,
                'engagementId': 'ENG-external-fixture', 'modelId': model['id'], 'datasetId': dataset['id'],
                'task': task, 'suite': suite, 'config': config, 'policyId': profile['id'], 'policyVersion': profile['version'], 'seed': 42}
            if task == 'Binary classification':
                engine_config['negativeLabel'] = '0'
            if plan is not None:
                engine_config['statistics'] = plan
            request = {'schemaVersion': '1.0', 'executionMode': mode,
                'model': {**model, 'sha256': model['sourceSha256'], 'size': 28, 'review': {'approved': False}},
                'dataset': dataset, 'profile': profile, 'seed': 42,
                'procedure': {'id': 'PROC-external-'+name, 'revision': 1, 'briefRevision': 1, 'programRevision': 2},
                'inputHashes': {'dataset': dataset['sha256'], 'modelArtifact': model['sourceSha256'],
                    'system': sha256(b'fictional-system'), 'protocol': sha256(json.dumps(profile, separators=(',', ':'), ensure_ascii=False).encode())},
                'engineConfig': engine_config,
                'limitations': ['Synthetic engine computation and import projection fixture; no platform authentication or native inference validation.']}
            request_text = json.dumps(request, separators=(',', ':'), ensure_ascii=False)
            claim = Claim.parse({'jobId': request['engineConfig']['id'], 'attemptId': 'ATTEMPT-'+name,
                'fence': 1, 'nonce': 'fictional-fixture-nonce-'+name,
                'leaseUntil': (datetime.now(timezone.utc)+timedelta(seconds=60)).isoformat(),
                'requestSha256': sha256(request_text.encode()), 'request': request, 'requestJSON': request_text})
            path = Path(temp)/dataset['name']
            path.write_bytes(data)
            rows, _ = read_csv(path)
            report = run(path, translate_config(request, rows))
            packet = evidence_envelope(report, claim, image_digest=IMAGE,
                execution={'kind': 'provided_predictions', 'controller': 'client_local_worker' if mode == 'client_local' else 'external_auditor_worker',
                    'networkIsolation': 'synthetic_fixture_no_network', 'limitations': ['Synthetic saved predictions; no independent inference.']})
            result_text = json_bytes(packet).decode()+'\n'
            fixtures.append({'fixture': name, 'requestJSON': request_text, 'resultJSON': result_text,
                'run': project(request, packet, request_text, result_text)})
    output = ROOT/'schemas/fixtures/external-runs.v1.5.json'
    output.write_text(json.dumps(fixtures, indent=2, ensure_ascii=False)+'\n', encoding='utf-8', newline='\n')
    print('Created', len(fixtures), 'synthetic external fixtures')


if __name__ == '__main__':
    main()
