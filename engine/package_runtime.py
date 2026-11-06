"""Deterministic source-only package builder; no client evidence or credentials."""
from __future__ import annotations

import argparse
import hashlib
import json
import stat
import zipfile
from pathlib import Path

from . import __version__
from .worker_contract import WORKER_VERSION, TRANSLATION_VERSION

EXCLUDED = {'__pycache__', '.test-tmp', '.venv', 'worker-jobs', 'node_modules', '.git'}
ENGINE_SPECIAL = {'Dockerfile', '.dockerignore', '.gitignore'}
EXAMPLES = {'predictions.csv', 'reference.csv', 'config.json', 'report.json', 'report-v1.1.json',
    'report-v1.1.1.json', 'generate_fixture.py'}
# Hand-maintained input that schemas/.build-run-schema.py generates test-run.schema.json from.
SCHEMA_INPUTS = {'test-run.base.json'}
SCHEMA_FIXTURES = {'hosted-runs.v1.1.json', 'external-runs.v1.2.json', 'procedure-execution.json'}
# Engine tests, their fixtures and the scripts that generate those fixtures stay
# in the repository; the runtime package ships source, examples and schemas only.
EXCLUDED_ENGINE_FOLDERS = {'tests'}


def sources(root):
    root = Path(root).resolve()
    entries = {}
    for folder in ('engine', 'schemas'):
        base = root/folder
        for file in sorted(base.rglob('*')):
            relative = file.relative_to(root)
            if any(part in EXCLUDED for part in relative.parts):
                continue
            if file.is_symlink():
                raise ValueError('Symlinked source cannot be packaged')
            if not file.is_file():
                continue
            if folder == 'engine':
                if relative.parts[1] in EXCLUDED_ENGINE_FOLDERS:
                    continue
                if 'examples' in relative.parts:
                    allowed = file.parent == base/'examples' and file.name in EXAMPLES
                else:
                    allowed = file.suffix in {'.py', '.md'} or file.name in ENGINE_SPECIAL or file.name in {'requirements.txt', 'requirements-optional.txt'}
            else:
                allowed = file.parent == base and (file.suffix in {'.py', '.mjs', '.md'} or file.name.endswith('.schema.json')
                    or file.name in SCHEMA_INPUTS)
                allowed = allowed or file.parent == base/'fixtures' and file.name in SCHEMA_FIXTURES
            if not allowed:
                continue
            if any(part.is_symlink() for part in (file, *file.parents) if part != root):
                raise ValueError('Symlinked source ancestor cannot be packaged')
            file.resolve().relative_to(root)
            data = file.read_bytes()
            if len(data) > 8*1024*1024:
                raise ValueError('Source entry exceeds package bound')
            entries[relative.as_posix()] = data
    if not entries or sum(map(len, entries.values())) > 20*1024*1024:
        raise ValueError('Package contents exceed source bounds')
    return entries


def package(root, output):
    entries = sources(root)
    manifest = {'schemaVersion': '1.0', 'distribution': 'assurance-runtime-source',
        'runnerVersion': __version__, 'workerVersion': WORKER_VERSION,
        'translationVersion': TRANSLATION_VERSION, 'runContracts': ['1.0', '1.1', '1.2'],
        'scope': 'Source and synthetic fixtures only; no qualified native/runtime image or credentials.',
        'files': {name: {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
            for name, data in sorted(entries.items())}}
    entries['RUNTIME-MANIFEST.json'] = (json.dumps(manifest, sort_keys=True, indent=2)+'\n').encode()
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('xb') as stream:
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in sorted(entries.items()):
                info = zipfile.ZipInfo(name, date_time=(2026, 10, 8, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data, compresslevel=9)
    with zipfile.ZipFile(destination) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != set(entries):
            raise ValueError('Package roundtrip integrity failed')
        for name, data in entries.items():
            if archive.read(name) != data:
                raise ValueError('Source bytes changed during packaging')
    return {'files': len(entries), 'bytes': destination.stat().st_size,
        'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'output': str(destination.resolve())}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    print(json.dumps(package(Path(__file__).resolve().parent.parent, args.output), sort_keys=True))


if __name__ == '__main__':
    main()
