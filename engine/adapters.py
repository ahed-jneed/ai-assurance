"""Reviewed adapter contracts, intentionally without unsafe model loaders.

Adapters are application-owned implementations. Never build them from
artifact imports, user-controlled Python packages, pickle, or joblib.
"""
from dataclasses import dataclass
from typing import Protocol, Sequence


@dataclass(frozen=True)
class Feature:
    name: str
    dtype: str
    nullable: bool = False


@dataclass(frozen=True)
class ModelDescriptor:
    artifact_sha256: str
    format: str
    task: str
    feature_schema: tuple[Feature, ...]
    output_labels: tuple[str, ...]
    adapter_version: str


class PredictionAdapter(Protocol):
    """An application-owned inference implementation running in a sandbox."""
    descriptor: ModelDescriptor
    capabilities: frozenset[str]
    runtime_packages: tuple[str, ...]

    def predict(self, records: Sequence[dict[str, object]]) -> Sequence[object]: ...
    def predict_probability(self, records: Sequence[dict[str, object]]) -> Sequence[Sequence[float]]: ...


class ExplanationAdapter(Protocol):
    """Outputs must retain method, background hash, seed and feature ordering."""
    adapter_version: str

    def explain(self, model: PredictionAdapter, records: Sequence[dict[str, object]], background: Sequence[dict[str, object]], seed: int) -> dict[str, object]: ...

