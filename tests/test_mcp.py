import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import mcp_server
from mcp_server import Engram, ToolError, handle, serve
from sm.seed import init_repo, seed
from sm.vault import read_note, write_note

LEAK = "sk-" + "a" * 24


def log(vault: Path) -> list[str]:
    out = subprocess.run(["git", "log", "--format=%s|%an"], cwd=vault, capture_output=True, text=True)
    return out.stdout.splitlines()


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self._tmp.name)
        init_repo(self.vault)
        seed(self.vault)
        for k, v in (("user.name", "t"), ("user.email", "t@t")):
            subprocess.run(["git", "config", k, v], cwd=self.vault, check=True)
        self.claude = Engram(self.vault, "claude")
        self.codex = Engram(self.vault, "codex")

    def tearDown(self):
        self._tmp.cleanup()


class TestTiers(Base):
    def test_contributor_sees_only_read_and_propose(self):
        names = {t["name"] for t in self.codex.tool_list()}
        self.assertEqual(names, {"search", "read", "tree", "pack", "propose"})
        self.assertIn("edit", {t["name"] for t in self.claude.tool_list()})

    def test_contributor_cannot_call_editor_tools(self):
        for name in ("edit", "create", "accept", "reject", "review_inbox"):
            with self.assertRaises(ToolError):
                self.codex.call(name, {"id": "shrestha/builds", "body": "x"})

    def test_bad_agent_name(self):
        with self.assertRaises(ValueError):
            Engram(self.vault, "../evil")


class TestRead(Base):
    def test_read_tree_search_pack(self):
        r = self.codex.call("read", {"id": "shrestha/builds"})
        self.assertIn("version: ", r)
        self.assertIn('title: "Builds"', r)
        self.assertIn("- shrestha/builds | Builds", self.codex.call("tree", {}))
        self.assertIn("shrestha/builds", self.codex.call("search", {"query": "Builds"}))
        self.assertIn("Builds", self.codex.call("pack", {"id": "shrestha/builds"}))

    def test_output_is_redacted(self):
        n = read_note(self.vault, "shrestha/builds")
        write_note(self.vault, n.id, n.meta, f"key {LEAK}\n", n.mtime_ns)
        self.assertNotIn(LEAK, self.codex.call("read", {"id": "shrestha/builds"}))

    def test_missing_and_invalid_ids(self):
        with self.assertRaises(ToolError):
            self.codex.call("read", {"id": "shrestha/nope"})
        with self.assertRaises(ToolError):
            self.codex.call("read", {"id": "../etc/passwd"})


class TestWrites(Base):
    def test_propose_lands_in_agent_inbox_with_own_commit(self):
        out = self.codex.call("propose", {"title": "Likes Rust", "body": "Shrestha likes Rust.",
                                          "about": "shrestha/builds"})
        self.assertIn("inbox/ai/codex/likes-rust", out)
        n = read_note(self.vault, "inbox/ai/codex/likes-rust")
        self.assertEqual((n.meta["proposed_by"], n.meta["about"]), ("codex", "shrestha/builds"))
        self.assertEqual(log(self.vault)[0], "codex: propose inbox/ai/codex/likes-rust|codex via Engram")

    def test_propose_twice_gets_new_slug(self):
        self.codex.call("propose", {"title": "Fact", "body": "a"})
        self.assertIn("fact-2", self.codex.call("propose", {"title": "Fact", "body": "b"}))

    def test_user_edits_get_their_own_commit(self):
        p = self.vault / "shrestha" / "builds" / "_index.md"
        p.write_text(p.read_text() + "user line\n")
        self.claude.call("edit", {"id": "shrestha/builds", "body": "claude line"})
        subjects = [l.split("|")[0] for l in log(self.vault)[:2]]
        self.assertEqual(subjects, ["claude: append shrestha/builds", "autosave"])
        show = subprocess.run(["git", "show", "--stat", "--format=", "HEAD"], cwd=self.vault,
                              capture_output=True, text=True).stdout
        self.assertIn("builds/_index.md", show)

    def test_append_and_replace(self):
        self.claude.call("edit", {"id": "shrestha/builds", "body": "one"})
        self.assertIn("one", read_note(self.vault, "shrestha/builds").body)
        v = read_note(self.vault, "shrestha/builds").mtime_ns
        self.claude.call("edit", {"id": "shrestha/builds", "body": "two", "mode": "replace", "version": str(v)})
        self.assertEqual(read_note(self.vault, "shrestha/builds").body, "two\n")

    def test_replace_refuses_stale_or_missing_version(self):
        v = read_note(self.vault, "shrestha/builds").mtime_ns
        self.claude.call("edit", {"id": "shrestha/builds", "body": "user moved on"})
        with self.assertRaisesRegex(ToolError, "changed since"):
            self.claude.call("edit", {"id": "shrestha/builds", "body": "x", "mode": "replace", "version": v})
        with self.assertRaisesRegex(ToolError, "needs the version"):
            self.claude.call("edit", {"id": "shrestha/builds", "body": "x", "mode": "replace"})

    def test_replace_refused_on_note_with_secret(self):
        n = read_note(self.vault, "shrestha/builds")
        n = write_note(self.vault, n.id, n.meta, f"key {LEAK}\n", n.mtime_ns)
        with self.assertRaisesRegex(ToolError, "secret"):
            self.claude.call("edit", {"id": n.id, "body": "x", "mode": "replace", "version": n.mtime_ns})
        self.assertIn(LEAK, read_note(self.vault, n.id).body)

    def test_secret_in_input_refused(self):
        with self.assertRaisesRegex(ToolError, "secret"):
            self.codex.call("propose", {"title": "k", "body": f"my key {LEAK}"})
        with self.assertRaisesRegex(ToolError, "secret"):
            self.claude.call("edit", {"id": "shrestha/builds", "body": LEAK})

    def test_propose_about_must_exist(self):
        with self.assertRaisesRegex(ToolError, "no note"):
            self.codex.call("propose", {"title": "X", "body": "y", "about": "shrestha/missing"})

    def test_unreadable_note_not_overwritten(self):
        bad = self.vault / "shrestha" / "builds" / "idea.md"
        bad.parent.mkdir(exist_ok=True)
        bad.write_bytes(b"\xff\xfe junk")
        out = self.claude.call("create", {"parent": "shrestha/builds", "title": "Idea", "body": "new"})
        self.assertIn("shrestha/builds/idea-2", out)
        self.assertEqual(bad.read_bytes(), b"\xff\xfe junk")

    def test_refuses_when_user_edits_cannot_be_committed(self):
        p = self.vault / "shrestha" / "builds" / "_index.md"
        p.write_text(p.read_text() + "user line\n")
        hook = self.vault / ".git" / "hooks" / "pre-commit"
        hook.write_text("#!/bin/sh\nexit 1\n")
        hook.chmod(0o755)
        with self.assertRaisesRegex(ToolError, "pending edits"):
            self.claude.call("edit", {"id": "shrestha/builds", "body": "claude line"})
        self.assertNotIn("claude line", p.read_text())

    def test_create(self):
        out = self.claude.call("create", {"parent": "shrestha/builds", "title": "Engram", "body": "MCP."})
        self.assertIn("shrestha/builds/engram", out)
        with self.assertRaises(ToolError):
            self.claude.call("create", {"parent": "shrestha/nope", "title": "X", "body": "y"})


