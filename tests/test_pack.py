import tempfile
import unittest
from datetime import date
from pathlib import Path

from sm.pack import build_pack
from sm.redact import estimate_tokens, redact
from tests.helpers import make_vault

TODAY = date(2026, 11, 25)


def note(body="", **meta):
    fm = "".join(f"{k}: {v}\n" for k, v in meta.items())
    return f"---\n{fm}---\n{body}"


class RedactTest(unittest.TestCase):
    def test_redact(self):
        secrets = [
            "sk-" + "a" * 20, "ghp_" + "A" * 36, "github_pat_" + "b" * 22,
            "AKIA" + "0" * 16, "xoxb-1234567890-abc",
            "-----BEGIN RSA PRIVATE KEY-----\nMIIE\nabc\n-----END RSA PRIVATE KEY-----",
        ]
        for s in secrets:
            self.assertEqual(redact(f"key {s} end"), "key [REDACTED] end", s)
        plain = "sk-short, ghp_tooshort, AKIA123, xoxz-1234567890, plain text."
        self.assertEqual(redact(plain), plain)

    def test_redact_word_boundary(self):
        text = "[[shrestha/work/risk-assessment-for-the-platform]] task-tracking-and-follow-up-system"
        self.assertEqual(redact(text), text)
        for pre in ("OPENAI_API_KEY=", 'key: "', "_", ""):
            self.assertEqual(redact(f"{pre}sk-{'a' * 24}"), f"{pre}[REDACTED]", pre)

    def test_estimate_tokens(self):
        self.assertEqual(estimate_tokens(""), 0)
        self.assertEqual(estimate_tokens("abcde"), 2)


