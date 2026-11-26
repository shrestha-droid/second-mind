import tempfile
import unittest
from pathlib import Path

from sm.index import Index
from tests.helpers import make_vault


def note(title, body="", summary=None):
    s = f'summary: "{summary}"\n' if summary else ""
    return f'---\ntitle: "{title}"\n{s}---\n{body}'


class IndexTest(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.tmp = Path(self._t.name)
        self.addCleanup(self._t.cleanup)

    def ids(self, idx, q):
        return [r["id"] for r in idx.search(q)]

    def test_rebuild_and_search(self):
        make_vault(self.tmp, {
            "shrestha/_index.md": note("Home"),
            "shrestha/a.md": note("Alpha", "mentions zebra once"),
            "shrestha/b.md": note("Zebra", "nothing here"),
        })
        idx = Index(self.tmp)
        self.assertEqual(idx.rebuild(), 3)
        res = idx.search("zebra")
        self.assertEqual([r["id"] for r in res], ["shrestha/b", "shrestha/a"])
        self.assertEqual(set(res[0]), {"id", "title", "snippet"})
        self.assertEqual(res[0]["title"], "Zebra")
        self.assertIn("<mark>zebra</mark>", res[1]["snippet"].lower())
        self.assertTrue((self.tmp / ".index.db").exists())

    def test_update_and_remove(self):
        make_vault(self.tmp, {
            "shrestha/a.md": note("Alpha", "apple"),
            "shrestha/ab.md": note("Alpha two", "apple"),
            "shrestha/work/_index.md": note("Work", "apple"),
            "shrestha/work/x.md": note("X", "apple"),
        })
        idx = Index(self.tmp)
        idx.rebuild()
        (self.tmp / "shrestha/a.md").write_text(note("Alpha", "banana"), encoding="utf-8")
        idx.update("shrestha/a")
        self.assertEqual(self.ids(idx, "banana"), ["shrestha/a"])
        self.assertNotIn("shrestha/a", self.ids(idx, "apple"))
        # new note via update
        make_vault(self.tmp, {"shrestha/new.md": note("New", "cherry")})
        idx.update("shrestha/new")
        self.assertEqual(self.ids(idx, "cherry"), ["shrestha/new"])
        # file gone -> update acts as remove
        (self.tmp / "shrestha/new.md").unlink()
        idx.update("shrestha/new")
        self.assertEqual(self.ids(idx, "cherry"), [])
        # remove: exact id only, not sibling sharing a string prefix
        idx.remove("shrestha/a")
        self.assertEqual(sorted(self.ids(idx, "apple")),
                         ["shrestha/ab", "shrestha/work", "shrestha/work/x"])
        # folder removal takes its subtree
        idx.remove("shrestha/work")
        self.assertEqual(self.ids(idx, "apple"), ["shrestha/ab"])

    def test_prefix(self):
        make_vault(self.tmp, {"shrestha/j.md": note("Jarvis", "assistant")})
        idx = Index(self.tmp)
        idx.rebuild()
        self.assertEqual(self.ids(idx, "jar"), ["shrestha/j"])
        self.assertEqual(self.ids(idx, "jarvis assis"), ["shrestha/j"])

    def test_search_weird_input(self):
        make_vault(self.tmp, {"shrestha/j.md": note("C++ notes", "x")})
        idx = Index(self.tmp)
        idx.rebuild()
        for q in ["c++", '"', "AND", "-x", "*", "(", "", "   ", "NEAR(", "a OR"]:
            self.assertIsInstance(idx.search(q), list, q)
        self.assertEqual(idx.search(""), [])
        self.assertEqual(self.ids(idx, "c++"), ["shrestha/j"])

    def test_raw_not_indexed(self):
        make_vault(self.tmp, {
            "shrestha/a.md": note("A", "visible"),
            "shrestha/_raw/secret.md": note("Secret", "visible"),
            ".trash/t.md": note("Trashed", "visible"),
        })
        idx = Index(self.tmp)
        self.assertEqual(idx.rebuild(), 1)
        self.assertEqual(self.ids(idx, "visible"), ["shrestha/a"])

    def test_title_fallback_and_unreadable_skipped(self):
        make_vault(self.tmp, {
            "shrestha/plain.md": "no frontmatter, findme",
            "shrestha/ok.md": note("Ok", "findme"),
        })
        (self.tmp / "shrestha/bad.md").write_bytes(b"\xff\xfe\x00bad findme")
        idx = Index(self.tmp)
        self.assertEqual(idx.rebuild(), 2)
        titles = {r["id"]: r["title"] for r in idx.search("findme")}
        self.assertEqual(titles, {"shrestha/plain": "plain", "shrestha/ok": "Ok"})

    def test_secrets_redacted_before_indexing(self):
        key = "sk-" + "b" * 30
        make_vault(self.tmp, {"shrestha/k.md": note(f"T {key}", f"my key is {key} ok", summary=f"S {key}")})
        idx = Index(self.tmp)
        idx.rebuild()
        self.assertEqual(self.ids(idx, key), [])
        hits = idx.search("key")
        self.assertEqual([r["id"] for r in hits], ["shrestha/k"])
        self.assertNotIn("b" * 30, repr(idx.search("sk")) + repr(hits))
        idx.update("shrestha/k")
        self.assertNotIn("b" * 30, repr(idx.search("key")))
        self.assertNotIn(b"b" * 30, idx.db.read_bytes())

    def test_limit_and_rebuild_replaces(self):
        make_vault(self.tmp, {f"shrestha/n{i}.md": note(f"N{i}", "common") for i in range(5)})
        idx = Index(self.tmp)
        idx.rebuild()
        self.assertEqual(len(idx.search("common", limit=2)), 2)
        (self.tmp / "shrestha/n0.md").unlink()
        self.assertEqual(idx.rebuild(), 4)
        self.assertEqual(len(idx.search("common")), 4)


if __name__ == "__main__":
    unittest.main()
