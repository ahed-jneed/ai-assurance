"""Scorer-kind allowlists, per tool version (design section 7). Kinds fail closed.

A score is `deterministic` (or `tool_detector` for garak) only when the
format's allowlist names it; it is `model_graded` when the log shows a judge
or the type is a known model-graded one; everything else is `unknown`, which
the gate treats like `model_graded`. Names are not proof (design Q15): the
results view shows the kind of every deciding score.
"""
from __future__ import annotations

KIND_ORDER = ("unknown", "model_graded", "human", "tool_detector", "deterministic")


def most_restrictive(kinds):
    kinds = list(kinds)
    for kind in KIND_ORDER:
        if kind in kinds:
            return kind
    return "unknown"


# Inspect AI 0.3.287, inspect_ai/scorer/__init__.py
INSPECT_VERIFIED = "0.3.287"
INSPECT_DETERMINISTIC = frozenset({"match", "includes", "pattern", "answer", "choice", "exact", "f1", "math"})

# lm-evaluation-harness 0.4.13, lm_eval/api/metrics.py
LM_EVAL_VERIFIED = "0.4.13"
LM_EVAL_METRICS = frozenset({
    "acc", "acc_all", "acc_bytes", "acc_mutual_info", "acc_norm", "bits_per_byte", "bleu", "brier_score", "byte_perplexity",
    "chrf", "chrf++", "exact_match", "f1", "likelihood", "mcc", "perplexity", "ter", "word_perplexity",
})
LM_EVAL_DEFAULT_METRICS = {
    "loglikelihood": ("perplexity", "acc"),
    "multiple_choice": ("acc", "acc_norm"),
    "generate_until": ("exact_match",),
    "loglikelihood_rolling": ("word_perplexity", "byte_perplexity", "bits_per_byte"),
}
LM_EVAL_DEFAULT_AGGREGATION = {
    "acc": "mean", "acc_all": "mean", "acc_bytes": "mean", "acc_mutual_info": "mean", "acc_norm": "mean", "exact_match": "mean", "likelihood": "mean",
    "perplexity": "perplexity", "word_perplexity": "weighted_perplexity", "byte_perplexity": "weighted_perplexity", "bits_per_byte": "bits_per_byte",
    "brier_score": "brier_score", "mcc": "matthews_corrcoef", "f1": "f1", "bleu": "bleu", "chrf": "chrf", "chrf++": "chrf++", "ter": "ter",
}

# promptfoo 0.125.1, BaseAssertionTypesSchema in src/types/index.ts
PROMPTFOO_VERIFIED = "0.125.1"
PROMPTFOO_DETERMINISTIC = frozenset({
    "bleu", "contains", "contains-all", "contains-any", "contains-html", "contains-json", "contains-sql", "contains-xml", "cost", "equals",
    "finish-reason", "gleu", "icontains", "icontains-all", "icontains-any", "is-html", "is-json", "is-refusal", "is-sql",
    "is-valid-function-call", "is-valid-openai-function-call", "is-valid-openai-tools-call", "is-xml", "latency", "levenshtein", "meteor",
    "perplexity", "perplexity-score", "regex", "rouge-l", "rouge-n", "rouge-s", "skill-used", "starts-with", "tool-call-f1",
    "trace-error-spans", "trace-span-count", "trace-span-duration", "trajectory:step-count", "trajectory:tool-args-match",
    "trajectory:tool-sequence", "trajectory:tool-used", "word-count",
})
PROMPTFOO_MODEL_GRADED = frozenset({
    "agent-rubric", "answer-relevance", "context-faithfulness", "context-recall", "context-relevance", "conversation-relevance", "factuality",
    "g-eval", "llm-rubric", "model-graded-closedqa", "model-graded-factuality", "search-rubric", "select-best", "trajectory:goal-success",
})


def promptfoo_kind(assertion_type, has_code_transform=False):
    if not isinstance(assertion_type, str):
        return "unknown"
    base = assertion_type[4:] if assertion_type.startswith("not-") else assertion_type
    if base.startswith("promptfoo:redteam:") or base in PROMPTFOO_MODEL_GRADED:
        return "model_graded"
    if has_code_transform:
        return "unknown"
    if base == "human":
        return "human"
    if base in PROMPTFOO_DETERMINISTIC:
        return "deterministic"
    return "unknown"


# garak 0.17.1, detectors/base.py, judge.py, agent_breaker.py
GARAK_VERIFIED = "0.17.1"
GARAK_NON_STRING_DETERMINISTIC = frozenset({"encoding.DecodeApprox", "leakreplay.StartsWith", "promptinject.AttackRogueString", "goodside.PlainJSON", "goodside.Glitch"})


def garak_kind(detector, default_params):
    params = default_params if isinstance(default_params, dict) else {}
    if "detector_model_name" in params:
        return "model_graded"
    if "matchtype" in params or detector in GARAK_NON_STRING_DETERMINISTIC:
        return "tool_detector"
    return "unknown"


# PyRIT 1.1.0, pyrit/score/__init__.py
PYRIT_VERIFIED = "1.1.0"
PYRIT_WRAPPERS = frozenset({"TrueFalseInverterScorer", "TrueFalseCompositeScorer", "FloatScaleThresholdScorer"})


def pyrit_kind(identifier):
    if not isinstance(identifier, dict):
        return "unknown"
    module, name = identifier.get("class_module"), identifier.get("class_name")
    if not isinstance(module, str) or not isinstance(name, str):
        return "unknown"
    if name == "SubStringScorer" and module == "pyrit.score.true_false.substring_scorer":
        return "deterministic"
    if module.startswith("pyrit.score.true_false.regex.") and name != "PackageHallucinationScorer":
        return "deterministic"
    if name in PYRIT_WRAPPERS:
        children = identifier.get("sub_identifier") or identifier.get("children") or []
        if isinstance(children, dict):
            children = list(children.values())
        if not isinstance(children, list) or not children:
            return "unknown"
        return most_restrictive(pyrit_kind(child) for child in children)
    return "unknown"


# DeepEval 4.3.3
DEEPEVAL_VERIFIED = "4.3"
DEEPEVAL_DETERMINISTIC = frozenset({"Exact Match", "Pattern Match"})

# Ragas 0.4.3, ragas/metrics/ name attributes
RAGAS_VERIFIED = "0.4"
RAGAS_DETERMINISTIC = frozenset({
    "exact_match", "string_present", "non_llm_string_similarity", "bleu_score", "rouge_score", "chrf_score",
    "non_llm_context_precision_with_reference", "id_based_context_precision", "non_llm_context_recall", "id_based_context_recall",
    "tool_call_accuracy", "tool_call_f1", "data_compare_score",
})
