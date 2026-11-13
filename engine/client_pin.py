"""Client dataset pin tool: hash a client-held file locally and attest the pin.

For a client that keeps its dataset (#102, #134) and has no enrolled worker.
It reads the file in the client's environment and prints the fields of the
platform's "Pin client dataset" form: the file name, exact byte size,
SHA-256 and the header columns, read as the worker reads them. It opens no
network connection and uploads nothing; the person who runs it carries the
small pin file (never the dataset) to the auditor.

A pin can carry the client's attestation: a detached Ed25519 signature,
made with a key the client controls, over the exact bytes of a statement of
the pin (see engine/RUNTIME_PACKAGE.md, "Client dataset pins"). The platform
verifies it when the pin is recorded; ``verify`` checks it here.

    python -m engine.client_pin pin --file data.csv --confirmed-by "Name, role" --output pin.json
    python -m engine.client_pin keygen --output client-key.pem
    python -m engine.client_pin pin --file data.csv --confirmed-by "Name, role" --key client-key.pem --output pin.json
    python -m engine.client_pin attach --statement statement.json --signature statement.sig --public-key client-key.pub.pem --output pin.json
    python -m engine.client_pin verify --pin pin.json [--file data.csv] [--key-sha256 HEX]

The core path (hashing, columns, statement, attaching an external signature)
needs only the standard library; signing and verifying here need the
optional ``cryptography`` package, or sign with OpenSSL instead.
"""
from __future__ import annotations

import argparse
import base64
import codecs
import csv
import datetime
import hashlib
import io
import json
import re
import sys
from pathlib import Path

PIN_KIND = "assurance.client-dataset-pin"
PIN_SCHEMA = "1.0"
# The external route's dataset bound (queueExternal and the worker).
MAX_BYTES = 100 * 1024 * 1024
MAX_COLUMNS = 1000
MAX_COLUMN = 300
MAX_PERSON = 300
# Bytes read from the start of the file to find its header row.
HEADER_BYTES = 1024 * 1024
STATEMENT_BYTES = 256 * 1024
# The DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410); the key follows.
ED25519_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")
FIELDS = ("columns", "confirmedBy", "confirmedOn", "kind", "name", "schemaVersion", "sha256", "size")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
HEX64 = re.compile(r"[a-f0-9]{64}")
BAD_NAME = re.compile(r"[\x00-\x1f/\\]")


class PinError(ValueError):
    pass


def _expect(condition, message):
    if not condition:
        raise PinError(message)


def file_digest(path):
    """SHA-256 and byte count of a regular file, read in chunks."""
    source = Path(path)
    _expect(source.is_file() and not source.is_symlink(), "Give an existing regular file, not a link or folder")
    digest, size = hashlib.sha256(), 0
    with source.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
            _expect(size <= MAX_BYTES, "Client-held datasets are limited to 100 MB")
    _expect(size > 0, "The file is empty")
    return digest.hexdigest(), size


def header_columns(path):
    """The header row as the worker reads it: UTF-8 (BOM allowed) CSV, names kept exactly."""
    with Path(path).open("rb") as handle:
        head = handle.read(HEADER_BYTES)
    try:
        # A multi-byte character cut at the read limit is not an error.
        text = codecs.getincrementaldecoder("utf-8-sig")().decode(head, final=len(head) < HEADER_BYTES)
    except UnicodeDecodeError as exc:
        raise PinError("The worker reads CSV as UTF-8; this file's header is not UTF-8") from exc
    _expect(len(head) < HEADER_BYTES or "\n" in text or "\r" in text, "The header row must end within the first 1 MB")
    try:
        row = next(csv.reader(io.StringIO(text, newline=""), strict=True))
    except (StopIteration, csv.Error) as exc:
        raise PinError("The file does not start with a CSV header row within its first 1 MB") from exc
    _expect(row and len(row) <= MAX_COLUMNS, f"The header must name 1 to {MAX_COLUMNS} columns")
    _expect(all(c.strip() for c in row) and len(set(row)) == len(row), "The worker needs unique, nonempty column names")
    _expect(all(len(c) <= MAX_COLUMN for c in row), f"Column names are limited to {MAX_COLUMN} characters")
    return row


def pin_fields(path, confirmed_by, confirmed_on):
    """The statement the client confirms: everything the platform records about the file."""
    source = Path(path)
    name = source.name
    _expect(1 <= len(name) <= 200 and not BAD_NAME.search(name), "The file name must be 1 to 200 characters without a path")
    confirmed_by = (confirmed_by or "").strip()
    _expect(1 <= len(confirmed_by) <= MAX_PERSON, "Give who at the client confirms the pin (name and role)")
    _expect(bool(DATE.fullmatch(confirmed_on or "")), "Give the confirmation date as YYYY-MM-DD")
    datetime.date.fromisoformat(confirmed_on)
    sha256, size = file_digest(source)
    return {"kind": PIN_KIND, "schemaVersion": PIN_SCHEMA, "name": name, "sha256": sha256, "size": size,
        "columns": header_columns(source), "confirmedBy": confirmed_by, "confirmedOn": confirmed_on}


