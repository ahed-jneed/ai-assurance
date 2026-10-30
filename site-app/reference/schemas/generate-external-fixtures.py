"""Compute synthetic worker evidence and the current Site importJob projection.

No Site API, native runtime, production data or service credential is used.
The native model registration in one fixture is metadata only; inference is
never claimed for those provided-prediction computations.
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
from engine.worker_contract import Claim, evidence_envelope, json_bytes, translate_config

DATE = '2026-10-08T16:00:00.000Z'
IMAGE = 'sha256:' + 'a' * 64
BASE = json.loads((ROOT/'schemas/fixtures/hosted-runs.v1.1.json').read_text(encoding='utf-8'))[0]
BINARY = b'actual,predicted,group\n1,1,A\n1,1,A\n0,0,A\n0,0,A\n1,1,B\n1,0,B\n0,0,B\n0,0,B\n'
CASES = [
    ('binary', 'Binary classification', BINARY, ['performance', 'demographic_parity', 'disparate_impact', 'equalized_odds'], 'provided_predictions'),
    ('multiclass', 'Multiclass classification', b'actual,predicted\nA,A\nA,B\nB,B\nB,B\nC,C\nC,A\n', ['performance'], 'provided_predictions'),
    ('regression', 'Regression', b'actual,predicted\n1,1\n1,2\n1,1\n1,0\n', ['regression'], 'provided_predictions'),
    ('client-local', 'Binary classification', BINARY, ['performance'], 'client_local'),
]


def project(request, packet, request_text, result_text):
    """Mirror current importJob record shape; signatures/custody remain server-owned."""
    model = {key: value for key, value in request['model'].items() if key not in {'sha256', 'size', 'review'}}
    profile = request['profile']
    procedure = request['procedure']
    binding = {'procedureId': procedure['id'], 'procedureRevision': procedure['revision'],
        'briefRevision': procedure['briefRevision'], 'programRevision': procedure['programRevision']}
    outcomes = [result['outcome'] for result in packet['hostedResults']]
    overall = next((value for value in ('fail', 'inconclusive', 'pass', 'not_applicable') if value in outcomes), 'inconclusive')
    return {'externalJobId': request['engineConfig']['id'], 'contractVersion': '1.2',
        **{key: request['engineConfig'][key] for key in ('id', 'engagementId', 'modelId', 'datasetId', 'task', 'seed')},
        'profileId': profile['id'], 'suite': profile['suite'], 'config': profile['config'],
        'thresholds': {'source': 'internal_policy', 'policyId': profile['id'], 'policyVersion': profile['version'],
            'frozenAt': DATE, 'frozenBy': 'fixture-owner', **profile['config']},
        'state': 'succeeded', 'outcome': overall, 'overallOutcome': overall,
        'results': packet['hostedResults'], 'paperIds': ['WP-external-'+request['engineConfig']['id']],
        'createdAt': DATE, 'startedAt': DATE, 'completedAt': '2026-10-08T16:00:01.000Z',
        'procedureBinding': binding, 'provenance': {'inputHashes': {**request['inputHashes'],
            'auditBinding': sha256(json.dumps(binding, separators=(',', ':')).encode()),
            'externalRequest': sha256(request_text.encode()), 'externalResult': sha256(result_text.encode())},
            'runnerVersion': packet['provenance']['workerVersion'], 'policyVersion': profile['version']},
        'manifest': {'schemaVersion': '1.0', 'model': model,
            'dataset': {**request['dataset'], 'rowCount': max([0]+[metric['sampleSize'] for result in packet['hostedResults'] for metric in result['metrics']]),
                'columns': [profile['config']['labelColumn'], profile['config']['predictionColumn']]},
            'profile': profile, 'executionMode': request['executionMode'], 'lineage': 'authenticated_external_attempt',
            'testDefinitionVersion': packet['provenance']['translationVersion'], 'limitations': request['limitations']}}


def main():
    fixtures = []
    with tempfile.TemporaryDirectory() as temp:
        for name, task, data, suite, mode in CASES:
            model = copy.deepcopy(BASE['manifest']['model'])
            model.update(id='MODEL-external-'+name, familyId='MODEL-external-'+name, task=task,
                sourceSha256=sha256(data), artifactId='EV-external-'+name)
            if mode == 'client_local':
                # A registered native model does not imply independent scoring.
                model.update(format='ONNX', sourceSha256=sha256(b'fictional-unexecuted-model'), artifactId='EV-model-metadata')
            config = copy.deepcopy(BASE['config'])
            config.update(groupColumn='group' if 'demographic_parity' in suite else '', minimumGroupSize=2,
                minimumSampleSize=2, minimumClassCount=2, minimumMacroF1=.6)
            profile = copy.deepcopy(BASE['manifest']['profile'])
            profile.update(id='PROTOCOL-external-'+name, task=task, suite=suite, config=config)
            dataset = {'id': 'EV-external-'+name, 'name': name+'.csv', 'sha256': sha256(data), 'size': len(data)}
            request = {'schemaVersion': '1.0', 'executionMode': mode,
                'model': {**model, 'sha256': model['sourceSha256'], 'size': 28, 'review': {'approved': False}},
                'dataset': dataset, 'profile': profile, 'seed': 42,
                'procedure': {'id': 'PROC-external-'+name, 'revision': 1, 'briefRevision': 1, 'programRevision': 2},
                'inputHashes': {'dataset': dataset['sha256'], 'modelArtifact': model['sourceSha256'],
                    'system': sha256(b'fictional-system'), 'protocol': sha256(json.dumps(profile, separators=(',', ':'), ensure_ascii=False).encode())},
                'engineConfig': {'contractVersion': '1.1', 'id': 'JOB-external-'+name,
                    'engagementId': 'ENG-external-fixture', 'modelId': model['id'], 'datasetId': dataset['id'],
                    'task': task, 'suite': suite, 'config': config, 'policyId': profile['id'], 'policyVersion': profile['version'], 'seed': 42},
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
    output = ROOT/'schemas/fixtures/external-runs.v1.2.json'
    output.write_text(json.dumps(fixtures, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    print('Created', len(fixtures), 'synthetic external fixtures')


if __name__ == '__main__':
    main()
