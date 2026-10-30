import importlib.metadata
import platform
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from engine.contract import validate_report
from engine.diagnostics import run
from engine.provenance import TEST_DEFINITION_VERSIONS, definition_versions, runtime_dependencies
from engine.tests.test_diagnostics import config


class ProvenanceTests(unittest.TestCase):
    def test_prediction_file_records_python_without_unused_installed_packages(self):
        dependencies, notes = runtime_dependencies()
        self.assertEqual(dependencies["python"]["version"], platform.python_version())
        self.assertEqual(dependencies["python"]["implementation"], platform.python_implementation())
        self.assertEqual(dependencies["packages"], {})
        self.assertEqual(dependencies["status"], "complete")
        self.assertTrue(dependencies["standardLibraryOnly"])
        self.assertEqual(notes, [])

    def test_active_adapter_records_only_its_declared_direct_dependencies(self):
        adapter = SimpleNamespace(runtime_packages=("numpy", "onnxruntime"))
        installed = {"numpy": "test-numpy", "onnxruntime": "test-onnx"}
        # This verifies provenance selection, not ONNX native inference.
        with patch("engine.provenance.importlib.metadata.version", side_effect=installed.__getitem__) as metadata:
            dependencies, notes = runtime_dependencies(adapter)
        self.assertEqual(dependencies["packages"], installed)
        self.assertEqual({call.args[0] for call in metadata.call_args_list}, set(installed))
        self.assertEqual(dependencies["adapterDeclaration"], "provided")
        self.assertFalse(dependencies["standardLibraryOnly"])
        self.assertEqual(notes, [])

    def test_reference_parquet_adds_connector_dependency_once(self):
        with patch("engine.provenance.importlib.metadata.version", return_value="test-arrow") as metadata:
            dependencies, _ = runtime_dependencies(input_metadata=({"format": "parquet"}, {"format": "parquet"}))
        metadata.assert_called_once_with("pyarrow")
        self.assertEqual(dependencies["packages"], {"pyarrow": "test-arrow"})

    def test_missing_distribution_or_adapter_declaration_is_explicitly_partial(self):
        with patch("engine.provenance.importlib.metadata.version", side_effect=importlib.metadata.PackageNotFoundError("missing-runtime")):
            dependencies, notes = runtime_dependencies(SimpleNamespace(runtime_packages=("missing-runtime",)))
        self.assertEqual(dependencies["packages"], {"missing-runtime": None})
        self.assertEqual(dependencies["unresolved"], ["missing-runtime"])
        self.assertEqual(dependencies["status"], "partial")
        self.assertIsNone(dependencies["standardLibraryOnly"])
        self.assertTrue(notes)
        dependencies, notes = runtime_dependencies(SimpleNamespace())
        self.assertEqual(dependencies["adapterDeclaration"], "missing")
        self.assertEqual(dependencies["status"], "partial")
        self.assertIsNone(dependencies["standardLibraryOnly"])
        self.assertTrue(notes)

    def test_definitions_are_versioned_and_unknown_tests_are_rejected(self):
        versions = definition_versions(["PERF-BINARY", "DRIFT-age"])
        self.assertEqual(versions, {"PERF-BINARY": "1.0.0", "DRIFT-age": "1.0.0"})
        versions["PERF-BINARY"] = "changed-copy"
        self.assertEqual(TEST_DEFINITION_VERSIONS["PERF-BINARY"], "1.0.0")
        with self.assertRaises(ValueError):
            definition_versions(["UNREGISTERED-TEST"])

    def test_paper_identity_is_stable_for_retry_and_separates_version_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "predictions.csv"
            path.write_text("actual,predicted,group,score\n"+"".join(f"{i%2},{i%2},{'A' if i < 4 else 'B'},0.9\n" for i in range(8)), encoding="utf-8")
            first = run(path, config())
            retry = run(path, config())
            validate_report(first)
            self.assertEqual(first["paperIds"], retry["paperIds"])
            self.assertIn("testDefinitions", first["provenance"]["inputs"])
            with patch("engine.diagnostics.__version__", "1.1.999-test"):
                revised_runner = run(path, config())
            self.assertTrue(all(a != b for a, b in zip(first["paperIds"], revised_runner["paperIds"])))
            self.assertTrue(all(p["procedure"]["runnerVersion"] == "1.1.999-test" for p in revised_runner["workingPapers"]))
            with patch.dict(TEST_DEFINITION_VERSIONS, {"PERF-BINARY": "2.0.0"}):
                revised_definition = run(path, config())
            self.assertNotEqual(first["paperIds"][0], revised_definition["paperIds"][0])
            self.assertEqual(first["paperIds"][1:], revised_definition["paperIds"][1:])
            self.assertEqual(revised_definition["workingPapers"][0]["procedure"]["testDefinitionVersion"], "2.0.0")
