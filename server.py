"""Local HTTP server and JSON API for Second Mind. Stdlib only, bound to 127.0.0.1."""
import hmac
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from sm.index import Index
from sm.links import graph_payload, link_index
from sm.ops import PartialMove, create_note, move_note, snapshot, trash_note
from sm.pack import build_pack
from sm.redact import redact
from sm.seed import init_repo, seed
from sm.vault import Conflict, all_ids, note_path, read_note, tree, try_read, valid_id, write_note

MAX_BODY = 1_000_000  # 1 MB
META_KEY_RE = re.compile(r"[A-Za-z0-9_-]+")


class HttpError(Exception):
    def __init__(self, status: int, error: str, **extra):
        super().__init__(error)
        self.status, self.payload = status, {"error": error, **extra}


def _title(vault: Path, id: str) -> str:
    n = try_read(vault, id)
    return str((n and n.meta.get("title")) or id.rsplit("/", 1)[-1])


def note_json(vault: Path, n) -> dict:
    li = link_index(vault)
    ref = lambda i: {"id": i, "title": _title(vault, i)}
    return {"id": n.id, "meta": n.meta, "body": n.body,
            "mtime_ns": str(n.mtime_ns),  # string: JS cannot hold 19 digits exactly
            "backlinks": [ref(i) for i in li["back"].get(n.id, [])],
            "outlinks": [ref(i) for i in li["out"].get(n.id, [])],
            "missing": li["missing"].get(n.id, [])}


def _mtimes(vault: Path) -> dict[str, int]:
    return {i: note_path(vault, i).stat().st_mtime_ns for i in all_ids(vault)}


