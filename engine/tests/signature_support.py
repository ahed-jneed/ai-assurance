"""The optional cryptography runtime for the Ed25519 signature tests.

Without `cryptography` the signature tests skip, unless ENGINE_REQUIRE_CRYPTOGRAPHY=1
(set in CI): then they fail, so a missing package cannot pass unnoticed.
"""
from __future__ import annotations

import functools
import os

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    HAS_CRYPTOGRAPHY = True
except ImportError:
    serialization = None
    Ed25519PrivateKey = None
    HAS_CRYPTOGRAPHY = False

REQUIRED_VARIABLE = "ENGINE_REQUIRE_CRYPTOGRAPHY"
MISSING = "the optional cryptography runtime is unavailable (install engine/requirements-dev.txt)"


def cryptography_required():
    return os.environ.get(REQUIRED_VARIABLE) == "1"


def requires_cryptography(test):
    """Skip a signature test without cryptography, or fail it when the variable demands the package."""
    @functools.wraps(test)
    def wrapper(self, *args, **kwargs):
        if not HAS_CRYPTOGRAPHY:
            if cryptography_required():
                self.fail(f"{REQUIRED_VARIABLE}=1 but {MISSING}")
            self.skipTest(MISSING)
        return test(self, *args, **kwargs)
    return wrapper
