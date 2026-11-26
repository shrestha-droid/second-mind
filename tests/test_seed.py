import subprocess
import tempfile
import unittest
from pathlib import Path

from sm.ops import move_note, trash_note
from sm.seed import SEED, init_repo, seed
from sm.vault import all_ids, read_note, write_note


class SeedTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.vault = Path(self._tmp.name)

    def test_seed_creates_tree(self):
        created = seed(self.vault)
        self.assertEqual(created, [s[0] for s in SEED])
        self.assertEqual(all_ids(self.vault), sorted(s[0] for s in SEED))
        self.assertEqual(len(SEED), 17)
        n = read_note(self.vault, "shrestha/work/money")
        self.assertEqual((n.meta["title"], n.meta["type"], n.meta["summary"]), ("Money", "area", ""))
        self.assertTrue((self.vault / "shrestha/builds/jarvis/_index.md").is_file())
        self.assertEqual(read_note(self.vault, "inbox").meta["title"], "Inbox")

    def test_seed_idempotent(self):
        seed(self.vault)
        n = read_note(self.vault, "shrestha/work")
        write_note(self.vault, "shrestha/work", {**n.meta, "summary": "mine"}, "body", n.mtime_ns)
        self.assertEqual(seed(self.vault), [])
        self.assertEqual(read_note(self.vault, "shrestha/work").meta["summary"], "mine")

    def test_seed_never_resurrects_trashed_or_moved(self):
        seed(self.vault)
        trash_note(self.vault, "shrestha/social/youtube")
        move_note(self.vault, "shrestha/work/money", "shrestha/work/finance")
        self.assertEqual(seed(self.vault), [])
        ids = all_ids(self.vault)
        self.assertNotIn("shrestha/social/youtube", ids)
        self.assertNotIn("shrestha/work/money", ids)

    def test_seed_skips_existing_leaf(self):
        (self.vault / "shrestha").mkdir()
        (self.vault / "shrestha/work.md").write_text('---\ntitle: "Mine"\n---\n')
        created = seed(self.vault)
        self.assertNotIn("shrestha/work", created)
        self.assertEqual(read_note(self.vault, "shrestha/work/money").meta["title"], "Money")
        self.assertFalse((self.vault / "shrestha/work.md").exists())  # promoted to a folder, content kept
        self.assertEqual(read_note(self.vault, "shrestha/work").meta["title"], "Mine")

    def test_init_repo(self):
        init_repo(self.vault)
        init_repo(self.vault)
        self.assertTrue((self.vault / ".git").exists())
        remotes = subprocess.run(["git", "remote"], cwd=self.vault, capture_output=True, text=True)
        self.assertEqual(remotes.stdout, "")
        lines = (self.vault / ".gitignore").read_text().splitlines()
        self.assertEqual(lines, ["_raw/", ".index.db", ".index.db-*", ".trash/"])


if __name__ == "__main__":
    unittest.main()