def statement_bytes(fields):
    """The exact bytes the client signs: canonical JSON (sorted keys, no spaces, UTF-8)."""
    return json.dumps({key: fields[key] for key in FIELDS}, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def parse_statement(data):
    """The pin fields of statement bytes, refusing anything but a pin statement."""
    _expect(isinstance(data, bytes) and 0 < len(data) <= STATEMENT_BYTES, "The statement must be 1 B to 256 KiB")
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PinError("The statement is not UTF-8 JSON") from exc
    _expect(isinstance(value, dict) and set(value) == set(FIELDS), "The statement must hold exactly the pin fields")
    _expect(value["kind"] == PIN_KIND and value["schemaVersion"] == PIN_SCHEMA, "This is not a client dataset pin statement")
    _expect(isinstance(value["sha256"], str) and bool(HEX64.fullmatch(value["sha256"])), "Invalid SHA-256 in the statement")
    _expect(type(value["size"]) is int and 1 <= value["size"] <= MAX_BYTES, "Invalid size in the statement")
    _expect(isinstance(value["columns"], list) and 1 <= len(value["columns"]) <= MAX_COLUMNS
        and all(isinstance(c, str) and c.strip() and len(c) <= MAX_COLUMN for c in value["columns"]), "Invalid columns in the statement")
    _expect(all(isinstance(value[k], str) for k in ("name", "confirmedBy", "confirmedOn")), "Invalid text in the statement")
    return value


def spki_from_pem(text):
    """The DER SubjectPublicKeyInfo of a PEM Ed25519 public key, without third-party code."""
    match = re.search(r"-----BEGIN PUBLIC KEY-----(.*?)-----END PUBLIC KEY-----", text, re.S)
    _expect(bool(match), "Give a PEM public key (-----BEGIN PUBLIC KEY-----)")
    try:
        der = base64.b64decode("".join(match.group(1).split()), validate=True)
    except ValueError as exc:
        raise PinError("The PEM public key is not valid base64") from exc
    _expect(len(der) == 44 and der.startswith(ED25519_SPKI_PREFIX), "Only Ed25519 public keys are supported")
    return der


def key_sha256(spki):
    """The key's fingerprint: SHA-256 of its DER SubjectPublicKeyInfo, hex."""
    return hashlib.sha256(spki).hexdigest()


def attestation(statement, signature, spki):
    _expect(len(signature) == 64, "An Ed25519 signature has 64 bytes")
    _expect(len(spki) == 44 and spki.startswith(ED25519_SPKI_PREFIX), "Only Ed25519 public keys are supported")
    return {"algorithm": "Ed25519", "statement": base64.b64encode(statement).decode("ascii"),
        "signature": base64.b64encode(signature).decode("ascii"), "publicKeySPKI": base64.b64encode(spki).decode("ascii"),
        "keySha256": key_sha256(spki)}


def pin_document(fields, signed=None):
    """What the platform's pin form takes: the fields, plus the attestation when signed."""
    document = {key: fields[key] for key in ("name", "sha256", "size", "columns", "confirmedBy", "confirmedOn")}
    if signed:
        document["attestation"] = signed
    return document


def _cryptography():
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
    except ImportError as exc:
        raise PinError("Signing and verifying here need the optional cryptography package; or sign the statement with OpenSSL and use attach") from exc
    return serialization, Ed25519PrivateKey, Ed25519PublicKey


def sign(statement, private_key_path):
    """A detached Ed25519 signature over the statement with the client's own PEM key."""
    serialization, Ed25519PrivateKey, _ = _cryptography()
    try:
        key = serialization.load_pem_private_key(Path(private_key_path).read_bytes(), password=None)
    except (OSError, ValueError, TypeError) as exc:
        raise PinError("Give an existing unencrypted Ed25519 PEM private key") from exc
    _expect(isinstance(key, Ed25519PrivateKey), "Only Ed25519 private keys are supported")
    spki = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return attestation(statement, key.sign(statement), spki)


def verify_attestation(signed):
    """The pin fields of a signed statement, after checking the Ed25519 signature."""
    serialization, _, Ed25519PublicKey = _cryptography()
    _expect(isinstance(signed, dict) and signed.get("algorithm") == "Ed25519", "Only Ed25519 attestations are supported")
    try:
        statement = base64.b64decode(signed["statement"], validate=True)
        signature = base64.b64decode(signed["signature"], validate=True)
        spki = base64.b64decode(signed["publicKeySPKI"], validate=True)
    except (KeyError, TypeError, ValueError) as exc:
        raise PinError("The attestation needs base64 statement, signature and publicKeySPKI") from exc
    _expect(len(spki) == 44 and spki.startswith(ED25519_SPKI_PREFIX), "Only Ed25519 public keys are supported")
    key = serialization.load_der_public_key(spki)
    _expect(isinstance(key, Ed25519PublicKey), "Only Ed25519 public keys are supported")
    try:
        key.verify(signature, statement)
    except Exception as exc:  # cryptography raises InvalidSignature
        raise PinError("The attestation's signature does not verify") from exc
    return parse_statement(statement), key_sha256(spki)


def verify_pin(document, *, file=None, expected_key=None):
    """Checks a pin file: its attestation signs exactly its fields, and optionally the file and key."""
    _expect(isinstance(document, dict), "A pin file holds a JSON object")
    result = {"attested": False}
    if "attestation" in document:
        fields, fingerprint = verify_attestation(document["attestation"])
        _expect(fingerprint == document["attestation"].get("keySha256", fingerprint), "keySha256 is not the key's fingerprint")
        for key in ("name", "sha256", "size", "columns", "confirmedBy", "confirmedOn"):
            _expect(document.get(key) == fields[key], "The pin's " + key + " differs from the signed statement")
        result.update(attested=True, keySha256=fingerprint)
    else:
        _expect(expected_key is None, "The pin carries no attestation")
    if expected_key is not None:
        _expect(result.get("keySha256") == expected_key.lower(), "The attestation was signed by another key")
    if file is not None:
        sha256, size = file_digest(file)
        _expect(sha256 == document.get("sha256") and size == document.get("size"), "The file differs from the pin")
        _expect(header_columns(file) == document.get("columns"), "The file's columns differ from the pin")
        result["file"] = "matches"
    result.update(sha256=document.get("sha256"), size=document.get("size"))
    return result


def _write(path, data):
    target = Path(path)
    with target.open("xb") as handle:
        handle.write(data)


def _json(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m engine.client_pin", description="Pin a client-held dataset locally; uploads nothing.")
    commands = parser.add_subparsers(dest="command", required=True)
    pin = commands.add_parser("pin", help="Hash a file and print its pin")
    pin.add_argument("--file", required=True)
    pin.add_argument("--confirmed-by", required=True, help="Who at the client confirms the pin: name and role")
    pin.add_argument("--confirmed-on", default=datetime.date.today().isoformat(), help="YYYY-MM-DD (default: today)")
    pin.add_argument("--key", help="The client's Ed25519 PEM private key: attest the pin (needs cryptography)")
    pin.add_argument("--statement-out", help="Also write the statement bytes, to sign with OpenSSL")
    pin.add_argument("--output", help="Write the pin file here (created once) instead of printing it")
    keygen = commands.add_parser("keygen", help="Create the client's Ed25519 key pair (needs cryptography)")
    keygen.add_argument("--output", required=True, help="Private key PEM; the public key goes to <output>.pub.pem")
    attach = commands.add_parser("attach", help="Build a pin file from a statement and an OpenSSL signature")
    attach.add_argument("--statement", required=True)
    attach.add_argument("--signature", required=True, help="The raw 64-byte Ed25519 signature")
    attach.add_argument("--public-key", required=True, help="The client's PEM public key")
    attach.add_argument("--output")
    verify = commands.add_parser("verify", help="Check a pin file's attestation, and optionally the file")
    verify.add_argument("--pin", required=True)
    verify.add_argument("--file")
    verify.add_argument("--key-sha256", help="The client's key fingerprint, confirmed independently")
    args = parser.parse_args(argv)
    try:
        if args.command == "keygen":
            serialization, Ed25519PrivateKey, _ = _cryptography()
            key = Ed25519PrivateKey.generate()
            _write(args.output, key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
            _write(args.output + ".pub.pem", public)
            output = {"privateKey": str(Path(args.output).resolve()), "publicKey": str(Path(args.output + ".pub.pem").resolve()),
                "keySha256": key_sha256(spki_from_pem(public.decode("ascii")))}
            print(json.dumps(output, indent=2))
            return 0
        if args.command == "verify":
            document = json.loads(Path(args.pin).read_text(encoding="utf-8-sig"))
            print(json.dumps(verify_pin(document, file=args.file, expected_key=args.key_sha256), indent=2))
            return 0
        if args.command == "attach":
            statement = Path(args.statement).read_bytes()
            fields = parse_statement(statement)
            signed = attestation(statement, Path(args.signature).read_bytes(), spki_from_pem(Path(args.public_key).read_text(encoding="ascii")))
            document = pin_document(fields, signed)
        else:
            fields = pin_fields(args.file, args.confirmed_by, args.confirmed_on)
            statement = statement_bytes(fields)
            if args.statement_out:
                _write(args.statement_out, statement)
            document = pin_document(fields, sign(statement, args.key) if args.key else None)
        if args.output:
            _write(args.output, _json(document))
        else:
            sys.stdout.buffer.write(_json(document))
            sys.stdout.flush()
    except (PinError, OSError, ValueError) as exc:
        print(f"Client pin rejected: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
