import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from engine.package_runtime import package, sources


class RuntimePackageTests(unittest.TestCase):
    def test_allowlisted_sources_and_manifest_roundtrip_are_deterministic(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, data in {
                'engine/diagnostics.py': b'# source fixture\n',
                'engine/README.md': b'Synthetic source documentation\n',
                'engine/examples/predictions.csv': b'actual,predicted\n1,1\n',
                'engine/examples/client.csv': b'private fixture must be excluded',
                'engine/.env': b'NEVER_PACKAGE=synthetic',
                'engine/__pycache__/compiled.pyc': b'compiled',
                'engine/worker-jobs/job-fixture/request.json': b'{}',
                'engine/.test-tmp/temporary.py': b'# temporary',
                'schemas/test-run.schema.json': b'{}',
                'schemas/private.json': b'{}',
                'schemas/fixtures/external-runs.v1.2.json': b'[]',
            }.items():
                path = root/name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            expected = {'engine/diagnostics.py', 'engine/README.md', 'engine/examples/predictions.csv',
                'schemas/test-run.schema.json', 'schemas/fixtures/external-runs.v1.2.json'}
            self.assertEqual(set(sources(root)), expected)
            first = package(root, root/'one.zip')
            second = package(root, root/'two.zip')
            self.assertEqual(first['sha256'], second['sha256'])
            with zipfile.ZipFile(root/'one.zip') as archive:
                manifest = json.loads(archive.read('RUNTIME-MANIFEST.json'))
                self.assertEqual(set(manifest['files']), expected)
                for name, pin in manifest['files'].items():
                    value = archive.read(name)
                    self.assertEqual(pin['sha256'], hashlib.sha256(value).hexdigest())
                    self.assertEqual(pin['bytes'], len(value))
            with self.assertRaises(FileExistsError):
                package(root, root/'one.zip')

    def test_linked_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'engine').mkdir()
            (root/'schemas').mkdir()
            (root/'engine/diagnostics.py').write_text('# fixture', encoding='utf-8')
            with patch.object(Path, 'is_symlink', autospec=True,
                    side_effect=lambda path: path.name == 'diagnostics.py'):
                with self.assertRaisesRegex(ValueError, 'Symlinked source'):
                    sources(root)


if __name__ == '__main__':
    unittest.main()
