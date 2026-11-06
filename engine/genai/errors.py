"""Coded GenAI ingestion errors and the warning vocabulary (design section 11.6)."""
from __future__ import annotations

from ..errors import EngineError

ERROR_CODES = frozenset({
    "input_too_large", "bundle_too_large", "line_too_long", "too_many_items", "too_many_scores",
    "nesting_too_deep", "invalid_utf8", "invalid_json", "duplicate_key", "number_out_of_range",
    "unknown_format", "format_mismatch", "unsupported_format", "unsupported_format_version",
    "zip_invalid", "zip_entry_unsafe_name", "zip_entry_too_large", "zip_entry_size_mismatch", "zip_ratio_exceeded",
    "zip_method_unsupported", "zip_encrypted", "zip_crc_mismatch", "zstd_unavailable",
    "missing_required_entry", "lm_eval_bundle_mismatch", "duplicate_item_key",
    "manifest_invalid", "plan_invalid", "input_hash_mismatch", "evidence_too_large",
})

WARNING_CODES = frozenset({
    "non_finite_score", "unparseable_score", "score_out_of_range", "lone_surrogate", "unresolved_attachment",
    "label_truncated", "crlf_lines", "ignored_entries",
    "summary_count_mismatch", "tool_hash_mismatch", "tool_aggregate_mismatch",
    "moving_model_alias", "snapshot_changed_during_run", "multiple_system_prompts", "naive_timestamp",
    "declaration_conflict", "declared_judge_not_observed", "family_declaration_conflict", "judge_validation_unbound",
    "scorer_kind_unknown", "scorer_kind_declared",
    "inconsistent_group_identity", "member_key_missing", "missing_cluster_id", "unsupported_aggregation",
    "unverified_tool_version", "unverified_format_version",
    "uncategorised_probe", "uncategorised_plugin", "unsupported_conversational_case", "invalidated_post_run",
    "secret_like_value_redacted", "blank_lines", "run_incomplete", "marking_signature_unverified",
})


class GenaiInputError(EngineError):
    """An ingested file, manifest or plan that the engine rejects, with an enumerated code."""

    def __init__(self, code: str, message: str = ""):
        if code not in ERROR_CODES:
            raise ValueError(f"unknown GenAI error code {code!r}")
        super().__init__(code, message or code)


def fail(code: str, message: str = ""):
    raise GenaiInputError(code, message)


def require(condition, code: str, message: str = ""):
    if not condition:
        raise GenaiInputError(code, message)


class Warnings:
    """Run- or bundle-level warnings as {code: [count, examples]} with at most 20 example locators."""

    def __init__(self):
        self._entries: dict[str, list] = {}

    def add(self, code: str, locator: str | None = None, count: int = 1):
        if code not in WARNING_CODES:
            raise ValueError(f"unknown GenAI warning code {code!r}")
        entry = self._entries.setdefault(code, [0, []])
        entry[0] += count
        if locator is not None and len(entry[1]) < 20 and locator not in entry[1]:
            entry[1].append(locator)

    def merge(self, other: "Warnings"):
        for code, (count, examples) in other._entries.items():
            entry = self._entries.setdefault(code, [0, []])
            entry[0] += count
            for example in examples:
                if len(entry[1]) < 20 and example not in entry[1]:
                    entry[1].append(example)

    def codes(self):
        return set(self._entries)

    def __contains__(self, code):
        return code in self._entries

    def as_list(self):
        return [{"code": code, "count": count, "examples": examples} for code, (count, examples) in sorted(self._entries.items())]
