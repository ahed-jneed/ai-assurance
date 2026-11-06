"""Model families: the closed vocabulary and the heuristic cross-check (design section 8.7).

Families are declared in the bundle manifest. The heuristic here only
cross-checks a declaration: a disagreement raises
`family_declaration_conflict` for a reviewer to resolve; no match gives None,
which raises nothing.
"""
from __future__ import annotations

import re

FAMILIES = ("openai", "anthropic", "google", "meta", "mistral", "alibaba", "deepseek", "xai", "cohere", "microsoft", "nvidia", "ibm", "amazon", "ai21")
OTHER = re.compile(r"^other-(?!(?:" + "|".join(FAMILIES) + r")$)[a-z0-9]+(?:-[a-z0-9]+)*$")

ROUTING_PREFIXES = frozenset({
    "openai", "openai-api", "azure", "azureai", "bedrock", "vertex", "together", "groq", "fireworks", "openrouter",
    "hf", "huggingface", "vllm", "sglang", "ollama", "litellm", "sagemaker", "cloudflare", "mockllm", "anthropic",
    "google", "mistral", "grok",
})

TOKENS = {
    "gpt": "openai", "chatgpt": "openai", "o1": "openai", "o3": "openai", "o4": "openai",
    "claude": "anthropic", "anthropic": "anthropic",
    "gemini": "google", "gemma": "google", "palm": "google",
    "llama": "meta", "meta": "meta", "llama2": "meta", "llama3": "meta",
    "mistral": "mistral", "mistralai": "mistral", "mixtral": "mistral", "codestral": "mistral", "ministral": "mistral", "pixtral": "mistral",
    "qwen": "alibaba", "qwq": "alibaba",
    "deepseek": "deepseek",
    "grok": "xai", "xai": "xai",
    "command": "cohere", "cohere": "cohere", "aya": "cohere",
    "phi": "microsoft",
    "nemotron": "nvidia",
    "granite": "ibm",
    "nova": "amazon", "titan": "amazon", "amazon": "amazon",
    "jamba": "ai21", "ai21": "ai21",
}
_PHI = re.compile(r"^phi[0-9]")


def valid_family(value) -> bool:
    return value is None or value in FAMILIES or (isinstance(value, str) and len(value) <= 64 and bool(OTHER.match(value)))


def heuristic_family(model):
    if not isinstance(model, str) or not model:
        return None
    segments = model.lower().split("/")
    if len(segments) >= 2 and segments[0] in ROUTING_PREFIXES:
        segments = segments[1:]
    for token in re.split(r"[^a-z0-9]+", "/".join(segments)):
        if not token:
            continue
        if token in TOKENS:
            return TOKENS[token]
        if token.startswith("qwen"):
            return "alibaba"
        if _PHI.match(token):
            return "microsoft"
    return None
