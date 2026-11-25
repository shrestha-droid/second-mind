import subprocess
import tempfile
import unittest
from pathlib import Path

from sm.ops import create_note, move_note, snapshot, trash_note
from sm.vault import all_ids, read_note, write_note
from tests.helpers import make_vault

FM = '---\ntitle: "{t}"\n---\n'


def note(title, body=""):
    return FM.format(t=title) + body


class OpsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def test_create_leaf_and_folder(self):
        v = make_vault(self.tmp, {"shrestha/_index.md": note("Root")})
        n = create_note(v, "shrestha", "My Leaf", "idea", False)
        self.assertEqual(n.id, "shrestha/my-leaf")
        self.assertEqual(n.meta["title"], "My Leaf")
        self.assertEqual(n.meta["type"], "idea")
        self.assertEqual((n.meta["summary"], n.meta["links"], n.meta["pinned"]), ("", [], False))
        self.assertTrue((v / "shrestha/my-leaf.md").is_file())
        f = create_note(v, "shrestha", "Box", "area", True)
        self.assertEqual(f.id, "shrestha/box")
        self.assertTrue((v / "shrestha/box/_index.md").is_file())
        self.assertEqual(read_note(v, "shrestha/box").meta["title"], "Box")

    def test_create_under_leaf_promotes(self):
        v = make_vault(self.tmp, {"shrestha/_index.md": note("Root"),
                                  "shrestha/p.md": note("P", "keep me\n")})
        create_note(v, "shrestha/p", "Kid", "idea", False)
        self.assertFalse((v / "shrestha/p.md").exists())
        self.assertEqual(read_note(v, "shrestha/p").body, "keep me\n")
        self.assertEqual(read_note(v, "shrestha/p").meta["title"], "P")
        self.assertIn("shrestha/p/kid", all_ids(v))

    def test_create_clash(self):
        v = make_vault(self.tmp, {"shrestha/_index.md": note("Root"),
                                  "shrestha/a.md": note("A"),
                                  "shrestha/d/_index.md": note("D")})
        with self.assertRaises(FileExistsError):
            create_note(v, "shrestha", "A", "idea", False)
        with self.assertRaises(FileExistsError):
            create_note(v, "shrestha", "D", "idea", False)

    def test_create_clash_does_not_promote_parent(self):
        v = make_vault(self.tmp, {"shrestha/_index.md": note("Root"),
                                  "shrestha/p.md": note("P")})
        create_note(v, "shrestha/p", "Kid", "idea", False)
        with self.assertRaises(FileExistsError):
            create_note(v, "shrestha/p", "Kid", "idea", False)
        self.assertTrue((v / "shrestha/p/_index.md").is_file())

    def test_move_rewrites_links(self):
        v = make_vault(self.tmp, {
            "shrestha/_index.md": note("Root"),
            "shrestha/a/_index.md": note("A"),
            "shrestha/a/b.md": note("B"),
            "shrestha/c.md": note("C", "see [[shrestha/a/b|Bee]] and [[b]] and [[a/b#Top]]\n"),
        })
        self.assertEqual(move_note(v, "shrestha/a", "shrestha/x"), 1)
        self.assertEqual(
            read_note(v, "shrestha/c").body,
            "see [[shrestha/x/b|Bee]] and [[shrestha/x/b]] and [[shrestha/x/b#Top]]\n")
        self.assertEqual(sorted(all_ids(v)), ["shrestha", "shrestha/c", "shrestha/x", "shrestha/x/b"])

    def test_move_rewrites_frontmatter_links_and_skips_code(self):
        v = make_vault(self.tmp, {
            "shrestha/_index.md": note("Root"),
            "shrestha/a.md": note("A"),
            "shrestha/c.md": '---\ntitle: "C"\nlinks: ["[[shrestha/a]]", "a"]\n---\n`[[a]]` text\n',
        })
        self.assertEqual(move_note(v, "shrestha/a", "shrestha/deep/a2"), 1)
        c = read_note(v, "shrestha/c")
        self.assertEqual(c.meta["links"], ["[[shrestha/deep/a2]]", "shrestha/deep/a2"])
        self.assertEqual(c.body, "`[[a]]` text\n")
        self.assertTrue((v / "shrestha/deep/a2.md").is_file())

    def test_move_folder_rewrites_internal_links(self):
        v = make_vault(self.tmp, {
            "shrestha/_index.md": note("Root"),
            "shrestha/a/_index.md": note("A"),
            "shrestha/a/b.md": note("B", "[[shrestha/a/c]]\n"),
            "shrestha/a/c.md": note("C"),
        })
        self.assertEqual(move_note(v, "shrestha/a", "shrestha/z"), 1)
        self.assertEqual(read_note(v, "shrestha/z/b").body, "[[shrestha/z/c]]\n")

    def test_move_refusals(self):
        v = make_vault(self.tmp, {"shrestha/_index.md": note("Root"),
                                  "shrestha/a/_index.md": note("A"),
                                  "shrestha/b.md": note("B"),
                                  "inbox/_index.md": note("Inbox")})
        for src, dst in [("shrestha", "shrestha/q"), ("inbox", "shrestha/q"),
                         ("shrestha/a", "shrestha/a"), ("shrestha/a", "shrestha/a/in"),
                         ("shrestha/a", "shrestha/b"), ("shrestha/b", "Bad Id"),
                         ("shrestha/b", "inbox")]:
            with self.subTest(src=src, dst=dst), self.assertRaises(ValueError):
                move_note(v, src, dst)
        self.assertTrue((v / "shrestha/a/_index.md").is_file())

    def test_trash(self):
        v = make_vault(self.tmp, {"shrestha/_index.md": note("Root"),
                                  "inbox/_index.md": note("Inbox"),
                                  "shrestha/a.md": note("A")})
        dest = trash_note(v, "shrestha/a")
        self.assertNotIn("shrestha/a", all_ids(v))
        self.assertTrue(dest.exists())
        self.assertEqual(dest.parent, v / ".trash")
        self.assertTrue(dest.name.endswith("-shrestha__a"))
        for root in ("shrestha", "inbox"):
            with self.assertRaises(ValueError):
                trash_note(v, root)

    def _git(self, v, *args):
        return subprocess.run(["git", *args], cwd=v, capture_output=True, text=True, check=True).stdout

    def _repo(self):
        v = make_vault(self.tmp, {"shrestha/_index.md": note("Root")})
        self._git(v, "init", "-q")
        self._git(v, "config", "user.name", "t")
        self._git(v, "config", "user.email", "t@t")
        return v

    def test_snapshot_gated(self):
        v = self._repo()
        commits = lambda: int(self._git(v, "rev-list", "--count", "HEAD"))
        write_note(v, "shrestha", {"title": "R1"}, "", None)
        self.assertTrue(snapshot(v, now=1000.0))
        write_note(v, "shrestha", {"title": "R2"}, "", None)
        self.assertFalse(snapshot(v, now=1010.0))
        self.assertEqual(commits(), 1)
        self.assertTrue(snapshot(v, now=1301.0))
        self.assertEqual(commits(), 2)

    def test_snapshot_nothing_to_commit_keeps_stamp(self):
        v = self._repo()
        self.assertTrue(snapshot(v, now=1000.0))
        self.assertFalse(snapshot(v, now=2000.0))
        write_note(v, "shrestha", {"title": "R2"}, "", None)
        self.assertTrue(snapshot(v, now=2001.0))  # stamp still 1000, not 2000

    def test_snapshot_without_own_repo_is_noop(self):
        v = make_vault(self.tmp, {"shrestha/_index.md": note("Root")})
        self.assertFalse(snapshot(v, now=1000.0))


if __name__ == "__main__":
    unittest.main()
