"""GenAI risk categories and tool-tag translation (design section 9), as versioned data.

Tool tags are translated by entry name, never by number: garak tags use the
2023 OWASP LLM numbering and promptfoo the 2025 numbering. The mappings to
frameworks are analytical judgement ("this test produces evidence relevant
to"), never "satisfies". The OWASP LLM 2026 identifiers come from secondary
sources and MUST be confirmed against the official document before the
workspace releases the criteria pack (design Q1).
"""
from __future__ import annotations

TAXONOMY_VERSION = "2026.11.0"

# category -> (OWASP LLM 2026, OWASP Agentic 2025-12, NIST AI 600-1 risks, MITRE ATLAS v2026.10, AI Act)
CATEGORIES = {
    "prompt_injection_direct": (("LLM01",), ("ASI01",), (9,), ("AML.T0051.000", "AML.T0065"), ("15(5)",)),
    "prompt_injection_indirect": (("LLM01",), ("ASI01", "ASI06"), (9,), ("AML.T0051.001", "AML.T0093"), ("15(5)",)),
    "jailbreak": (("LLM01",), (), (9,), ("AML.T0054", "AML.T0068"), ("15(5)", "55(1)(a)")),
    "goal_hijack": (("LLM01",), ("ASI01",), (9,), ("AML.T0051",), ("15(5)",)),
    "sensitive_information_disclosure": (("LLM02",), (), (4,), ("AML.T0137.003", "AML.T0085.002", "AML.T0024", "AML.T0136"), ("15(5)",)),
    "hidden_context_exposure": (("LLM08",), (), (9,), ("AML.T0069.002", "AML.T0085.003"), ("15(5)",)),
    "excessive_agency": (("LLM03",), ("ASI02",), (7, 9), ("AML.T0053", "AML.T0086", "AML.T0101"), ("15(5)",)),
    "privilege_abuse": (("LLM03",), ("ASI03",), (9,), ("AML.T0083", "AML.T0098"), ("15(5)",)),
    "unexpected_code_execution": (("LLM10",), ("ASI05",), (9,), ("AML.T0050", "AML.T0102", "AML.T0105"), ("15(5)",)),
    "improper_output_handling": (("LLM10",), ("ASI05",), (9,), ("AML.T0077", "AML.T0067"), ("15(5)",)),
    "memory_context_poisoning": (("LLM01", "LLM09"), ("ASI06",), (9,), ("AML.T0080", "AML.T0080.000", "AML.T0070", "AML.T0071"), ("15(5)",)),
    "data_model_poisoning": (("LLM05",), (), (9, 12), ("AML.T0020", "AML.T0018.000"), ("15(5)",)),
    "supply_chain": (("LLM04",), ("ASI04",), (12,), ("AML.T0010", "AML.T0109", "AML.T0110"), ("15(5)",)),
    "vector_embedding_weakness": (("LLM09",), ("ASI06",), (4, 9), ("AML.T0064", "AML.T0070", "AML.T0085.000"), ("15(5)",)),
    "unbounded_consumption": (("LLM06",), ("ASI08",), (), ("AML.T0029", "AML.T0034", "AML.T0034.002"), ("15(5)",)),
    "inter_agent_communication": ((), ("ASI07",), (9,), ("AML.T0118",), ("15(5)",)),
    "cascading_failure": ((), ("ASI08",), (7, 12), (), ("15(4)",)),
    "human_trust_exploitation": ((), ("ASI09",), (7,), (), ()),
    "rogue_agent": ((), ("ASI10",), (7,), (), ("15(4)",)),
    "misinformation": (("LLM07",), (), (2, 8), ("AML.T0062", "AML.T0060"), ("15(1)", "15(3)")),
    "capability_accuracy": (("LLM07",), (), (2,), (), ("15(1)", "15(3)")),
    "harmful_content": ((), (), (1, 3, 11), ("AML.T0048",), ("55(1)(a)",)),
    "bias_fairness": ((), (), (6,), (), ("10(2)(f)", "10(2)(g)")),
    "ai_interaction_disclosure": ((), ("ASI09",), (7,), (), ("50(1)",)),
    "synthetic_content_marking": ((), (), (8,), ("AML.T0088",), ("50(2)", "50(4)")),
    "policy_violation": ((), (), (), (), ()),
}

# garak tags use the 2023 v1.1 OWASP numbering (garak/data/tags.misp.tsv, 0.17.1)
GARAK_OWASP_2023 = {
    "owasp:llm01": "prompt_injection_direct",
    "owasp:llm02": "improper_output_handling",
    "owasp:llm03": "data_model_poisoning",
    "owasp:llm04": "unbounded_consumption",
    "owasp:llm05": "supply_chain",
    "owasp:llm06": "sensitive_information_disclosure",
    "owasp:llm07": "excessive_agency",
    "owasp:llm08": "excessive_agency",
    "owasp:llm09": "misinformation",
    "owasp:llm10": "unbounded_consumption",
}

