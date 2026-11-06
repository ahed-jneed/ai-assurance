"""Hashing, canonical JSON, keys and secret scanning (design sections 6.2 and 11.4).

Texts are hashed exactly as recorded: no Unicode normalization, no trimming,
no line-ending changes. A string with an unpaired surrogate is hashed over
its `surrogatepass` bytes; copies written into the envelope replace each
unpaired surrogate with U+FFFD (`clean`), so `canonical_bytes` never fails.
"""
from __future__ import annotations

import hashlib
import json
import re

from ..diagnostics import canonical_bytes
from .readers import NonFinite

EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
COMPONENT = re.compile(r"^[A-Za-z0-9._@+=/#-]{1,128}$")
ESCAPE_FORM = re.compile(r"^h-[0-9a-f]{16}$")
KEY = re.compile(r"^[A-Za-z0-9._:|/#@+=-]{1,512}$")
DECLARED_RUN_KEY = re.compile(r"^[A-Za-z0-9._:/#@+=-]{1,128}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_COMPOSED_KEY = 250
_SURROGATE = re.compile("[\ud800-\udfff]")

SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://[^\s?#]*\?[^\s#]*\b(?:key|token|sig)=", re.IGNORECASE),
    re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://[^\s/@:]+:[^\s/@]+@"),
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def has_lone_surrogate(text: str) -> bool:
    return bool(_SURROGATE.search(text))


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()


def clean(value):
    """Replace unpaired surrogates and non-finite markers before a value is copied into the envelope."""
    if isinstance(value, str):
        return _SURROGATE.sub("�", value) if _SURROGATE.search(value) else value
    if isinstance(value, dict):
        return {clean(k): clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, NonFinite):
        return None
    return value


def _hashable(value):
    if isinstance(value, NonFinite):
        return None
    if isinstance(value, dict):
        return {k: _hashable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_hashable(v) for v in value]
    return value


def canonical_hash_bytes(value) -> bytes:
    """Canonical JSON for values that are only hashed: the `surrogatepass` rule of section 6.2."""
    text = json.dumps(_hashable(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return text.encode("utf-8", "surrogatepass")


def sha256_canonical(value) -> str:
    return hashlib.sha256(canonical_hash_bytes(value)).hexdigest()


def sha256_value(value) -> str:
    """A string as is; any other value as canonical JSON."""
    return sha256_text(value) if isinstance(value, str) else sha256_canonical(value)


def canonical(value) -> bytes:
    return canonical_bytes(value)


def short(text: str) -> str:
    return sha256_text(text)[:16]


def is_secret_like(text: str) -> bool:
    return any(p.search(text) for p in SECRET_PATTERNS)


def c(value) -> str:
    """Key component rule: the identifier itself when safe, else h-<first 16 hex of its SHA-256>."""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    if COMPONENT.match(text) and not ESCAPE_FORM.match(text) and not is_secret_like(text):
        return text
    return "h-" + short(text)


def t16(digest: str) -> str:
    return digest[:16]


def compose(*components: str) -> str:
    key = ":".join(components)
    if len(key) > MAX_COMPOSED_KEY:
        return components[0] + ":h-" + short(key)
    return key


def item_key(run_key: str, group_key: str, epoch: int) -> str:
    return f"{run_key}|{group_key}|{epoch}"


def redact(text: str, warnings=None, locator=None) -> str:
    """Replace a secret-like string copied into the envelope by [redacted:<12 hex>] (section 11.4)."""
    if isinstance(text, str) and is_secret_like(text):
        if warnings is not None:
            warnings.add("secret_like_value_redacted", locator)
        return "[redacted:" + sha256_text(text)[:12] + "]"
    return text


# ---------------------------------------------------------------- messages


def normalize_message(message, attachments=None, warnings=None, locator=None):
    role = message.get("role") if isinstance(message, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    return {"role": role, "content": resolve_attachments(content, attachments, warnings, locator)}


_ATTACHMENT = re.compile(r"attachment://([0-9a-f]{32})")


def resolve_attachments(content, attachments, warnings=None, locator=None):
    if attachments is None:
        return content
    if isinstance(content, str):
        if "attachment://" not in content:
            return content

        def sub(match):
            value = attachments.get(match.group(1)) if isinstance(attachments, dict) else None
            if isinstance(value, str):
                return value
            if warnings is not None:
                warnings.add("unresolved_attachment", locator)
            return match.group(0)
        return _ATTACHMENT.sub(sub, content)
    if isinstance(content, list):
        return [resolve_attachments(part, attachments, warnings, locator) for part in content]
    if isinstance(content, dict):
        return {k: resolve_attachments(v, attachments, warnings, locator) for k, v in content.items()}
    return content


def prompt_hash(messages):
    """promptSha256 of normalized messages: drop system messages; one user string is hashed as is."""
    rest = [m for m in messages if m.get("role") != "system"]
    if len(rest) == 1 and rest[0].get("role") == "user" and isinstance(rest[0].get("content"), str):
        return sha256_text(rest[0]["content"])
    return sha256_canonical(rest)


def system_hash(messages):
    """systemPromptSha256: one system message gives the hash of its text; several the canonical array."""
    texts = [m.get("content") for m in messages if m.get("role") == "system"]
    if not texts:
        return None
    if len(texts) == 1:
        return sha256_value(texts[0])
    return sha256_canonical(texts)


def any_surrogate(value) -> bool:
    if isinstance(value, str):
        return has_lone_surrogate(value)
    if isinstance(value, dict):
        return any(any_surrogate(k) or any_surrogate(v) for k, v in value.items())
    if isinstance(value, list):
        return any(any_surrogate(v) for v in value)
    return False
