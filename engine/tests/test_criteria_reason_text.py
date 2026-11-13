"""Every reason code of docs/design/audit-statistics.md section 4.4 has plain-language limitation text in
engine/criteria.py REASON_TEXT, the same set the hosted runner covers (site-app/lib/hosted-statistics.ts)."""
import re
import unittest
from pathlib import Path

from engine.criteria import REASON_TEXT

DOC = Path(__file__).resolve().parents[2] / "docs" / "design" / "audit-statistics.md"


def reason_code_table():
    text = DOC.read_text(encoding="utf-8")
    start = text.index("### 4.4 Gates and reason codes")
    section = text[start:text.index("\n### ", start + 1)]
    return [code for line in section.splitlines() if line.startswith("| `") for code in re.findall(r"`([a-z0-9_]+)`", line.split("|")[1])]


class ReasonTextTests(unittest.TestCase):
    def test_every_table_code_has_text(self):
        codes = reason_code_table()
        self.assertGreater(len(codes), 20)
        self.assertIn("interval_requires_engine", codes)
        for code in codes:
            with self.subTest(code=code):
                self.assertRegex(REASON_TEXT.get(code, ""), r"\w{4}.*\.")


if __name__ == "__main__":
    unittest.main()