class PackTest(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.addCleanup(self._t.cleanup)
        self.vault = make_vault(Path(self._t.name), {
            "shrestha/_index.md": note(title="Shrestha", summary="Root summary", updated="2026-11-20"),
            "shrestha/work/_index.md": note(title="Work", summary="Work summary", updated="2026-09-01"),
            "shrestha/work/node.md": note(
                "Node body [[shrestha/work/new]] [[shrestha/work/old]] [[shrestha/work/pin]]\n",
                title="Node", summary="Node summary", updated="2026-11-24"),
            "shrestha/work/new.md": note(title="New", summary="newest", updated="2026-11-23"),
            "shrestha/work/old.md": note(title="Old", summary="older", updated="2026-11-01"),
            "shrestha/work/pin.md": note(title="Pin", summary="pinned one", updated="2026-10-01", pinned="true"),
            "shrestha/work/back.md": note("see [[shrestha/work/node]]", title="Back", summary="a backlink",
                                          updated="2026-11-22"),
        })

    def pack(self, **kw):
        return build_pack(self.vault, "shrestha/work/node", today=TODAY, **kw)

    def test_pack_order(self):
        p = self.pack()
        t = p["text"]
        self.assertTrue(t.startswith("# Context pack: Shrestha › Work › Node (≈"))
        self.assertIn(f"(≈{p['tokens']} tokens)", t.splitlines()[0])
        self.assertEqual(p["tokens"], estimate_tokens(t))
        self.assertLess(t.index("## Path"), t.index("## Note: Node"))
        self.assertLess(t.index("## Note: Node"), t.index("## Linked"))
        self.assertIn("- Shrestha (updated 2026-11-20): Root summary", t)
        self.assertIn("- Work (updated 2026-09-01, STALE): Work summary", t)
        self.assertIn("Node summary", t)
        self.assertIn("Node body", t)
        self.assertEqual(p["included"], [
            "shrestha/work/pin", "shrestha/work/new", "shrestha/work/back", "shrestha/work/old"])
        self.assertEqual(p["omitted"], [])
        self.assertIn("- [[shrestha/work/pin]] Pin: pinned one", t)
        self.assertNotIn("## Left out", t)

    def test_pack_budget(self):
        full = self.pack()
        budget = full["tokens"] - 7
        p = self.pack(budget=budget)
        self.assertLessEqual(p["tokens"], budget)
        self.assertEqual(p["tokens"], estimate_tokens(p["text"]))
        self.assertTrue(p["omitted"])
        self.assertEqual(p["included"] + p["omitted"], full["included"])
        self.assertIn("## Left out", p["text"])
        self.assertIn("- … and 2 more", p["text"])
        self.assertEqual(p["included"][:1], ["shrestha/work/pin"])

    def test_pack_long_body_and_left_out_lines(self):
        make_vault(self.vault, {"shrestha/work/node.md": note(
            "x" * 2000 + "\n[[shrestha/work/new]] [[shrestha/work/old]] [[shrestha/work/pin]]",
            title="Node", summary="Node summary", updated="2026-11-24")})
        p = self.pack(budget=76)
        self.assertIn("(body omitted)", p["text"])
        self.assertNotIn("xxxx", p["text"])
        self.assertLessEqual(p["tokens"], 76)
        self.assertEqual(p["included"], ["shrestha/work/pin"])
        self.assertEqual(p["omitted"], ["shrestha/work/new", "shrestha/work/back", "shrestha/work/old"])
        self.assertTrue(p["text"].endswith("## Left out\n- [[shrestha/work/new]] New\n- … and 2 more\n"))

    def test_pack_minimum_over_budget(self):
        p = self.pack(budget=10)
        t = p["text"]
        self.assertIn("Root summary", t)
        self.assertIn("Work summary", t)
        self.assertIn("## Note: Node", t)
        self.assertIn("Node summary", t)
        self.assertIn("(body omitted)", t)
        self.assertNotIn("Node body", t)
        self.assertEqual(p["included"], [])
        self.assertEqual(len(p["omitted"]), 4)

    def test_pack_inbox_excluded(self):
        make_vault(self.vault, {
            "inbox/x.md": note("[[shrestha/work/node]]", title="X", summary="from inbox", updated="2026-11-24")})
        p = self.pack()
        self.assertNotIn("inbox/x", p["text"])
        self.assertNotIn("inbox/x", p["included"] + p["omitted"])
        p = self.pack(include=["inbox/x"])
        self.assertEqual(p["included"][0], "inbox/x")
        self.assertIn("- [[inbox/x]] X: from inbox", p["text"])

    def test_pack_exclude(self):
        p = self.pack(exclude=["shrestha/work/pin", "shrestha/work/new"], include=["shrestha/work/new"])
        self.assertEqual(p["included"], ["shrestha/work/back", "shrestha/work/old"])
        self.assertNotIn("- [[shrestha/work/new]]", p["text"])
        self.assertNotIn("shrestha/work/pin", p["omitted"])

    def test_pack_include_non_link_and_missing(self):
        p = self.pack(include=["shrestha/work/nope", "shrestha/_nope"])
        self.assertEqual(p["included"][0], "shrestha/work/pin")
        make_vault(self.vault, {"shrestha/other.md": note(title="Other", summary="not linked", updated="2026-11-01")})
        p = self.pack(include=["shrestha/other", "shrestha/work/nope"])
        self.assertEqual(p["included"][0], "shrestha/other")

    def test_pack_missing_ancestor_note(self):
        make_vault(self.vault, {"shrestha/gap/deep/leaf.md": note("hi", title="Leaf", summary="L", updated="2026-11-24")})
        p = build_pack(self.vault, "shrestha/gap/deep/leaf", today=TODAY)
        self.assertIn("- gap (updated ?, STALE)", p["text"])
        self.assertIn("› gap › deep › Leaf", p["text"].splitlines()[0])

    def test_pack_unknown_id(self):
        with self.assertRaises(FileNotFoundError):
            build_pack(self.vault, "shrestha/nope", today=TODAY)

    def test_pack_redacts(self):
        make_vault(self.vault, {"shrestha/work/node.md": note(
            "token ghp_" + "Z" * 36 + "\n", title="Node", summary="Node summary", updated="2026-11-24")})
        p = self.pack()
        self.assertIn("[REDACTED]", p["text"])
        self.assertNotIn("ghp_", p["text"])


if __name__ == "__main__":
    unittest.main()
