"""Tiny real Ragas run with non-LLM metrics; exported with the documented to_pandas() path.

Run: venvs/ragas/Scripts/python.exe -X utf8 ragas_tiny.py <out.jsonl> <out.csv>
"""
import os
import sys

os.environ["RAGAS_DO_NOT_TRACK"] = "true"
os.environ.pop("OPENAI_API_KEY", None)

from ragas import EvaluationDataset, evaluate  # noqa: E402
from ragas.metrics import ExactMatch, NonLLMContextPrecisionWithReference, NonLLMContextRecall, NonLLMStringSimilarity, StringPresence  # noqa: E402

rows = [
    {"user_input": "What is the capital of France?", "response": "Paris", "reference": "Paris", "retrieved_contexts": ["Paris is the capital of France.", "Lyon is a large French city."], "reference_contexts": ["Paris is the capital of France."]},
    {"user_input": "Which city is France's capital?", "response": "Lyon", "reference": "Paris", "retrieved_contexts": ["Lyon is a large French city."], "reference_contexts": ["Paris is the capital of France."]},
    {"user_input": "Where is the Eiffel Tower?", "response": "Paris, France", "reference": "Paris", "retrieved_contexts": ["The Eiffel Tower is in Paris."], "reference_contexts": ["The Eiffel Tower is in Paris."]},
]
dataset = EvaluationDataset.from_list(rows)
result = evaluate(dataset=dataset, metrics=[ExactMatch(), StringPresence(), NonLLMStringSimilarity(), NonLLMContextPrecisionWithReference(), NonLLMContextRecall()], show_progress=False)
frame = result.to_pandas()
frame.to_json(sys.argv[1], orient="records", lines=True, force_ascii=False)
frame.to_csv(sys.argv[2], index=False)
print(result)
