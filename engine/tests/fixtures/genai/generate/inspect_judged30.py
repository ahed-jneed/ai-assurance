"""Real Inspect AI log with 30 samples and a model-graded scorer (mock SUT and mock judge, no network).

Sized for the readiness-gate end-to-end test of issue #33: n = 30 meets the minimum-sample floor of
docs/design/audit-statistics.md. 27 of 30 answers are correct. Run from this directory:
  ../venvs/inspect/Scripts/python.exe -I inspect_judged30.py <out_dir>
"""
import re
import sys
from pathlib import Path

from inspect_ai import Task, eval, task
from inspect_ai.dataset import Sample
from inspect_ai.model import GenerateConfig, ModelOutput, get_model
from inspect_ai.scorer import match, model_graded_qa
from inspect_ai.solver import generate, system_message

OUT = Path(sys.argv[1]).resolve()
WRONG = {7, 18, 29}  # sample numbers answered incorrectly


def sut(messages, tools, tool_choice, config):
    text = " ".join(str(m.text) for m in messages)
    n, a, b = (int(v) for v in re.search(r"#(\d+): What is (\d+) \+ (\d+)", text).groups())
    return ModelOutput.from_content(model="mockllm/model", content=str(a + b + (1 if n in WRONG else 0)))


def judge(messages, tools, tool_choice, config):
    text = " ".join(str(m.text) for m in messages)
    answer = re.search(r"\[Submission\]: (.*?)\n", text, re.S).group(1).strip()
    criterion = re.search(r"\[Criterion\]: (.*?)\n", text, re.S).group(1).strip()
    return ModelOutput.from_content(model="mockllm/judge", content="Compared.\nGRADE: " + ("C" if answer == criterion else "I"))


@task
def judged_qa_30():
    samples = [Sample(id=f"s{n:02d}", input=f"#{n}: What is {n} + {2 * n}? Answer with a number only.", target=str(3 * n), metadata={"topic": "arithmetic"}) for n in range(1, 31)]
    return Task(
        dataset=samples,
        solver=[system_message("Answer with a number only."), generate()],
        scorer=[model_graded_qa(model=get_model("mockllm/judge", custom_outputs=judge)), match(location="exact")],
        config=GenerateConfig(temperature=0.0, max_tokens=8),
        version="1.0.0",
    )


eval(judged_qa_30(), model=get_model("mockllm/model", custom_outputs=sut), log_dir=str(OUT), display="none", max_connections=1, max_samples=1)
for p in OUT.glob("*.eval"):
    print(p.name, p.stat().st_size)
