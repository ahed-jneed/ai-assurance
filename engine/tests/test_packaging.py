"""Engine packaging (#62): one supported Python version, the image's hash-locked packages, signature tests that cannot skip in CI."""
from __future__ import annotations

import os
import re
import unittest
from pathlib import Path
from unittest.mock import patch

from engine.package_runtime import sources
from engine.tests import signature_support

ENGINE = Path(__file__).resolve().parents[1]
ROOT = ENGINE.parent
SUPPORTED = "3.12"


def pins(path):
    """{name: version} of the `name==version` lines of a requirements file (continuations skipped)."""
    result = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Za-z0-9_.-]+)==([^\s\\;]+)", line)
        if match:
            result[match.group(1).lower()] = match.group(2)
    return result


class SupportedPythonVersionTest(unittest.TestCase):
    def test_dockerfile_base_image_is_the_supported_version(self):
        dockerfile = (ENGINE / "Dockerfile").read_text(encoding="utf-8")
        image = re.search(r"^ARG PYTHON_IMAGE=python:(\d+\.\d+)\.\d+-slim@sha256:[0-9a-f]{64}$", dockerfile, re.M)
        self.assertIsNotNone(image, "engine/Dockerfile must default PYTHON_IMAGE to a python:X.Y.Z-slim tag pinned by @sha256 digest")
        self.assertEqual(image.group(1), SUPPORTED)

    def test_ci_runs_python_on_the_supported_version(self):
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        versions = re.findall(r'python-version:\s*"?([0-9.]+)"?', workflow)
        self.assertTrue(versions, "ci.yml sets no python-version")
        self.assertEqual(set(versions), {SUPPORTED})

    def test_python_version_file_is_the_supported_version(self):
        # .python-version tells pyenv, uv and similar tools which Python to use.
        pinned = (ROOT / ".python-version").read_text(encoding="utf-8").strip()
        self.assertEqual(pinned, SUPPORTED)

    def test_requirements_and_docs_name_the_supported_version(self):
        self.assertIn(f"CPython {SUPPORTED}", (ENGINE / "requirements.txt").read_text(encoding="utf-8"))
        for name in ("README.md", "RUNTIME_PACKAGE.md"):
            text = (ENGINE / name).read_text(encoding="utf-8")
            self.assertIn(f"Python {SUPPORTED}", text, name)
            self.assertNotRegex(text, r"Python 3\.1[0-3]\+", name)


class ImageRequirementsTest(unittest.TestCase):
    def test_every_image_requirement_is_pinned_with_hashes(self):
        text = (ENGINE / "requirements-image.txt").read_text(encoding="utf-8")
        entries = re.split(r"\n(?=[A-Za-z])", "\n".join(line for line in text.splitlines() if line and not line.startswith("#")))
        self.assertEqual({entry.split("==")[0] for entry in entries}, {"cryptography", "cffi", "pycparser", "zstandard"})
        for entry in entries:
            self.assertRegex(entry, r"^[a-z]+==[0-9.]+ \\")
            self.assertRegex(entry, r"--hash=sha256:[0-9a-f]{64}", entry.split("==")[0])

    def test_image_pins_match_the_dev_and_optional_pins(self):
        image = pins(ENGINE / "requirements-image.txt")
        dev = pins(ENGINE / "requirements-dev.txt")
        optional = pins(ENGINE / "requirements-optional.txt")
        self.assertEqual(image["cryptography"], dev["cryptography"])
        self.assertEqual(image["zstandard"], dev["zstandard"])
        self.assertEqual(image["zstandard"], optional["zstandard"])

    def test_dockerfile_installs_the_image_requirements_with_hashes(self):
        dockerfile = (ENGINE / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("COPY requirements-image.txt", dockerfile)
        for flag in ("--require-hashes", "--only-binary=:all:", "--no-cache-dir", "-r /tmp/requirements-image.txt"):
            self.assertIn(flag, dockerfile)
        # Packages are installed before the image drops to the unprivileged user.
        self.assertLess(dockerfile.index("pip install"), dockerfile.index("USER 10001:10001"))

    def test_runtime_package_ships_what_the_dockerfile_copies(self):
        entries = sources(ROOT)
        for name in ("Dockerfile", ".dockerignore", "requirements.txt", "requirements-image.txt", "requirements-optional.txt"):
            self.assertIn("engine/" + name, entries)

    def test_ci_requires_the_signature_and_zstd_back_ends(self):
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertRegex(workflow, r'ENGINE_REQUIRE_CRYPTOGRAPHY:\s*"1"')
        self.assertRegex(workflow, r'GENAI_REQUIRE_ZSTD:\s*"1"')
        self.assertIn("docker build", workflow)


class SignatureTestSwitchTest(unittest.TestCase):
    def test_cryptography_present_where_required(self):
        if signature_support.cryptography_required():
            self.assertTrue(signature_support.HAS_CRYPTOGRAPHY, "ENGINE_REQUIRE_CRYPTOGRAPHY=1 but cryptography does not import")

    def run_guarded(self, required, present):
        calls = []

        class Probe(unittest.TestCase):
            @signature_support.requires_cryptography
            def test_signature(self):
                calls.append("ran")

        result = unittest.TestResult()
        with patch.dict(os.environ), patch.object(signature_support, "HAS_CRYPTOGRAPHY", present):
            os.environ.pop(signature_support.REQUIRED_VARIABLE, None)
            if required:
                os.environ[signature_support.REQUIRED_VARIABLE] = "1"
            Probe("test_signature").run(result)
        return result, calls

    def test_missing_package_skips_by_default(self):
        result, calls = self.run_guarded(required=False, present=False)
        self.assertEqual((len(result.skipped), len(result.failures), calls), (1, 0, []))

    def test_missing_package_fails_when_required(self):
        result, calls = self.run_guarded(required=True, present=False)
        self.assertEqual((len(result.skipped), len(result.failures), calls), (0, 1, []))
        self.assertIn("ENGINE_REQUIRE_CRYPTOGRAPHY=1", result.failures[0][1])

    def test_present_package_runs_the_test(self):
        for required in (False, True):
            result, calls = self.run_guarded(required=required, present=True)
            self.assertEqual((len(result.skipped), len(result.failures), calls), (0, 0, ["ran"]))
