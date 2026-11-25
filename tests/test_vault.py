import os
import tempfile
import unittest
from datetime import date
from pathlib import Path

from sm.vault import (
    Conflict, dump_note, is_stale, note_path, parse_note, read_note,
    slugify, tree, valid_id, write_note, all_ids,
)
from tests.helpers import make_vault


class TmpCase(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.tmp = Path(d.name)


class TestFrontmatter(unittest.TestCase):
    def test_roundtrip(self):
        meta = {"title": "Internal work", "type": "area",
                "links": ["[[shrestha/builds/jarvis]]"], "pinned": False}
        self.assertEqual(parse_note(dump_note(meta, "Body")), (meta, "Body"))

    def test_parse_tolerant(self):
        self.assertEqual(parse_note("just text\n"), ({}, "just text\n"))
        lf = '---\ntitle: "A"\n---\nbody\nmore\n'
        self.assertEqual(parse_note(lf.replace("\n", "\r\n")), parse_note(lf))
        self.assertEqual(parse_note(lf), ({"title": "A"}, "body\nmore\n"))
        meta, body = parse_note('---\nweird: {a: 1\ncolour: "red"\n---\nx')
        self.assertEqual(meta["_raw_lines"], ["weird: {a: 1"])
        self.assertEqual(meta["colour"], "red")
        self.assertEqual(parse_note(dump_note(meta, body)), (meta, body))
        self.assertIn("weird: {a: 1", dump_note(meta, body))

    def test_block_yaml_survives(self):
        text = ('---\ntitle: "T"\ntags:\n  - x\n  - y\naliases:\n- a\n'
                'desc: |\n  line one\n\n  line two\nnote: >-\n  folded\n'
                'pinned: true\n---\nBody')
        meta, body = parse_note(text)
        self.assertEqual((meta["title"], meta["pinned"], body), ("T", True, "Body"))
        for k in ("tags", "aliases", "desc", "note"):
            self.assertNotIn(k, meta)
        out = dump_note(meta, body)
        for block in ("tags:\n  - x\n  - y\n", "aliases:\n- a\n",
                      "desc: |\n  line one\n\n  line two\n", "note: >-\n  folded\n"):
            self.assertIn(block, out)
        self.assertEqual(parse_note(out), (meta, body))
        self.assertEqual(parse_note(dump_note(meta, body))[0]["_raw_lines"],
                         meta["_raw_lines"])

    def test_empty_value_without_block_is_plain(self):
        self.assertEqual(parse_note("---\na:\nb: 1\n---\n")[0], {"a": "", "b": "1"})

    def test_bare_values(self):
        meta, _ = parse_note("---\na: true\nb: false\nc: hello  \n---\n")
        self.assertEqual(meta, {"a": True, "b": False, "c": "hello"})


class TestIds(TmpCase):
    def test_ids(self):
        self.assertTrue(valid_id("shrestha/branch-hq"))
        self.assertTrue(valid_id("inbox"))
        for bad in ["shrestha/../x", "shrestha/_raw", "shrestha/.trash",
                    "other", "shrestha/Bad", "shrestha/", "shrestha/a\n"]:
            self.assertFalse(valid_id(bad), bad)
            with self.assertRaises(ValueError):
                note_path(self.tmp, bad)

    def test_note_path_folder_vs_leaf(self):
        make_vault(self.tmp, {"shrestha/jarvis/_index.md": "x",
                              "shrestha/idea.md": "y"})
        self.assertEqual(note_path(self.tmp, "shrestha/jarvis"),
                         self.tmp / "shrestha/jarvis/_index.md")
        self.assertEqual(note_path(self.tmp, "shrestha/idea"),
                         self.tmp / "shrestha/idea.md")
        self.assertEqual(note_path(self.tmp, "shrestha/new"),
                         self.tmp / "shrestha/new.md")

    def test_symlink_escape_rejected(self):
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        (self.tmp / "shrestha").mkdir()
        (self.tmp / "shrestha/evil").symlink_to(outside.name)
        with self.assertRaises(ValueError):
            note_path(self.tmp, "shrestha/evil")


class TestReadWrite(TmpCase):
    def test_write_read_creates_dirs_and_stamps_updated(self):
        n = write_note(self.tmp, "shrestha/a/b", {"title": "B"}, "hi", None)
        self.assertEqual(n.meta["updated"], date.today().isoformat())
        self.assertEqual(read_note(self.tmp, "shrestha/a/b"), n)
        self.assertEqual([p.name for p in (self.tmp / "shrestha/a").iterdir()],
                         ["b.md"])  # no temp file left behind
        with self.assertRaises(FileNotFoundError):
            read_note(self.tmp, "shrestha/missing")

    def test_write_conflict(self):
        n = write_note(self.tmp, "shrestha/x", {"title": "X"}, "one", None)
        path = note_path(self.tmp, "shrestha/x")
        os.utime(path, ns=(n.mtime_ns + 5_000_000_000,) * 2)
        with self.assertRaises(Conflict) as cm:
            write_note(self.tmp, "shrestha/x", {"title": "X"}, "two", n.mtime_ns)
        self.assertEqual(cm.exception.current.body, "one")
        self.assertEqual(read_note(self.tmp, "shrestha/x").body, "one")
        cur = read_note(self.tmp, "shrestha/x")
        self.assertEqual(
            write_note(self.tmp, "shrestha/x", {}, "three", cur.mtime_ns).body,
            "three")

    def test_slugify_and_stale(self):
        self.assertEqual(slugify("  Hello, World!! "), "hello-world")
        self.assertEqual(slugify("???"), "untitled")
        self.assertEqual(len(slugify("a" * 100)), 64)
        today = date(2026, 11, 25)
        self.assertTrue(is_stale({}, today))
        self.assertTrue(is_stale({"updated": "garbage"}, today))
        self.assertTrue(is_stale({"updated": "2026-10-25"}, today))   # 31 days
        self.assertFalse(is_stale({"updated": "2026-10-26"}, today))  # 30 days


class TestTree(TmpCase):
    def test_tree(self):
        fresh = '---\ntitle: "Fresh"\ntype: "area"\nupdated: "2026-11-20"\n---\n'
        old = '---\ntitle: "Old"\nupdated: "2026-01-01"\n---\n'
        make_vault(self.tmp, {
            "shrestha/_index.md": fresh,
            "shrestha/branch-hq/_index.md": old,
            "shrestha/branch-hq/internal-work/_index.md": fresh,
            "shrestha/note.md": "no frontmatter",
            "shrestha/_raw/x.md": "raw",
            "shrestha/.trash/y.md": "trash",
        })
        self.assertEqual(all_ids(self.tmp), [
            "shrestha", "shrestha/branch-hq",
            "shrestha/branch-hq/internal-work", "shrestha/note"])
        t = tree(self.tmp, today=date(2026, 11, 25))
        self.assertEqual((t["id"], t["title"], t["type"], t["stale"]),
                         ("shrestha", "Fresh", "area", False))
        self.assertEqual([c["id"] for c in t["children"]],
                         ["shrestha/branch-hq", "shrestha/note"])  # folders first
        hq, note = t["children"]
        self.assertTrue(hq["stale"])
        self.assertEqual(hq["title"], "Old")
        self.assertEqual(note["children"], [])
        self.assertEqual(note["title"], "note")  # falls back to id leaf
        self.assertEqual(hq["children"][0]["id"],
                         "shrestha/branch-hq/internal-work")
        self.assertFalse(hq["children"][0]["stale"])

    def test_tree_synthesises_missing_folder_node(self):
        make_vault(self.tmp, {"shrestha/_index.md": "x",
                              "shrestha/foo/bar.md": '---\ntitle: "Bar"\n---\n'})
        t = tree(self.tmp, today=date(2026, 11, 25))
        foo = t["children"][0]
        self.assertEqual((foo["id"], foo["title"], foo["type"], foo["stale"]),
                         ("shrestha/foo", "foo", None, True))
        self.assertEqual([c["id"] for c in foo["children"]], ["shrestha/foo/bar"])
        self.assertEqual(all_ids(self.tmp), ["shrestha", "shrestha/foo/bar"])


if __name__ == "__main__":
    unittest.main()
