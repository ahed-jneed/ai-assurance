"""Bounded local snapshots: Parquet and fixed-shape read-only SQLite SELECT."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import sqlite3
import time
from pathlib import Path

from .diagnostics import MAX_BYTES, MAX_COLUMNS, MAX_ROWS, canonical_bytes, read_csv, sha256

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")


def cell(value):
    if value is None:
        return ""
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Snapshot contains a non-finite numeric value")
    if not isinstance(value, (str, int, float, bool)):
        raise ValueError("Snapshot supports scalar text, numeric, boolean and null values only")
    return str(value)


def read_parquet(path):
    source = Path(path)
    if not source.is_file() or source.stat().st_size > MAX_BYTES:
        raise ValueError("Parquet must be an existing file within the input size limit")
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise ValueError("Parquet capability unavailable: pyarrow is not installed") from exc
    # Read one bounded byte snapshot; compressed bytes and decoded volume are
    # separately constrained. Worker memory isolation still remains required.
    data = source.read_bytes()
    parquet = pq.ParquetFile(pa.BufferReader(data))
    columns = parquet.schema_arrow.names
    if not columns or len(columns) > MAX_COLUMNS or len(set(columns)) != len(columns) or any(not name.strip() for name in columns):
        raise ValueError("Invalid Parquet column names")
    if parquet.metadata.num_rows > MAX_ROWS:
        raise ValueError("Parquet exceeds row limit")
    rows, decoded_bytes = [], 0
    for batch in parquet.iter_batches(batch_size=4096):
        decoded_bytes += batch.nbytes
        if decoded_bytes > MAX_BYTES:
            raise ValueError("Decoded Parquet data exceeds size limit")
        rows.extend({name: cell(value) for name, value in row.items()} for row in batch.to_pylist())
    if not rows:
        raise ValueError("Parquet contains no observations")
    return rows, {"name": source.name, "sha256": sha256(data), "bytes": len(data), "rowCount": len(rows), "columns": columns, "format": "parquet", "decodedBytes": decoded_bytes, "connectorVersion": "1.0.0"}


def read_dataset(path):
    return read_parquet(path) if Path(path).suffix.lower() in {".parquet", ".pq"} else read_csv(path)


def readonly_sqlite(path):
    source = Path(path).resolve(strict=True)
    if not source.is_file():
        raise ValueError("SQLite source must be an existing file")
    connection = sqlite3.connect(source.as_uri()+"?mode=ro", uri=True, timeout=5)
    # Builds without loadable-extension support (python.org macOS) lack this method and cannot load extensions at all.
    if hasattr(connection, "enable_load_extension"):
        connection.enable_load_extension(False)
    connection.execute("PRAGMA query_only = ON")
    connection.execute("PRAGMA trusted_schema = OFF")
    deadline = time.monotonic()+20
    connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 10_000)
    return connection


def sqlite_snapshot(path, spec):
    """No SQL text accepted: identifiers are validated and values parameterized.

    Use a table (not a view), an explicit unique order key, optional numeric
    inclusive lower/exclusive upper bound and a hard row limit. A database
    read transaction pins the query snapshot; provenance hashes exported rows.
    """
    allowed = {"table", "columns", "orderBy", "boundColumn", "lower", "upper", "limit"}
    if not isinstance(spec, dict) or set(spec)-allowed:
        raise ValueError("Invalid SQLite snapshot specification")
    names = [spec.get("table"), spec.get("orderBy")]
    columns = spec.get("columns")
    if not isinstance(columns, list) or not columns or len(columns) > MAX_COLUMNS or any(not isinstance(name, str) for name in columns) or len(set(columns)) != len(columns):
        raise ValueError("Snapshot requires unique fixed columns")
    names += columns
    if "boundColumn" in spec:
        names.append(spec["boundColumn"])
    if any(not isinstance(name, str) or not IDENTIFIER.fullmatch(name) for name in names):
        raise ValueError("Invalid SQL identifier")
    limit = spec.get("limit", 100_000)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_ROWS:
        raise ValueError("Invalid SQL snapshot limit")
    for key in ("lower", "upper"):
        if key in spec:
            value = spec[key]
            if "boundColumn" not in spec or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError("Numeric bounds require boundColumn and finite numeric values")
    if "lower" in spec and "upper" in spec and spec["lower"] >= spec["upper"]:
        raise ValueError("Snapshot lower bound must precede upper bound")
    quote = lambda name: '"'+name+'"'
    connection = readonly_sqlite(path)
    try:
        connection.execute("BEGIN")
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (spec["table"],)).fetchone():
            raise ValueError("Snapshot source must be a real table, not a view")
        actual = {row[1] for row in connection.execute("PRAGMA table_info("+quote(spec["table"])+")")}
        if not set(names[1:]).issubset(actual):
            raise ValueError("Snapshot contains unknown column names")
        # A unique order key is necessary for repeatable bounded snapshots.
        unique = connection.execute("SELECT COUNT(*) = COUNT(DISTINCT "+quote(spec["orderBy"])+") FROM "+quote(spec["table"])).fetchone()[0]
        if not unique:
            raise ValueError("Snapshot orderBy must be unique and non-null")
        conditions, parameters = [], []
        for key, operator in (("lower", ">="), ("upper", "<")):
            if key in spec:
                conditions.append(quote(spec["boundColumn"])+" "+operator+" ?")
                parameters.append(spec[key])
        sql = "SELECT "+", ".join(map(quote, columns))+" FROM "+quote(spec["table"])
        if conditions:
            sql += " WHERE "+" AND ".join(conditions)
        sql += " ORDER BY "+quote(spec["orderBy"])+" LIMIT ?"
        parameters.append(limit+1)
        raw = connection.execute(sql, parameters).fetchall()
        if len(raw) > limit:
            raise ValueError("Snapshot row limit would truncate the selected population; narrow bounds or increase the approved limit")
        rows = [{name: cell(value) for name, value in zip(columns, row)} for row in raw]
        if not rows:
            raise ValueError("SQLite snapshot contains no observations")
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
        data = output.getvalue().encode("utf-8")
        if len(data) > MAX_BYTES:
            raise ValueError("SQLite snapshot exceeds exported-byte limit")
        return data, {"schemaVersion": "1.0", "connectorVersion": "1.0.0", "sourceName": Path(path).name, "sourceKind": "sqlite_read_only", "snapshotSha256": sha256(data), "specification": spec, "specificationSha256": sha256(canonical_bytes(spec)), "rowCount": len(rows), "bytes": len(data), "isolation": "SQLite read transaction; mode=ro; query_only; no user SQL"}
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description="Create a read-only SQLite CSV evidence snapshot")
    parser.add_argument("--database", required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    data, manifest = sqlite_snapshot(args.database, json.loads(Path(args.spec).read_text(encoding="utf-8")))
    with Path(args.output).open("xb") as handle:
        handle.write(data)
    with Path(args.output+".manifest.json").open("x", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
