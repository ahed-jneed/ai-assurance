"""Bounded readers for hostile bytes: strict JSON, JSONL and zip (design sections 7.1 and 11.2-11.3).

Nothing here touches the filesystem, the network or a subprocess. JSON goes
through the standard decoder with duplicate-key rejection; the non-finite
tokens that Inspect and lm-evaluation-harness write (`NaN`, `Infinity`) become
a `NonFinite` marker, never a float. Zip archives are read from their
central directory, one allowlisted entry at a time, with streamed and capped
decompression and a CRC-32 check; nothing is extracted to disk.
"""
from __future__ import annotations

import io
import json
import struct
import zipfile
import zlib

from . import limits
from .errors import GenaiInputError, fail, require


class NonFinite:
    """A `NaN`, `Infinity` or `-Infinity` token: absent where a number is expected, never a float."""

    __slots__ = ("token",)

    def __init__(self, token):
        self.token = token

    def __repr__(self):
        return f"NonFinite({self.token})"

    def as_float(self):
        return {"NaN": float("nan"), "Infinity": float("inf"), "-Infinity": float("-inf")}[self.token]


_MARKERS = {token: NonFinite(token) for token in ("NaN", "Infinity", "-Infinity")}


class _Duplicate(Exception):
    pass


class _OutOfRange(Exception):
    pass


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise _Duplicate(key)
        result[key] = value
    return result


def _constant(token):
    return _MARKERS[token]


def _float(text):
    value = float(text)
    if value != value or value in (float("inf"), float("-inf")):
        raise _OutOfRange(text[:40])
    return value


_DECODER = json.JSONDecoder(object_pairs_hook=_pairs, parse_constant=_constant, parse_float=_float)


def _walk_limits(value):
    """Iterative depth, key-count and string-size walk after decoding."""
    stack = [(value, 1)]
    while stack:
        node, depth = stack.pop()
        if isinstance(node, dict):
            require(depth <= limits.MAX_JSON_DEPTH, "nesting_too_deep")
            require(len(node) <= limits.MAX_OBJECT_KEYS, "invalid_json", "object has too many keys")
            for key, child in node.items():
                _check_string(key)
                if isinstance(child, (dict, list)):
                    stack.append((child, depth + 1))
                elif isinstance(child, str):
                    _check_string(child)
        elif isinstance(node, list):
            require(depth <= limits.MAX_JSON_DEPTH, "nesting_too_deep")
            for child in node:
                if isinstance(child, (dict, list)):
                    stack.append((child, depth + 1))
                elif isinstance(child, str):
                    _check_string(child)
        elif isinstance(node, str):
            _check_string(node)


def _check_string(text):
    if len(text) * 4 > limits.MAX_STRING_BYTES and len(text.encode("utf-8", "surrogatepass")) > limits.MAX_STRING_BYTES:
        fail("input_too_large", "string exceeds the size limit")


def decode_text(data: bytes) -> str:
    require(isinstance(data, (bytes, bytearray)), "invalid_utf8")
    if data[:3] == b"\xef\xbb\xbf":
        fail("invalid_utf8", "a byte-order mark is not accepted")
    try:
        return bytes(data).decode("utf-8")
    except UnicodeDecodeError:
        fail("invalid_utf8")


def loads(text: str):
    try:
        value, end = _DECODER.raw_decode(text, _skip_ws(text, 0))
    except _Duplicate:
        fail("duplicate_key")
    except _OutOfRange:
        fail("number_out_of_range")
    except RecursionError:
        fail("nesting_too_deep")
    except (json.JSONDecodeError, ValueError):
        fail("invalid_json")
    if _skip_ws(text, end) != len(text):
        fail("invalid_json", "trailing data")
    _walk_limits(value)
    return value


def _skip_ws(text, index):
    while index < len(text) and text[index] in " \t\n\r":
        index += 1
    return index


def load_json(data: bytes):
    require(len(data) <= limits.MAX_INPUT_FILE_BYTES, "input_too_large")
    return loads(decode_text(data))


class JsonlStats:
    def __init__(self):
        self.blank = 0
        self.crlf = 0


def load_jsonl(data: bytes, name: str, stats: JsonlStats | None = None):
    """Yield (line number, object) for every non-blank line; every such line MUST be one JSON object."""
    require(len(data) <= limits.MAX_INPUT_FILE_BYTES, "input_too_large")
    if data[:3] == b"\xef\xbb\xbf":
        fail("invalid_utf8", "a byte-order mark is not accepted")
    rows = []
    lines = bytes(data).split(b"\n")
    last = len(lines)
    for number, raw in enumerate(lines, start=1):
        require(len(raw) <= limits.MAX_JSONL_LINE_BYTES, "line_too_long", f"{name}:{number}")
        if raw.endswith(b"\r"):
            raw = raw[:-1]
            if stats is not None:
                stats.crlf += 1
        if not raw.strip(b" \t\r"):
            if stats is not None and number != last:
                stats.blank += 1
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            fail("invalid_utf8", f"{name}:{number}")
        value = loads(text)
        require(isinstance(value, dict), "invalid_json", f"{name}:{number} is not a JSON object")
        rows.append((number, value))
    return rows


