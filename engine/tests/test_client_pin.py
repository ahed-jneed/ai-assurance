import ast
import base64
import hashlib
import io
import json
import socket
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from engine import client_pin
from engine.client_pin import PinError, header_columns, main, parse_statement, pin_fields, spki_from_pem, statement_bytes, verify_pin

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
except ImportError:  # pragma: no cover - the optional runtime is absent
    Ed25519PrivateKey = None

requires_cryptography = unittest.skipIf(Ed25519PrivateKey is None, "cryptography is not installed")
FIXTURES = Path(__file__).resolve().parent/"fixtures"/"client-pin"
# A fictional client's test key: the seed of the attested fixture's signature.
FIXTURE_SEED = bytes(range(32))
ROWS = "label,prediction,ethnicity\n1,1,group-alpha\n0,1,group-beta\n"


def run_cli(*argv):
    out, err = io.BytesIO(), io.StringIO()
    stdout = io.TextIOWrapper(out, encoding="utf-8")
    with redirect_stdout(stdout), redirect_stderr(err):
        code = main(list(argv))
        stdout.flush()
    return code, out.getvalue().decode("utf-8"), err.getvalue()


def no_network(*args, **kwargs):
    raise AssertionError("The pin tool opened a network connection")


class ClientPinTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.data = self.root/"client-data.csv"
        self.data.write_bytes(ROWS.encode("utf-8"))

    def tearDown(self):
        self.temporary.cleanup()

    def test_pin_matches_the_file_and_reads_columns_as_the_worker_does(self):
        fields = pin_fields(self.data, "Dana Client, data protection officer", "2026-11-05")
        self.assertEqual(fields["sha256"], hashlib.sha256(ROWS.encode()).hexdigest())
        self.assertEqual(fields["size"], len(ROWS.encode()))
        self.assertEqual(fields["columns"], ["label", "prediction", "ethnicity"])
        self.assertEqual(fields["name"], "client-data.csv")
        # A byte order mark and quoted names are read as the worker's csv reader reads them.
        bom = self.root/"bom.csv"
        bom.write_bytes(b'\xef\xbb\xbf"label","pr\xc3\xa9diction, final",group\r\n1,1,a\r\n')
        self.assertEqual(header_columns(bom), ["label", "prédiction, final", "group"])
        for content, message in ((b"label,label\n1,1\n", "unique"), (b"label,,x\n", "nonempty"),
                (b"\xff\xfelabel\n", "UTF-8"), (b"", "empty")):
            bad = self.root/"bad.csv"
            bad.write_bytes(content)
            with self.assertRaisesRegex(PinError, message):
                pin_fields(bad, "Dana Client, DPO", "2026-11-05")
        with self.assertRaisesRegex(PinError, "100 MB"), patch.object(client_pin, "MAX_BYTES", 10):
            client_pin.file_digest(self.data)

    def test_the_tool_never_opens_a_connection_or_imports_a_network_module(self):
        tree = ast.parse(Path(client_pin.__file__).read_text(encoding="utf-8"))
        imported = {alias.name.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
        imported |= {node.module.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module}
        self.assertFalse(imported & {"socket", "http", "urllib", "ssl", "requests", "ftplib", "smtplib"})
        with patch.object(socket, "socket", no_network), patch.object(socket, "create_connection", no_network):
            code, out, err = run_cli("pin", "--file", str(self.data), "--confirmed-by", "Dana Client, DPO", "--confirmed-on", "2026-11-05")
        self.assertEqual(code, 0, err)
        document = json.loads(out)
        self.assertEqual(set(document), {"name", "sha256", "size", "columns", "confirmedBy", "confirmedOn"})
        # The pin carries no row: only the header names appear.
        self.assertNotIn("group-alpha", out)

    def test_statement_is_canonical_and_refuses_other_documents(self):
        fields = pin_fields(self.data, "Dana Client, DPO", "2026-11-05")
        statement = statement_bytes(fields)
        self.assertEqual(statement, json.dumps(json.loads(statement), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())
        self.assertEqual(parse_statement(statement)["sha256"], fields["sha256"])
        for change in ({"kind": "other"}, {"extra": 1}, {"size": 0}, {"sha256": "ABC"}):
            with self.assertRaises(PinError):
                parse_statement(json.dumps({**fields, **change}).encode())

    def test_openssl_style_attach_builds_the_same_attestation_without_cryptography_signing(self):
        if Ed25519PrivateKey is None:
            self.skipTest("cryptography is not installed")
        key = Ed25519PrivateKey.from_private_bytes(FIXTURE_SEED)
        code, _, err = run_cli("pin", "--file", str(self.data), "--confirmed-by", "Dana Client, DPO", "--confirmed-on", "2026-11-05",
            "--statement-out", str(self.root/"statement.json"), "--output", str(self.root/"unsigned.json"))
        self.assertEqual(code, 0, err)
        statement = (self.root/"statement.json").read_bytes()
        (self.root/"statement.sig").write_bytes(key.sign(statement))
        (self.root/"key.pub.pem").write_bytes(key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
        with patch.object(client_pin, "_cryptography", side_effect=AssertionError("attach needs no cryptography")):
            code, _, err = run_cli("attach", "--statement", str(self.root/"statement.json"), "--signature", str(self.root/"statement.sig"),
                "--public-key", str(self.root/"key.pub.pem"), "--output", str(self.root/"pin.json"))
        self.assertEqual(code, 0, err)
        document = json.loads((self.root/"pin.json").read_text(encoding="utf-8"))
        self.assertEqual(verify_pin(document, file=self.data)["attested"], True)
        with self.assertRaisesRegex(PinError, "Ed25519"):
            spki_from_pem("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----")

    @requires_cryptography
    def test_signed_pin_verifies_and_any_change_is_refused(self):
        key_path = self.root/"client-key.pem"
        code, out, err = run_cli("keygen", "--output", str(key_path))
        self.assertEqual(code, 0, err)
        fingerprint = json.loads(out)["keySha256"]
        code, out, err = run_cli("pin", "--file", str(self.data), "--confirmed-by", "Dana Client, DPO", "--confirmed-on", "2026-11-05", "--key", str(key_path))
        self.assertEqual(code, 0, err)
        document = json.loads(out)
        self.assertEqual(document["attestation"]["keySha256"], fingerprint)
        self.assertEqual(verify_pin(document, file=self.data, expected_key=fingerprint),
            {"attested": True, "keySha256": fingerprint, "file": "matches", "sha256": document["sha256"], "size": document["size"]})
        with self.assertRaisesRegex(PinError, "another key"):
            verify_pin(document, expected_key="0"*64)
        with self.assertRaisesRegex(PinError, "size differs"):
            verify_pin({**document, "size": document["size"] + 1})
        tampered = json.loads(base64.b64decode(document["attestation"]["statement"]))
        tampered["confirmedBy"] = "Someone else"
        forged = {**document["attestation"], "statement": base64.b64encode(json.dumps(tampered).encode()).decode()}
        with self.assertRaisesRegex(PinError, "does not verify"):
            verify_pin({**document, "attestation": forged})
        self.data.write_bytes(ROWS.replace("1,1", "0,1", 1).encode())
        with self.assertRaisesRegex(PinError, "file differs"):
            verify_pin(document, file=self.data)
        # Outputs are created once.
        code, _, err = run_cli("keygen", "--output", str(key_path))
        self.assertEqual(code, 2)

    @requires_cryptography
    def test_committed_platform_fixture_is_reproducible(self):
        """The fixture the platform's Vitest verifies is this tool's own output for a fixed test key."""
        fixture = json.loads((FIXTURES/"attested-pin.json").read_text(encoding="utf-8"))
        data = (FIXTURES/"client-data.csv").read_bytes()
        key_path = self.root/"fixture-key.pem"
        key_path.write_bytes(Ed25519PrivateKey.from_private_bytes(FIXTURE_SEED).private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        (self.root/"client-data.csv").write_bytes(data)
        code, out, err = run_cli("pin", "--file", str(self.root/"client-data.csv"), "--confirmed-by", fixture["confirmedBy"],
            "--confirmed-on", fixture["confirmedOn"], "--key", str(key_path))
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out), fixture)
        self.assertTrue(verify_pin(fixture, file=FIXTURES/"client-data.csv")["attested"])


if __name__ == "__main__":
    unittest.main()
