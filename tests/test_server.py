import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import server
from sm.index import Index
from sm.ops import PartialMove
from sm.seed import seed

TOKEN = "test-token-abc"
LEAK = "sk-" + "a" * 24


class ServerTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        tmp = Path(self._tmp.name)
        self.vault, self.app = tmp / "vault", tmp / "app"
        self.vault.mkdir()
        self.app.mkdir()
        (self.app / "index.html").write_text("<script>const T='{{TOKEN}}'</script>")
        (self.app / "hello.js").write_text("console.log(1)")
        (tmp / "secret.txt").write_text("outside app_dir")
        seed(self.vault)
        Index(self.vault).rebuild()
        self.srv = server.make_server(self.vault, self.app, TOKEN, 0)
        self.port = self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.addCleanup(self._stop)

    def _stop(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.thread.join()

    def raw(self, method, path, body=None, headers=None):
        h = {"Host": f"127.0.0.1:{self.port}", **(headers or {})}
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request(method, path, body=body, headers=h)
            r = conn.getresponse()
            data = r.read()
            return r.status, data
        finally:
            conn.close()

    def get(self, path, **kw):
        s, data = self.raw("GET", path, **kw)
        return s, json.loads(data)

    def send(self, method, path, obj, headers=None):
        h = {"X-SM-Token": TOKEN, "Content-Type": "application/json", **(headers or {})}
        s, data = self.raw(method, path, json.dumps(obj), h)
        return s, json.loads(data)

    def create(self, title, parent="shrestha", folder=False):
        s, n = self.send("POST", "/api/note", {"parent": parent, "title": title, "type": "idea", "folder": folder})
        self.assertEqual(s, 201)
        return n

    def put(self, n, body, meta=None):
        return self.send("PUT", "/api/note", {"id": n["id"], "meta": meta or n["meta"], "body": body,
                                              "base_mtime_ns": n["mtime_ns"]})

    # ---- reads ----

    def test_get_tree(self):
        s, t = self.get("/api/tree")
        self.assertEqual(s, 200)
        self.assertEqual((t["root"]["id"], t["inbox"]["id"]), ("shrestha", "inbox"))

    def test_graph(self):
        s, g = self.get("/api/graph")
        self.assertEqual(s, 200)
        self.assertIn("shrestha", {n["id"] for n in g["nodes"]})

    def test_note_crud(self):
        a = self.create("Alpha")
        self.assertEqual(a["id"], "shrestha/alpha")
        b = self.create("Beta")
        s, b2 = self.put(b, "see [[shrestha/alpha]] and [[nowhere-at-all]]")
        self.assertEqual(s, 200)
        self.assertEqual(b2["outlinks"], [{"id": "shrestha/alpha", "title": "Alpha"}])
        self.assertEqual(b2["missing"], ["nowhere-at-all"])
        s, a2 = self.get("/api/note?id=shrestha/alpha")
        self.assertEqual(a2["backlinks"], [{"id": "shrestha/beta", "title": "Beta"}])

        s, out = self.send("POST", "/api/move", {"id": "shrestha/alpha", "new_id": "shrestha/gamma"})
        self.assertEqual((s, out), (200, {"id": "shrestha/gamma", "rewritten": 1}))
        self.assertEqual(self.get("/api/note?id=shrestha/alpha")[0], 404)
        s, b3 = self.get("/api/note?id=shrestha/beta")
        self.assertIn("[[shrestha/gamma]]", b3["body"])
        self.assertEqual([r["id"] for r in self.get("/api/search?q=alpha")[1]], ["shrestha/gamma"])  # index followed the move

        self.assertEqual(self.send("POST", "/api/trash", {"id": "shrestha/gamma"}), (200, {"ok": True}))
        self.assertEqual(self.get("/api/note?id=shrestha/gamma")[0], 404)
        self.assertEqual(self.get("/api/search?q=alpha")[1], [])

    def test_move_partial_is_success_with_flag(self):
        a = self.create("Alpha")
        with mock.patch.object(server, "move_note", side_effect=PartialMove("shrestha/z", ["shrestha/q"], 2)):
            s, out = self.send("POST", "/api/move", {"id": a["id"], "new_id": "shrestha/z"})
        self.assertEqual(s, 200)
        self.assertEqual((out["partial"], out["rewritten"], out["unrewritten"]), (True, 2, ["shrestha/q"]))

    def test_put_conflict_409(self):
        a = self.create("Alpha")
        self.assertEqual(self.put(a, "first")[0], 200)
        s, out = self.put(a, "stale write")  # a["mtime_ns"] is now stale
        self.assertEqual(s, 409)
        self.assertEqual(out["current"]["body"], "first")

    def test_put_missing_note_404_and_bad_base_400(self):
        a = self.create("Alpha")
        s, _ = self.send("PUT", "/api/note", {"id": "shrestha/nope", "meta": {}, "body": "", "base_mtime_ns": 1})
        self.assertEqual(s, 404)
        s, _ = self.send("PUT", "/api/note", {"id": a["id"], "meta": a["meta"], "body": ""})
        self.assertEqual(s, 400)

    def test_get_then_put_echoing_string_mtime(self):
        a = self.create("Alpha")
        s, n = self.get(f"/api/note?id={a['id']}")
        self.assertIsInstance(n["mtime_ns"], str)
        self.assertTrue(n["mtime_ns"].isdigit())
        s, out = self.send("PUT", "/api/note", {"id": n["id"], "meta": n["meta"], "body": "x",
                                                "base_mtime_ns": n["mtime_ns"]})
        self.assertEqual(s, 200)
        self.assertIsInstance(out["mtime_ns"], str)

    def test_put_accepts_int_base(self):
        a = self.create("Alpha")
        s, _ = self.send("PUT", "/api/note", {"id": a["id"], "meta": a["meta"], "body": "x",
                                              "base_mtime_ns": int(a["mtime_ns"])})
        self.assertEqual(s, 200)

    def test_index_failure_does_not_500_a_write(self):
        a = self.create("Alpha")
        for exc in (OSError("disk"), UnicodeDecodeError("utf-8", b"\xff", 0, 1, "bad")):
            with mock.patch.object(Index, "update", side_effect=exc), mock.patch("sys.stderr"):
                n = self.get(f"/api/note?id={a['id']}")[1]
                self.assertEqual(self.put(n, "still saved")[0], 200)
        self.assertEqual(self.get(f"/api/note?id={a['id']}")[1]["body"], "still saved")

    def test_create_errors(self):
        self.create("Alpha")
        body = {"parent": "shrestha", "title": "Alpha", "type": "idea", "folder": False}
        self.assertEqual(self.send("POST", "/api/note", body)[0], 409)
        self.assertEqual(self.send("POST", "/api/note", {**body, "parent": "shrestha/nope"})[0], 404)
        self.assertEqual(self.send("POST", "/api/note", {**body, "parent": "../x"})[0], 400)
        self.assertEqual(self.send("POST", "/api/note", {**body, "folder": "yes"})[0], 400)
        self.assertEqual(self.send("POST", "/api/trash", {"id": "shrestha"})[0], 400)  # root note

    def test_search_and_pack(self):
        a = self.create("Alpha")
        self.put(a, f"findme with a leaked key {LEAK} inside")
        s, res = self.get("/api/search?q=findme")
        self.assertEqual((s, res[0]["id"]), (200, "shrestha/alpha"))
        self.assertIn("[REDACTED]", res[0]["snippet"])
        self.assertNotIn(LEAK, json.dumps(res))
        # notes themselves are shown as written
        self.assertIn(LEAK, self.get(f"/api/note?id={a['id']}")[1]["body"])

        s, pack = self.get(f"/api/pack?id={a['id']}&budget=800&include=shrestha&exclude=inbox")
        self.assertEqual(s, 200)
        self.assertNotIn(LEAK, json.dumps(pack))
        self.assertIn("Note: Alpha", pack["text"])
        self.assertEqual(self.get("/api/pack?id=shrestha/alpha&budget=abc")[0], 400)
        self.assertEqual(self.get("/api/pack?id=shrestha/nope")[0], 404)

    # ---- security ----

    def test_wrong_host_403(self):
        for host in ("evil.com", f"evil.com:{self.port}", "127.0.0.1", f"127.0.0.1:{self.port + 1}"):
            self.assertEqual(self.raw("GET", "/api/tree", headers={"Host": host})[0], 403, host)
        self.assertEqual(self.raw("GET", "/api/tree", headers={"Host": f"localhost:{self.port}"})[0], 200)

    def test_post_without_token_403(self):
        h = {"Content-Type": "application/json"}
        body = json.dumps({"id": "shrestha/x"})
        self.assertEqual(self.raw("POST", "/api/trash", body, h)[0], 403)
        self.assertEqual(self.raw("POST", "/api/trash", body, {**h, "X-SM-Token": "wrong"})[0], 403)
        self.assertEqual(self.raw("POST", "/api/trash", body, {**h, "X-SM-Token": "é"})[0], 403)

    def test_post_evil_origin_403(self):
        for origin in ("http://evil.com", "null", f"http://127.0.0.1.evil.com:{self.port}"):
            s, _ = self.send("POST", "/api/trash", {"id": "shrestha/x"}, {"Origin": origin})
            self.assertEqual(s, 403, origin)
        s, _ = self.send("POST", "/api/trash", {"id": "shrestha/x"}, {"Origin": f"http://localhost:{self.port}"})
        self.assertEqual(s, 404)  # passed the origin check

    def test_text_plain_415(self):
        h = {"X-SM-Token": TOKEN, "Content-Type": "text/plain"}
        self.assertEqual(self.raw("POST", "/api/trash", '{"id": "shrestha/x"}', h)[0], 415)

    def test_big_body_413(self):
        h = {"X-SM-Token": TOKEN, "Content-Type": "application/json"}
        self.assertEqual(self.raw("PUT", "/api/note", b" " * (1_000_001), h)[0], 413)

    def test_bad_body_400(self):
        h = {"X-SM-Token": TOKEN, "Content-Type": "application/json"}
        self.assertEqual(self.raw("POST", "/api/trash", "{nope", h)[0], 400)
        self.assertEqual(self.raw("POST", "/api/trash", "[1]", h)[0], 400)
        self.assertEqual(self.raw("POST", "/api/trash", b"\xff\xfe", h)[0], 400)

    def test_no_cors_headers(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request("GET", "/api/tree", headers={"Origin": "http://evil.com"})
            r = conn.getresponse()
            r.read()
            self.assertIsNone(r.getheader("Access-Control-Allow-Origin"))
        finally:
            conn.close()

    def test_bad_id_400(self):
        self.assertEqual(self.get("/api/note?id=../../etc/passwd")[0], 400)
        self.assertEqual(self.get("/api/note")[0], 400)
        self.assertEqual(self.get("/api/pack?id=../x")[0], 400)

    def test_unknown_route_404(self):
        self.assertEqual(self.get("/api/nope")[0], 404)

    # ---- static ----

    def test_static_traversal_404(self):
        for p in ("/app/../server.py", "/app/../secret.txt", "/app/%2e%2e/secret.txt",
                  "/app/..%2fsecret.txt", "/app//etc/passwd", "/app/nope.js", "/app/%00", "/app/"):
            self.assertEqual(self.raw("GET", p)[0], 404, p)

    def test_static_file(self):
        s, data = self.raw("GET", "/app/hello.js")
        self.assertEqual((s, data), (200, b"console.log(1)"))

    def test_index_injects_token(self):
        s, data = self.raw("GET", "/")
        self.assertEqual(s, 200)
        self.assertIn(f"const T='{TOKEN}'".encode(), data)
        self.assertNotIn(b"{{TOKEN}}", data)


class MainHelpersTest(unittest.TestCase):
    def test_token_file_created_600_and_reused(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "sub" / ".token"
            t = server._load_token(p)
            self.assertGreaterEqual(len(t), 40)
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            self.assertEqual(server._load_token(p), t)
            p.write_text("")
            self.assertTrue(server._load_token(p))  # empty file is regenerated, never used as a token

    def test_empty_token_refused(self):
        with self.assertRaises(ValueError):
            server.make_server(Path("."), Path("."), "", 0)


if __name__ == "__main__":
    unittest.main()
