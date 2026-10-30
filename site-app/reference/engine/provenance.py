"""Versioned diagnostic definitions and direct runtime dependency evidence."""
from __future__ import annotations

import importlib.metadata
import platform
from collections.abc import Iterable

# Change a definition's version when its metric, eligibility, or acceptance
# procedure changes. This catalog is separate from the runner release version.
TEST_DEFINITION_VERSIONS = {
    "PERF-BINARY": "1.0.0",
    "PERF-CAL": "1.0.0",
    "PERF-MULTI": "1.0.0",
    "PERF-REG": "1.0.0",
    "FAIR-SCOPE": "1.0.0",
    "FAIR-DP": "1.0.0",
    "FAIR-DI": "1.0.0",
    "FAIR-EO": "1.0.0",
    "DRIFT-INPUT": "1.0.0",
    "DRIFT-NUMERIC": "1.0.0",
    "EXPL-SHAP": "1.0.0",
    "EXPL-LIME": "1.0.0",
    "EXPL-PERM": "1.0.0",
    "ROB-CV": "1.0.0",
    "ROB-PERT": "1.0.0",
    "ROB-ADV": "1.0.0",
    "ING-INFER": "1.0.0",
    "LOG-12": "1.0.0",
}


def definition_versions(test_ids: Iterable[str]) -> dict[str, str]:
    """Snapshot the exact definitions consumed by this completed run."""
    versions = {}
    for test_id in test_ids:
        definition_id = test_id if test_id in TEST_DEFINITION_VERSIONS else "DRIFT-NUMERIC" if test_id.startswith("DRIFT-") else None
        if definition_id is None:
            raise ValueError(f"Test definition version is missing for {test_id}")
        versions[test_id] = TEST_DEFINITION_VERSIONS[definition_id]
    return versions


def runtime_dependencies(adapter=None, input_metadata=()) -> tuple[dict, list[str]]:
    """Record installed versions of direct dependencies used by selected paths.

    Adapter declarations are application-owned metadata, not third-party
    attestation. A custom adapter with no declaration produces partial
    provenance rather than the false claim that it uses only the stdlib.
    Transitive dependencies/native binaries require the deployed image lock.
    """
    packages = set()
    notes = []
    declaration = "not_used"
    if adapter is not None:
        declared = getattr(adapter, "runtime_packages", None)
        if declared is None:
            declaration = "missing"
            notes.append("The active application-owned adapter did not declare its runtime distributions; dependency provenance is incomplete.")
        else:
            if not isinstance(declared, (tuple, list, frozenset, set)) or any(not isinstance(name, str) or not name.strip() for name in declared):
                raise ValueError("Adapter runtime_packages must declare distribution names as strings")
            declaration = "provided"
            packages.update(declared)
    for metadata in input_metadata:
        if metadata and metadata.get("format") == "parquet":
            packages.add("pyarrow")
    versions = {}
    unresolved = []
    for name in sorted(packages):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
            unresolved.append(name)
    if unresolved:
        notes.append("Installed distribution metadata could not be resolved for active dependencies: "+", ".join(unresolved)+". Dependency provenance is incomplete.")
    complete = declaration != "missing" and not unresolved
    return {
        "python": {"version": platform.python_version(), "implementation": platform.python_implementation()},
        "packages": versions,
        "adapterDeclaration": declaration,
        "unresolved": unresolved,
        "status": "complete" if complete else "partial",
        "standardLibraryOnly": not packages if complete else None,
        "source": "installed_distribution_metadata for declared direct dependencies",
        "scope": "Direct adapter and active connector distributions only; transitive packages and native binaries require a worker image/dependency lock.",
    }, notes
