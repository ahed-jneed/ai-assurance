"""Tiny real DeepEval run: non-LLM metrics plus Faithfulness judged by a deterministic stub model.

No network/API keys. The stub judge exists only so the results file shows how DeepEval records
an LLM-judge metric (evaluationModel, reason, verboseLogs). Run with the throwaway venv:
  venvs/deepeval/Scripts/python.exe deepeval_tiny.py <results_folder>
"""
import os
import sys

os.environ["DEEPEVAL_TELEMETRY_OPT_OUT"] = "1"
os.environ["DEEPEVAL_RESULTS_FOLDER"] = sys.argv[1]
os.environ["DEEPEVAL_DISABLE_DOTENV"] = "1"
os.environ.pop("OPENAI_API_KEY", None)

from deepeval import evaluate  # noqa: E402
from deepeval.evaluate.configs import AsyncConfig, DisplayConfig  # noqa: E402
from deepeval.metrics import ExactMatchMetric, FaithfulnessMetric, PatternMatchMetric  # noqa: E402
from deepeval.models import DeepEvalBaseLLM  # noqa: E402
from deepeval.test_case import LLMTestCase  # noqa: E402


class StubJudge(DeepEvalBaseLLM):
    """Deterministic stand-in judge: supports every claim that appears verbatim in the context."""

    def __init__(self):
        self.name = "fixture-stub-judge-v1"

    def load_model(self):
        return self

    def get_model_name(self):
        return self.name

    def generate(self, prompt, schema=None):
        name = getattr(schema, "__name__", "")
        if name == "Truths":
            return schema(truths=["Paris is the capital of France.", "The Eiffel Tower is in Paris."])
        if name == "Claims":
            claims = []
            if "Paris" in prompt:
                claims.append("Paris is the capital of France.")
            if "Lyon" in prompt:
                claims.append("Lyon is the capital of France.")
            return schema(claims=claims or ["No factual claim."])
        if name == "Verdicts":
            verdicts = []
            if "Lyon is the capital" in prompt:
                verdicts.append({"verdict": "no", "reason": "The context names Paris as the capital."})
            if "Paris is the capital" in prompt.split("Claims:")[-1] if "Claims:" in prompt else "Paris is the capital" in prompt:
                verdicts.append({"verdict": "yes", "reason": None})
            return schema(verdicts=verdicts or [{"verdict": "idk", "reason": "No claim to verify."}])
        if schema is not None:
            return schema(reason="Deterministic stub judge reason.")
        return "Deterministic stub judge output."

    async def a_generate(self, prompt, schema=None):
        return self.generate(prompt, schema=schema)


context = ["Paris is the capital of France. The Eiffel Tower is in Paris."]
cases = [
    LLMTestCase(name="rag-1", input="What is the capital of France?", actual_output="Paris is the capital of France.", expected_output="Paris is the capital of France.", retrieval_context=context, additional_metadata={"passage": "fr-geo"}),
    LLMTestCase(name="rag-2", input="Which city is France's capital?", actual_output="Lyon is the capital of France.", expected_output="Paris is the capital of France.", retrieval_context=context, additional_metadata={"passage": "fr-geo"}),
    LLMTestCase(name="rag-3", input="Name the capital city of France.", actual_output="Paris is the capital of France.", expected_output="Paris is the capital of France.", retrieval_context=context, additional_metadata={"passage": "fr-geo-2"}),
]
metrics = [
    ExactMatchMetric(threshold=1.0),
    PatternMatchMetric(pattern=r"^[A-Z][a-z]+ is the capital of France\.$", threshold=1.0),
    FaithfulnessMetric(threshold=0.7, model=StubJudge(), include_reason=True),
]
evaluate(test_cases=cases, metrics=metrics, async_config=AsyncConfig(run_async=False), display_config=DisplayConfig(print_results=False, show_indicator=False))
