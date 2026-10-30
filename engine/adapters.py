"""Reviewed adapter contracts, intentionally without unsafe model loaders.

The registry accepts application-owned adapter instances. Never populate it
from artifact imports, user-controlled Python packages, pickle, or joblib.
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


class AdapterRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, PredictionAdapter] = {}

    def register(self, adapter_id: str, adapter: PredictionAdapter) -> None:
        if not adapter_id or adapter_id in self._adapters:
            raise ValueError("Adapter identifier must be nonempty and unique")
        if adapter.descriptor.format.lower() in {"pickle", "pkl", "joblib"}:
            raise ValueError("Unsafe serialized Python models are not accepted by this registry")
        self._adapters[adapter_id] = adapter

    def require(self, adapter_id: str, capability: str) -> PredictionAdapter:
        adapter = self._adapters.get(adapter_id)
        if adapter is None or capability not in adapter.capabilities:
            raise ValueError("Required validated model adapter capability is unavailable")
        return adapter
