"""Generate a tiny real Inspect AI log (mock model, mock judge) plus post-run edits.

Run with the throwaway venv interpreter:
  venvs/inspect/Scripts/python.exe scripts/inspect_tiny.py <out_dir>
No network or API keys are used: both models are inspect_ai's built-in mockllm provider.
"""
import re
import sys
from pathlib import Path

from inspect_ai import Task, eval, task
from inspect_ai.dataset import Sample
from inspect_ai.log import (
    MetadataEdit,
    ProvenanceData,
    TagsEdit,
    edit_eval_log,
    edit_score,
    invalidate_samples,
    read_eval_log,
    write_eval_log,
)
from inspect_ai.model import GenerateConfig, ModelOutput, get_model
from inspect_ai.scorer import ScoreEdit, match, model_graded_qa
from inspect_ai.solver import generate, system_message

OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=True)

ANSWERS = {
    # question fragment -> answers returned on successive calls (epoch 1, epoch 2)
    "2+2": ["4", "4"],
    "capital of France": ["Paris", "Lyon"],
    "boiling point": ["90", "100"],
    "largest planet": ["Saturn", "Saturn"],
}
calls: dict[str, int] = {}


def model_under_test(messages, tools, tool_choice, config):
    text = " ".join(str(m.text) for m in messages)
    for key, answers in ANSWERS.items():
        if key in text:
            n = calls.get(key, 0)
            calls[key] = n + 1
            return ModelOutput.from_content(model="mockllm/model", content=answers[min(n, len(answers) - 1)])
    return ModelOutput.from_content(model="mockllm/model", content="I do not know")


def judge(messages, tools, tool_choice, config):
    text = " ".join(str(m.text) for m in messages)
    answer = re.search(r"\[Submission\]: (.*?)\n", text, re.S)
    criterion = re.search(r"\[Criterion\]: (.*?)\n", text, re.S)
    ok = bool(answer and criterion and criterion.group(1).strip().lower() in answer.group(1).strip().lower())
    return ModelOutput.from_content(model="mockllm/judge", content="The submission was compared with the criterion.\nGRADE: " + ("C" if ok else "I"))


@task
def tiny_qa():
    return Task(
        dataset=[
            Sample(id="q1", input="What is 2+2? Answer with a number only.", target="4", metadata={"passage_id": "arith", "category": "arithmetic"}),
            Sample(id="q2", input="What is the capital of France? One word.", target="Paris", metadata={"passage_id": "geo", "category": "geography"}),
            Sample(id="q3", input="What is the boiling point of water at sea level in Celsius? Number only.", target="100", metadata={"passage_id": "phys", "category": "physics"}),
            Sample(id="q4", input="What is the largest planet in the solar system? One word.", target="Jupiter", metadata={"passage_id": "geo", "category": "astronomy"}),
        ],
        solver=[system_message("You are a concise assistant. Answer with the requested format only."), generate()],
        scorer=[match(location="exact"), model_graded_qa(model=get_model("mockllm/judge", custom_outputs=judge))],
        epochs=2,
        config=GenerateConfig(temperature=0.0, max_tokens=16, seed=1234),
        version="1.0.0",
        metadata={"fixture": "ai-assurance genai-evidence design (#31)"},
    )


logs = eval(tiny_qa(), model=get_model("mockllm/model", custom_outputs=model_under_test), log_dir=str(OUT / "logs"), display="none", max_connections=1, max_samples=1)
original = Path(logs[0].location.replace("file://", "")) if logs[0].location.startswith("file://") else Path(logs[0].location)
print("original", original, original.stat().st_size)

log = read_eval_log(str(original))
# 1) post-run score edit with provenance (recorded in Score.history and a ScoreEditEvent)
edit_score(log, "q4", "match", ScoreEdit(value="C", explanation="Fixture regrade: accepted alternative answer", provenance=ProvenanceData(author="fixture-editor", reason="Demonstrate a post-run score edit")), epoch=1)
# 2) post-run tag/metadata edits recorded in log_updates
log = edit_eval_log(log, [TagsEdit(tags_add=["regraded"]), MetadataEdit(metadata_set={"review_status": "edited-after-run"})], ProvenanceData(author="fixture-editor", reason="Demonstrate log_updates"))
# 3) post-run invalidation of one sample
target = next(s for s in log.samples if s.id == "q3" and s.epoch == 2)
log = invalidate_samples(log, [target.uuid], ProvenanceData(author="fixture-editor", reason="Demonstrate sample invalidation"))
edited = OUT / "tiny_qa.edited.eval"
write_eval_log(log, str(edited))
write_eval_log(log, str(OUT / "tiny_qa.edited.json"), format="json")
print("edited", edited, edited.stat().st_size, (OUT / "tiny_qa.edited.json").stat().st_size)