class Handler(BaseHTTPRequestHandler):
    server_version = "SecondMind"

    def log_message(self, *args):  # request logging is noise for a local app
        pass

    # ---- plumbing ----

    def _send(self, status: int, body: bytes, ctype: str):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")  # the page carries the write token
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, obj):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _guard(self, write: bool):
        port = self.server.server_address[1]
        if self.headers.get("Host") not in (f"127.0.0.1:{port}", f"localhost:{port}"):
            raise HttpError(403, "bad host")
        if not write:
            return
        sent = (self.headers.get("X-SM-Token") or "").encode("utf-8", "replace")
        if not hmac.compare_digest(sent, self.server.token.encode()):
            raise HttpError(403, "bad token")
        origin = self.headers.get("Origin")
        if origin is not None and origin not in (f"http://127.0.0.1:{port}", f"http://localhost:{port}"):
            raise HttpError(403, "bad origin")
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            raise HttpError(415, "content type must be application/json")

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or "")
        except ValueError:
            raise HttpError(411, "Content-Length required")
        if length < 0:
            raise HttpError(400, "bad Content-Length")
        if length > MAX_BODY:
            left = min(length, 8 * MAX_BODY)  # drain so the client can read our answer
            while left > 0 and (chunk := self.rfile.read(min(65536, left))):
                left -= len(chunk)
            raise HttpError(413, "body too large")
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:  # bad JSON and bad UTF-8 both
            raise HttpError(400, "body must be JSON")
        if not isinstance(data, dict):
            raise HttpError(400, "body must be a JSON object")
        return data

    def _handle(self, method: str):
        try:
            self._guard(method in ("PUT", "POST"))
            url = urlsplit(self.path)
            self.query = parse_qs(url.query)
            if method == "GET" and url.path.startswith("/app/"):
                return self._static(unquote(url.path[len("/app/"):]))
            route = {
                ("GET", "/"): self._index, ("GET", "/api/tree"): self._tree,
                ("GET", "/api/graph"): self._graph, ("GET", "/api/note"): self._get_note,
                ("PUT", "/api/note"): self._put_note, ("POST", "/api/note"): self._post_note,
                ("POST", "/api/move"): self._move, ("POST", "/api/trash"): self._trash,
                ("GET", "/api/search"): self._search, ("GET", "/api/pack"): self._pack,
            }.get((method, url.path))
            if route is None:
                raise HttpError(404, "not found")
            route()
        except HttpError as e:
            self._json(e.status, e.payload)
        except FileNotFoundError:  # str(e) holds the absolute vault path
            self._json(404, {"error": "not found"})
        except FileExistsError as e:
            self._json(409, {"error": f"already exists: {e}"})
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except Exception:
            traceback.print_exc(file=sys.stderr)
            self._json(500, {"error": "internal error"})

    do_GET = lambda self: self._handle("GET")
    do_PUT = lambda self: self._handle("PUT")
    do_POST = lambda self: self._handle("POST")

    def _arg(self, name: str, default: str = "") -> str:
        return self.query.get(name, [default])[0]

    def _id(self, id) -> str:
        if not isinstance(id, str) or not valid_id(id):
            raise HttpError(400, f"invalid note id: {id!r}")
        return id

    def _after_write(self, *sync):
        """Sync the index and snapshot; a successful file write must never become a 500."""
        try:
            for f in sync:
                f()
        except (OSError, ValueError) as e:
            print(f"index sync failed: {e!r}", file=sys.stderr)
        try:
            snapshot(self.server.vault)
        except OSError as e:
            print(f"snapshot failed: {e!r}", file=sys.stderr)

    # ---- static ----

    def _index(self):
        try:
            html = (self.server.app_dir / "index.html").read_text(encoding="utf-8")
        except OSError:
            raise HttpError(404, "not found")
        self._send(200, html.replace("{{TOKEN}}", self.server.token).encode("utf-8"),
                   "text/html; charset=utf-8")

    def _static(self, rel: str):
        root = self.server.app_dir.resolve()
        try:
            p = (root / rel).resolve()
            ok = p.is_relative_to(root) and p.is_file()
        except (OSError, ValueError):
            ok = False
        if not ok:
            raise HttpError(404, "not found")
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json")):
            ctype += "; charset=utf-8"
        self._send(200, p.read_bytes(), ctype)

    # ---- reads ----

    def _tree(self):
        v = self.server.vault
        self._json(200, {"root": tree(v), "inbox": tree(v, root="inbox")})

    def _graph(self):
        self._json(200, graph_payload(self.server.vault))

    def _get_note(self):
        v = self.server.vault
        self._json(200, note_json(v, read_note(v, self._id(self._arg("id")))))

    def _search(self):
        out = self.server.index.search(self._arg("q"))
        self._json(200, [{**r, "title": redact(r["title"]), "snippet": redact(r["snippet"])}
                         for r in out])

    def _pack(self):
        id = self._id(self._arg("id"))
        try:
            budget = int(self._arg("budget", "1500"))
        except ValueError:
            raise HttpError(400, "budget must be an integer")
        if budget < 1:
            raise HttpError(400, "budget must be positive")
        ids = lambda name: [s for s in self._arg(name).split(",") if s]
        self._json(200, build_pack(self.server.vault, id, budget, ids("include"), ids("exclude")))

    # ---- writes (one global lock) ----

    def _put_note(self):
        v, d = self.server.vault, self._body()
        id, meta, body, base = self._id(d.get("id")), d.get("meta"), d.get("body"), d.get("base_mtime_ns")
        if (not isinstance(meta, dict) or not isinstance(body, str)
                or not all(META_KEY_RE.fullmatch(k) for k in meta)
                or not isinstance(meta.get("_raw_lines", []), list)):
            raise HttpError(400, "meta must be an object with simple keys, body a string")
        if isinstance(base, str) and base.isdigit():  # JS cannot hold a 19-digit int exactly
            base = int(base)
        if not isinstance(base, int) or isinstance(base, bool):
            raise HttpError(400, "base_mtime_ns must be an integer")
        # ponytail: global write lock, fine for one user
        with self.server.write_lock:
            if not note_path(v, id).exists():
                raise HttpError(404, f"not found: {id}")
            try:
                n = write_note(v, id, meta, body, base)
            except Conflict as c:
                raise HttpError(409, "note changed on disk", current=note_json(v, c.current))
            self._after_write(lambda: self.server.index.update(id))
        self._json(200, note_json(v, n))

    def _post_note(self):
        v, d = self.server.vault, self._body()
        parent, title, type, folder = d.get("parent"), d.get("title"), d.get("type"), d.get("folder")
        if (not isinstance(parent, str) or not isinstance(title, str) or not title.strip()
                or not isinstance(type, str) or not isinstance(folder, bool)):
            raise HttpError(400, "need parent, title, type (strings) and folder (bool)")
        with self.server.write_lock:
            n = create_note(v, parent, title, type, folder)
            self._after_write(lambda: self.server.index.update(n.id))
        self._json(201, note_json(v, n))

    def _move(self):
        v, d = self.server.vault, self._body()
        id, new_id = self._id(d.get("id")), self._id(d.get("new_id"))
        out = {"id": new_id}
        with self.server.write_lock:
            before = _mtimes(v)
            try:
                out["rewritten"] = move_note(v, id, new_id)
            except PartialMove as p:  # the move happened; report what was left
                out.update(rewritten=p.rewritten, partial=True, unrewritten=p.unrewritten)
            # moved notes are new ids and rewritten ones have a new mtime
            changed = [i for i, m in _mtimes(v).items() if before.get(i) != m]
            self._after_write(lambda: self.server.index.remove(id),
                              *[(lambda i=i: self.server.index.update(i)) for i in changed])
        self._json(200, out)

    def _trash(self):
        id = self._id(self._body().get("id"))
        with self.server.write_lock:
            trash_note(self.server.vault, id)
            self._after_write(lambda: self.server.index.remove(id))
        self._json(200, {"ok": True})


def make_server(vault: Path, app_dir: Path, token: str, port: int = 7337) -> ThreadingHTTPServer:
    if not token:
        raise ValueError("token must not be empty")
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    srv.vault, srv.app_dir, srv.token = Path(vault), Path(app_dir), token
    srv.index, srv.write_lock = Index(srv.vault), threading.Lock()
    return srv


def _load_token(path: Path) -> str:
    try:
        token = path.read_text().strip()
    except FileNotFoundError:
        token = ""
    if token:
        os.chmod(path, 0o600)  # an older or hand-made token file may be world-readable
    else:
        token = secrets.token_urlsafe(32)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(token)
    return token


def main():
    base = Path.home() / "second-mind"
    vault = Path(os.environ.get("SM_VAULT") or base / "vault").expanduser()
    port = int(os.environ.get("SM_PORT") or 7337)
    token = _load_token(base / ".token")
    init_repo(vault)
    seed(vault)
    Index(vault).rebuild()
    srv = make_server(vault, Path(__file__).resolve().parent / "app", token, port)
    print(f"Second Mind on http://127.0.0.1:{srv.server_address[1]}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
