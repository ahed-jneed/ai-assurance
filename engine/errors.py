"""Coded engine failures: a stable code for the platform, a message for operators."""
from __future__ import annotations


class EngineError(ValueError):
    """A validation failure with a stable, enumerated failure code.

    The code is safe to send to the platform. The message is for the local
    operator only: it can name columns or configuration fields, so it never
    leaves the worker host. Subclassing ValueError keeps every existing
    `except ValueError` caller working.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
