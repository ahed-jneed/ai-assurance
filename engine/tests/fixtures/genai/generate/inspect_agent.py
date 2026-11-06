"""Tiny real Inspect AI agent-style log: one tool, 3 tasks x 4 epochs (mock model, no network).

Used for pass^k and tools/permissions extraction. Run from this directory so task_file is relative:
  ../venvs/inspect/Scripts/python.exe -I inspect_agent.py <out_dir>
"""
import re
import sys
from pathlib import Path

from inspect_ai import Task, eval, task
from inspect_ai.dataset import Sample
from inspect_ai.model import ChatMessageTool, GenerateConfig, ModelOutput, get_model
from inspect_ai.scorer import match
from inspect_ai.solver import generate, system_message, use_tools
from inspect_ai.tool import tool

OUT = Path(sys.argv[1]).resolve()
# per-task success schedule across epochs 1..4
SCHEDULE = {"2 + 3": [True, True, True, True], "10 + 7": [True, False, True, False], "1 + 1": [False, False, False, False]}
calls: dict[str, int] = {}


@tool
def add():
    async def execute(x: int, y: int):
        """Add two integers.

        Args:
            x: First integer.
            y: Second integer.

        Returns:
            The sum of x and y.
        """
        return x + y

    return execute


def agent_model(messages, tools, tool_choice, config):
    user = next(str(m.text) for m in messages if m.role == "user")
    key = next(k for k in SCHEDULE if k in user)
    x, y = (int(v) for v in re.findall(r"\d+", key))
    if isinstance(messages[-1], ChatMessageTool):
        n = calls.get(key, 0)
        calls[key] = n + 1
        ok = SCHEDULE[key][min(n, 3)]
        return ModelOutput.from_content(model="mockllm/model", content=str(x + y) if ok else str(x + y + 1))
    return ModelOutput.for_tool_call(model="mockllm/model", tool_name="add", tool_arguments={"x": x, "y": y})


@task
def tiny_agent():
    return Task(
        dataset=[
            Sample(id="t1", input="Use the add tool to compute 2 + 3. Reply with the number only.", target="5", metadata={"family": "arith"}),
            Sample(id="t2", input="Use the add tool to compute 10 + 7. Reply with the number only.", target="17", metadata={"family": "arith"}),
            Sample(id="t3", input="Use the add tool to compute 1 + 1. Reply with the number only.", target="2", metadata={"family": "arith"}),
        ],
        solver=[system_message("You are an agent. Use tools when asked."), use_tools(add()), generate()],
        scorer=match(location="exact"),
        epochs=4,
        config=GenerateConfig(temperature=0.0, max_tokens=32),
        version="1.0.0",
    )


eval(tiny_agent(), model=get_model("mockllm/model", custom_outputs=agent_model), log_dir=str(OUT), display="none", max_connections=1, max_samples=1)
for p in OUT.glob("*.eval"):
    print(p.name, p.stat().st_size)
