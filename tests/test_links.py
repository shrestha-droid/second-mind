import tempfile
import unittest
from datetime import date
from pathlib import Path

from sm.links import extract_links, graph_payload, link_index, resolve
from tests.helpers import make_vault


def note(body="", **meta):
    fm = "".join(f"{k}: {v}\n" for k, v in meta.items())
    return f"---\n{fm}---\n{body}"


class LinksTest(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.tmp = Path(self._t.name)
        self.addCleanup(self._t.cleanup)

    def test_extract(self):
        body = ("See [[a]] and [[b|Bee]] and [[c#intro]] and [[a]] again.\n"
                "`[[code]]` and\n```\n[[fenced]]\n```\n")
        meta = {"links": ["[[shrestha/builds/jarvis|J]]", "[[d#h]]", 5, None]}
        self.assertEqual(extract_links(meta, body),
                         ["a", "b", "c", "shrestha/builds/jarvis", "d"])
        self.assertEqual(extract_links({"links": "[[x]]"}, ""), [])
        self.assertEqual(extract_links({}, ""), [])

    def test_resolve(self):
        ids = {"shrestha", "shrestha/jarvis", "shrestha/work/solo",
               "shrestha/a/dup", "shrestha/b/dup", "inbox/foo"}
        self.assertEqual(resolve("shrestha/work/solo", ids), "shrestha/work/solo")
        self.assertEqual(resolve("jarvis", ids), "shrestha/jarvis")
        self.assertEqual(resolve("Solo", ids), "shrestha/work/solo")
        self.assertEqual(resolve("foo", ids), "inbox/foo")
        self.assertIsNone(resolve("dup", ids))
        self.assertIsNone(resolve("nowhere", ids))

    def test_backlinks(self):
        v = make_vault(self.tmp, {
            "shrestha/_index.md": note(), "shrestha/a.md": note("[[b]] [[a]]"),
            "shrestha/b.md": note()})
        idx = link_index(v)
        self.assertEqual(idx["out"]["shrestha/a"], ["shrestha/b"])  # self dropped
        self.assertEqual(idx["back"]["shrestha/b"], ["shrestha/a"])
        self.assertEqual(idx["back"]["shrestha/a"], [])

    def test_dedupe_resolved_targets(self):
        v = make_vault(self.tmp, {
            "shrestha/_index.md": note(),
            "shrestha/a.md": note("[[b]] [[shrestha/b]] [[B]]"),
            "shrestha/b.md": note()})
        idx = link_index(v)
        self.assertEqual(idx["out"]["shrestha/a"], ["shrestha/b"])
        self.assertEqual(idx["back"]["shrestha/b"], ["shrestha/a"])
        links = [e for e in graph_payload(v)["edges"] if e["kind"] == "link"]
        self.assertEqual(links, [{"source": "shrestha/a", "target": "shrestha/b", "kind": "link"}])

    def test_missing(self):
        v = make_vault(self.tmp, {
            "shrestha/_index.md": note(), "shrestha/a.md": note("[[nowhere]]")})
        idx = link_index(v)
        self.assertEqual(idx["missing"]["shrestha/a"], ["nowhere"])
        self.assertEqual(idx["out"]["shrestha/a"], [])

    def test_graph_payload(self):
        v = make_vault(self.tmp, {
            "shrestha/_index.md": note("", title='"Root"', updated="2026-11-20"),
            "shrestha/a.md": note("[[b]] [[b]]", updated="2026-11-20", pinned="true"),
            "shrestha/b.md": note("", updated="2026-01-01", type='"project"'),
            "shrestha/f/c.md": note(""),  # folder f has no _index.md
            "inbox/_index.md": note(), "inbox/x.md": note("[[a]]", updated="2026-11-20")})
        g = graph_payload(v, today=date(2026, 11, 25))
        nodes = {n["id"]: n for n in g["nodes"]}
        self.assertNotIn("inbox", nodes)
        self.assertIsNone(nodes["shrestha"]["parent"])
        self.assertEqual(nodes["shrestha"]["title"], "Root")
        self.assertIsNone(nodes["inbox/x"]["parent"])
        self.assertEqual(nodes["shrestha/a"]["parent"], "shrestha")
        self.assertTrue(nodes["shrestha/a"]["pinned"])
        self.assertFalse(nodes["shrestha/a"]["stale"])
        self.assertTrue(nodes["shrestha/b"]["stale"])
        self.assertEqual(nodes["shrestha/b"]["type"], "project")
        self.assertEqual(nodes["shrestha/f/c"]["parent"], "shrestha/f")
        self.assertIn("shrestha/f", nodes)  # synthesised folder node
        edges = [(e["source"], e["target"], e["kind"]) for e in g["edges"]]
        self.assertIn(("shrestha", "shrestha/a", "tree"), edges)
        self.assertIn(("shrestha/f", "shrestha/f/c", "tree"), edges)
        self.assertEqual(edges.count(("shrestha/a", "shrestha/b", "link")), 1)
        self.assertIn(("inbox/x", "shrestha/a", "link"), edges)
        self.assertFalse([e for e in edges if e[0] == "inbox/x" and e[2] == "tree"])
        for s, t, _ in edges:
            self.assertIn(s, nodes)
            self.assertIn(t, nodes)


if __name__ == "__main__":
    unittest.main()