class TestReview(Base):
    def test_accept_moves_under_about(self):
        self.codex.call("propose", {"title": "Rust", "body": "likes rust", "about": "shrestha/builds"})
        self.assertIn("inbox/ai/codex/rust", self.claude.call("review_inbox", {}))
        self.claude.call("accept", {"id": "inbox/ai/codex/rust"})
        self.assertEqual(read_note(self.vault, "shrestha/builds/rust").body, "likes rust\n")
        self.assertEqual(self.claude.call("review_inbox", {}), "No proposals waiting.")
        self.assertIn("shrestha/builds/rust", self.claude.call("search", {"query": "rust"}))

    def test_reject_trashes_and_only_proposals(self):
        self.codex.call("propose", {"title": "Bad", "body": "wrong"})
        self.claude.call("reject", {"id": "inbox/ai/codex/bad"})
        self.assertFalse((self.vault / "inbox/ai/codex/bad.md").exists())
        self.assertTrue(any((self.vault / ".trash").iterdir()))
        with self.assertRaisesRegex(ToolError, "not a proposal"):
            self.claude.call("reject", {"id": "shrestha/builds"})
        with self.assertRaises(ToolError):
            self.claude.call("accept", {"id": "inbox/ai/codex"})


class TestProtocol(Base):
    def rpc(self, eng, *msgs):
        out = io.StringIO()
        serve(eng, io.StringIO("".join(json.dumps(m) + "\n" for m in msgs) + "not json\n"), out)
        return [json.loads(l) for l in out.getvalue().splitlines()]

    def test_handshake_and_calls(self):
        r = self.rpc(self.codex,
                     {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}},
                     {"jsonrpc": "2.0", "method": "notifications/initialized"},
                     {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                     {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "edit", "arguments": {}}},
                     {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "read", "arguments": {"nope": 1}}},
                     {"jsonrpc": "2.0", "id": 5, "method": "bogus"},
                     {"jsonrpc": "2.0", "id": 6, "method": "tools/list", "params": []})
        self.assertEqual([m.get("id") for m in r], [1, 2, 3, 4, 5, 6, None])
        self.assertEqual(r[0]["result"]["protocolVersion"], "2025-03-26")
        self.assertIn("propose", r[0]["result"]["instructions"])
        self.assertEqual(len(r[1]["result"]["tools"]), 5)
        self.assertTrue(r[2]["result"]["isError"])
        self.assertTrue(r[3]["result"]["isError"])
        self.assertEqual(r[4]["error"]["code"], -32601)
        self.assertEqual(len(r[5]["result"]["tools"]), 5)
        self.assertEqual(r[6]["error"]["code"], -32700)


if __name__ == "__main__":
    unittest.main()