GARAK_PROBE_CLASSES = {
    "goodside.Tag": ("prompt_injection_direct",),
    "goodside.WhoIsRiley": ("misinformation",),
    "lmrc.QuackMedicine": ("misinformation",),
    "lmrc.Bullying": ("harmful_content",),
    "lmrc.Deadnaming": ("harmful_content",),
    "lmrc.SexualContent": ("harmful_content",),
    "lmrc.Sexualisation": ("harmful_content",),
    "lmrc.SlurUsage": ("harmful_content",),
    "lmrc.Profanity": ("harmful_content",),
    "lmrc.Anthropomorphisation": ("ai_interaction_disclosure",),
}

GARAK_PROBE_MODULES = {
    "promptinject": ("prompt_injection_direct",),
    "smuggling": ("prompt_injection_direct",),
    "latentinjection": ("prompt_injection_indirect",),
    "web_injection": ("prompt_injection_indirect", "improper_output_handling"),
    **{m: ("jailbreak",) for m in ("dan", "tap", "suffix", "grandma", "phrasing", "dra", "fitd", "goat", "adaptive_attacks", "encoding", "badchars", "visual_jailbreak")},
    **{m: ("sensitive_information_disclosure",) for m in ("leakreplay", "divergence", "propile", "apikey")},
    "sysprompt_extraction": ("hidden_context_exposure",),
    **{m: ("misinformation",) for m in ("packagehallucination", "snowball", "misleading")},
    "malwaregen": ("improper_output_handling",),
    "exploitation": ("improper_output_handling", "unexpected_code_execution"),
    "ansiescape": ("improper_output_handling",),
    **{m: ("harmful_content",) for m in ("realtoxicityprompts", "donotanswer", "continuation", "atkgen")},
    "topic": ("policy_violation",),
    "agent_breaker": ("excessive_agency",),
    "fileformats": ("supply_chain",),
}


def garak_categories(probe: str, tags):
    """Probe-class rules take precedence over module rules; the result is the union with translated tags."""
    found = set(GARAK_PROBE_CLASSES.get(probe) or GARAK_PROBE_MODULES.get(probe.split(".", 1)[0], ()))
    for tag in tags or ():
        if isinstance(tag, str) and tag in GARAK_OWASP_2023:
            found.add(GARAK_OWASP_2023[tag])
    return sorted(found), not found


# promptfoo uses the 2025 numbering (src/redteam/constants/frameworks.ts, 0.125.1)
PROMPTFOO_OWASP_2025 = {
    "owasp:llm:01": "prompt_injection_direct",
    "owasp:llm:02": "sensitive_information_disclosure",
    "owasp:llm:03": "supply_chain",
    "owasp:llm:04": "data_model_poisoning",
    "owasp:llm:05": "improper_output_handling",
    "owasp:llm:06": "excessive_agency",
    "owasp:llm:07": "hidden_context_exposure",
    "owasp:llm:08": "vector_embedding_weakness",
    "owasp:llm:09": "misinformation",
    "owasp:llm:10": "unbounded_consumption",
}

PROMPTFOO_PLUGINS = {
    "cross-session-leak": ("sensitive_information_disclosure",),
    "harmful:privacy": ("sensitive_information_disclosure",),
    "prompt-extraction": ("hidden_context_exposure",),
    "indirect-prompt-injection": ("prompt_injection_indirect",),
    "ascii-smuggling": ("prompt_injection_direct",),
    "hijacking": ("goal_hijack",),
    **{p: ("excessive_agency",) for p in ("excessive-agency", "rbac", "bfla", "bola")},
    "shell-injection": ("improper_output_handling", "unexpected_code_execution"),
    **{p: ("improper_output_handling",) for p in ("sql-injection", "ssrf", "debug-access")},
    **{p: ("misinformation",) for p in ("harmful:misinformation-disinformation", "hallucination", "overreliance")},
    **{p: ("unbounded_consumption",) for p in ("divergent-repetition", "reasoning-dos")},
    **{p: ("policy_violation",) for p in ("contracts", "politics", "imitation", "competitors")},
}

PROMPTFOO_JAILBREAK_STRATEGIES = frozenset({"base64", "rot13", "leetspeak", "hex", "homoglyph", "multilingual", "crescendo", "goat"})


def promptfoo_categories(plugin, strategy):
    found = set()
    known = False
    if isinstance(plugin, str):
        if plugin in PROMPTFOO_PLUGINS:
            found.update(PROMPTFOO_PLUGINS[plugin])
            known = True
        elif plugin.startswith("pii:"):
            found.add("sensitive_information_disclosure")
            known = True
        elif plugin.startswith("harmful:"):
            found.add("harmful_content")
            known = True
        elif plugin.startswith("bias:"):
            found.add("bias_fairness")
            known = True
    if isinstance(strategy, str):
        if strategy.startswith("jailbreak") or strategy in PROMPTFOO_JAILBREAK_STRATEGIES:
            found.add("jailbreak")
        elif strategy == "prompt-injection":
            found.add("prompt_injection_direct")
    return sorted(found), not known


def plan_categories(plan, technique):
    categories = plan.get("categories") or {}
    by_technique = categories.get("byTechnique") or {}
    if technique is not None and technique in by_technique:
        return sorted(set(by_technique[technique]))
    return sorted(set(categories.get("default") or []))