def first_jsonl_object(data: bytes):
    """The first non-blank line decoded, for detection only; None when it is not one JSON object."""
    for raw in bytes(data[: limits.MAX_JSONL_LINE_BYTES + 2]).split(b"\n"):
        raw = raw.rstrip(b"\r")
        if not raw.strip():
            continue
        try:
            value = loads(raw.decode("utf-8"))
        except (GenaiInputError, UnicodeDecodeError):
            return None
        return value if isinstance(value, dict) else None
    return None


# ---------------------------------------------------------------- zip

ZIP_STORED, ZIP_DEFLATED, ZIP_ZSTD = 0, 8, 93


def zstd_backend():
    """'stdlib' on Python >= 3.14, 'zstandard' when the optional package imports, else None."""
    try:
        from compression import zstd  # noqa: F401  (Python >= 3.14)
        return "stdlib"
    except ImportError:
        pass
    try:
        import zstandard  # noqa: F401
        return "zstandard"
    except ImportError:
        return None


def _zstd_decompress(data: bytes, cap: int) -> bytes:
    backend = zstd_backend()
    if backend == "stdlib":
        from compression import zstd
        decompressor = zstd.ZstdDecompressor()
        try:
            out = decompressor.decompress(data, max_length=cap + 1)
        except zstd.ZstdError:
            fail("zip_invalid", "zstd stream is corrupt")
        return out
    if backend == "zstandard":
        import zstandard
        try:
            with zstandard.ZstdDecompressor().stream_reader(io.BytesIO(data), read_across_frames=True) as reader:
                chunks, total = [], 0
                while total <= cap:
                    chunk = reader.read(min(1 << 20, cap + 1 - total))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    total += len(chunk)
                return b"".join(chunks)
        except zstandard.ZstdError:
            fail("zip_invalid", "zstd stream is corrupt")
    fail("zstd_unavailable", "reading zstd entries needs Python 3.14 or the optional zstandard package")


def _inflate(data: bytes, cap: int) -> bytes:
    decompressor = zlib.decompressobj(-15)
    try:
        out = decompressor.decompress(data, cap + 1)
    except zlib.error:
        fail("zip_invalid", "deflate stream is corrupt")
    return out


def safe_entry_name(name: str) -> bool:
    if not name or len(name.encode("utf-8", "surrogatepass")) > limits.MAX_ZIP_NAME_BYTES:
        return False
    if "\x00" in name or "\\" in name or name.startswith("/") or (len(name) > 1 and name[1] == ":"):
        return False
    return ".." not in name.split("/")


class ZipArchive:
    """Central-directory view of an untrusted zip with capped, verified reads of single entries."""

    def __init__(self, data: bytes):
        require(len(data) <= limits.MAX_INPUT_FILE_BYTES, "input_too_large")
        self._data = bytes(data)
        try:
            archive = zipfile.ZipFile(io.BytesIO(self._data))
            infos = archive.infolist()
        except (zipfile.BadZipFile, ValueError, OSError, EOFError, struct.error, NotImplementedError):
            fail("zip_invalid")
        require(len(infos) <= limits.MAX_ZIP_ENTRIES, "zip_invalid", "too many entries")
        self.entries = {}
        for info in infos:
            require(safe_entry_name(info.filename), "zip_entry_unsafe_name")
            require(info.filename not in self.entries, "zip_invalid", "duplicate entry name")
            self.entries[info.filename] = info
        self._decompressed = 0

    def names(self):
        return list(self.entries)

    def _local_payload(self, info):
        offset = info.header_offset
        header = self._data[offset: offset + 30]
        require(len(header) == 30 and header[:4] == b"PK\x03\x04", "zip_invalid", "bad local header")
        name_len, extra_len = struct.unpack("<HH", header[26:30])
        local_name = self._data[offset + 30: offset + 30 + name_len]
        expected = info.orig_filename.encode("utf-8" if info.flag_bits & 0x800 else "cp437", "surrogateescape")
        require(local_name == expected, "zip_invalid", "local header name differs from the central directory")
        start = offset + 30 + name_len + extra_len
        payload = self._data[start: start + info.compress_size]
        require(len(payload) == info.compress_size, "zip_invalid", "truncated entry")
        return payload

    def read(self, name: str) -> bytes:
        info = self.entries.get(name)
        require(info is not None, "missing_required_entry", name)
        require(not info.flag_bits & 0x1, "zip_encrypted")
        require(info.compress_type in (ZIP_STORED, ZIP_DEFLATED, ZIP_ZSTD), "zip_method_unsupported")
        require(info.file_size <= limits.MAX_ENTRY_BYTES, "zip_entry_too_large")
        require(self._decompressed + info.file_size <= limits.MAX_DECOMPRESSED_BYTES, "zip_entry_too_large", "archive decompresses beyond the limit")
        if info.file_size > limits.RATIO_CHECK_ABOVE:
            require(info.file_size <= limits.MAX_ENTRY_RATIO * max(info.compress_size, 1), "zip_ratio_exceeded")
        payload = self._local_payload(info)
        if info.compress_type == ZIP_STORED:
            out = payload
        elif info.compress_type == ZIP_DEFLATED:
            out = _inflate(payload, info.file_size)
        else:
            out = _zstd_decompress(payload, info.file_size)
        require(len(out) == info.file_size, "zip_entry_size_mismatch")
        require(zlib.crc32(out) & 0xFFFFFFFF == info.CRC, "zip_crc_mismatch")
        self._decompressed += len(out)
        return out

    def read_json(self, name: str):
        return loads(decode_text(self.read(name)))
