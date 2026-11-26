"""Engram MCP server (stdio). Lets AI clients read the vault and record what they learn.

Run: python3 mcp_server.py --agent <name>. The agent name comes from each client's own
config, never from what the client says about itself: `claude` may create and edit notes,
every other agent may only propose notes into inbox/ai/<agent>/ for review.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from sm.index import Index
from sm.ops import _exists, create_note, move_note, snapshot, trash_note, PartialMove
from sm.pack import build_pack
from sm.redact import redact
from sm.vault import Conflict, all_ids, read_note, slugify, tree, try_read, valid_id, write_note

EDITOR = "claude"
AGENT_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
INSTRUCTIONS = (
    "Engram is Shrestha's personal knowledge vault: their work, college, projects, people, "
    "competitions and preferences, as a tree of markdown notes under `shrestha/`. "
    "Before answering anything about Shrestha, `search` Engram and `read` or `pack` what you find. "
    "When you learn something durable about Shrestha (a decision, a fact, a preference, a project update), "
    "record it: {how} Keep notes factual and short, link related notes as [[note-id]], and never store "
    "secrets, passwords or keys."
)
HOW = {
    "editor": "`edit` the right note (append is safest), or `create` one under the right parent. "
              "Also `review_inbox` now and then: other AIs propose notes there for you to `accept` or `reject`.",
    "contributor": "`propose` a note, with `about` set to the note it belongs under. "
                   "Claude or Shrestha reviews proposals before they enter the vault.",
}


class ToolError(Exception):
    pass


def _s(desc, **extra):
    return {"type": "string", "description": desc, **extra}


TOOLS = {
    "search": ("Full-text search over all notes. Returns note ids, titles and snippets.",
               {"query": _s("Words to search for."), "limit": {"type": "integer", "description": "Max results (default 10)."}},
               ["query"], True),
    "read": ("Read one note: its fields, body and `version` (needed to replace it with `edit`).",
             {"id": _s("Note id, e.g. shrestha/builds/second-mind.")}, ["id"], True),
    "tree": ("Outline of the note tree: ids, titles, and [stale] for notes not updated in a while.",
             {"root": _s("Subtree to show (default shrestha).")}, [], True),
    "pack": ("A compact context pack for a note: its path, body and linked notes, within a token budget.",
             {"id": _s("Note id."), "budget": {"type": "integer", "description": "Token budget (default 1500)."}},
             ["id"], True),
    "propose": ("Propose a new note for review. It lands in inbox/ai/<you>/ until Claude or Shrestha accepts it.",
                {"title": _s("Note title."), "body": _s("Markdown body."),
                 "about": _s("Id of the existing note this belongs under, e.g. shrestha/builds.")},
                ["title", "body"], False),
    "create": ("Create a note under an existing parent note.",
               {"parent": _s("Parent note id, e.g. shrestha/builds."), "title": _s("Note title."),
                "body": _s("Markdown body."), "summary": _s("One-line summary.")},
               ["parent", "title", "body"], False),
    "edit": ("Edit a note. mode=append adds to the end (no version needed); mode=replace swaps the "
             "whole body and needs the `version` from your last `read`.",
             {"id": _s("Note id."), "body": _s("Text to append, or the new full body."),
              "mode": _s("append or replace (default append).", enum=["append", "replace"]),
              "version": _s("The version from `read` (replace only)."),
              "summary": _s("New one-line summary (optional).")},
             ["id", "body"], False),
    "review_inbox": ("List notes other AIs have proposed, waiting for review.", {}, [], True),
    "accept": ("Accept a proposal: move it into the vault under its `about` note, or under `parent`.",
               {"id": _s("Proposal id from review_inbox."), "parent": _s("Where to put it (default: its about).")},
               ["id"], False),
    "reject": ("Reject a proposal. It moves to the vault's trash and can be restored by hand.",
               {"id": _s("Proposal id from review_inbox.")}, ["id"], False),
}
CONTRIBUTOR_TOOLS = ("search", "read", "tree", "pack", "propose")


class Engram:
    def __init__(self, vault: Path, agent: str):
        if not AGENT_RE.fullmatch(agent):
            raise ValueError(f"agent must match {AGENT_RE.pattern}: {agent!r}")
        self.vault, self.agent = vault, agent
        self.tier = "editor" if agent == EDITOR else "contributor"
        self.index = Index(vault)
        self.index.rebuild()  # files may have changed while no server was running

    def allowed(self) -> list[str]:
        return list(TOOLS) if self.tier == "editor" else list(CONTRIBUTOR_TOOLS)

    def tool_list(self) -> list[dict]:
        out = []
        for name in self.allowed():
            desc, props, req, ro = TOOLS[name]
            out.append({"name": name, "description": desc,
                        "inputSchema": {"type": "object", "properties": props, "required": req},
                        "annotations": {"readOnlyHint": ro, "destructiveHint": name == "reject"}})
        return out

    def call(self, name: str, args: dict) -> str:
        if name not in self.allowed():
            raise ToolError(f"{name!r} is not available to {self.agent}")
        if not isinstance(args, dict):
            raise ToolError("arguments must be an object")
        return redact(getattr(self, "t_" + name)(**args))

    # ---- helpers ----

    def _id(self, v) -> str:
        if not isinstance(v, str) or not valid_id(v):
            raise ToolError(f"not a valid note id: {v!r}")
        return v

    def _text(self, v, field: str, required=True) -> str:
        if v is None and not required:
            return ""
        if not isinstance(v, str) or (required and not v.strip()):
            raise ToolError(f"{field} must be a non-empty string")
        if redact(v) != v:
            raise ToolError(f"{field} looks like it contains a secret (API key or private key); not saved")
        return v

    def _read(self, id: str):
        n = try_read(self.vault, id)
        if n is None:
            raise ToolError(f"no note {id!r}")
        return n

    def _git(self, **kw):
        try:
            snapshot(self.vault, min_interval_s=0, **kw)
        except OSError as e:  # git missing or broken: the note is saved, history is not
            print(f"engram: commit failed: {e!r}", file=sys.stderr)

    def _pre(self):
        """Commit the user's own pending edits first, so the AI's commit holds only its change."""
        self._git()
        if not (self.vault / ".git").is_dir():
            return
        try:
            dirty = subprocess.run(["git", "status", "--porcelain"], cwd=self.vault,
                                   capture_output=True, text=True).stdout.strip()
        except OSError:
            return  # no git: nothing would be misattributed
        if dirty:
            raise ToolError("could not commit your pending edits first; refusing so they are not "
                            f"recorded as {self.agent}'s change. Check `git status` in the vault.")

    def _commit(self, action: str, id: str):
        self._git(message=f"{self.agent}: {action} {id}", author=f"{self.agent} via Engram <engram@localhost>")

    def _new(self, parent: str, title: str, meta: dict, body: str, action: str) -> str:
        base, n = slugify(title), 1
        if not base:
            raise ToolError("title needs at least one letter or digit")
        title_n = title
        while _exists(self.vault, f"{parent}/{slugify(title_n)}"):
            n += 1
            title_n = f"{title} {n}"
        try:
            note = create_note(self.vault, parent, title_n, "note", False)
        except FileNotFoundError:
            raise ToolError(f"no parent note {parent!r}")
        except (ValueError, FileExistsError) as e:
            raise ToolError(str(e))
        write_note(self.vault, note.id, {**note.meta, "title": title, **meta}, body.strip() + "\n", note.mtime_ns)
        self.index.update(note.id)
        self.index.update(parent)  # a leaf parent may have been promoted to a folder
        self._commit(action, note.id)
        return note.id

    # ---- tools ----

    def t_search(self, query, limit=10):
        if not isinstance(query, str) or not query.strip():
            raise ToolError("query must be a non-empty string")
        limit = max(1, min(int(limit), 50)) if isinstance(limit, int) else 10
        hits = self.index.search(query, limit)
        if not hits:
            return f"No notes match {query!r}."
        return "\n".join(f"- {h['id']} | {h['title']}\n  {h['snippet'].replace('<mark>', '**').replace('</mark>', '**')}"
                         for h in hits)

    def t_read(self, id):
        n = self._read(self._id(id))
        fields = "\n".join(f"{k}: {json.dumps(v, ensure_ascii=False)}" for k, v in n.meta.items() if k != "_raw_lines")
        return f"id: {n.id}\nversion: {n.mtime_ns}\n{fields}\n---\n{n.body}"

    def t_tree(self, root="shrestha"):
        root = self._id(root)
        if try_read(self.vault, root) is None:
            raise ToolError(f"no note {root!r}")
        lines = []

        def walk(node, depth):
            lines.append(f"{'  ' * depth}- {node['id']} | {node['title']}{' [stale]' if node.get('stale') else ''}")
            for c in node.get("children", []):
                walk(c, depth + 1)

        walk(tree(self.vault, root), 0)
        return "\n".join(lines)

    def t_pack(self, id, budget=1500):
        id = self._id(id)
        self._read(id)
        budget = max(200, min(int(budget), 8000)) if isinstance(budget, int) else 1500
        p = build_pack(self.vault, id, budget=budget)
        return f"{p['text']}\n\n(~{p['tokens']} tokens)"

    def t_propose(self, title, body, about=None):
        title, body = self._text(title, "title"), self._text(body, "body")
        meta = {"proposed_by": self.agent}
        if about is not None:
            meta["about"] = self._read(self._id(about)).id
        self._pre()
        for pid, ptitle in (("inbox/ai", "AI proposals"), (f"inbox/ai/{self.agent}", self.agent)):
            if try_read(self.vault, pid) is None:
                parent, _, slug = pid.rpartition("/")
                note = create_note(self.vault, parent, slug, "area", True)
                write_note(self.vault, note.id, {**note.meta, "title": ptitle}, "", note.mtime_ns)
        id = self._new(f"inbox/ai/{self.agent}", title, meta, body, "propose")
        return f"Proposed {id}. It waits in the inbox until it is reviewed."

    def t_create(self, parent, title, body, summary=None):
        parent = self._id(parent)
        meta = {"summary": self._text(summary, "summary", required=False)} if summary else {}
        title, body = self._text(title, "title"), self._text(body, "body")
        self._read(parent)
        self._pre()
        id = self._new(parent, title, meta, body, "create")
        return f"Created {id}."

    def t_edit(self, id, body, mode="append", version=None, summary=None):
        id, body = self._id(id), self._text(body, "body")
        if mode not in ("append", "replace"):
            raise ToolError("mode must be append or replace")
        n = self._read(id)
        meta = dict(n.meta)
        if summary is not None:
            meta["summary"] = self._text(summary, "summary")
        if mode == "append":
            new_body = n.body.rstrip() + ("\n\n" if n.body.strip() else "") + body.strip() + "\n"
            base = n.mtime_ns
        else:
            if redact(n.body) != n.body:
                raise ToolError("this note holds a secret you can't see; use mode=append, or ask Shrestha to edit it")
            if version is None:
                raise ToolError("replace needs the version from your last read")
            if not str(version).isdigit():
                raise ToolError("version must be the number from read")
            new_body, base = body.strip() + "\n", int(version)
        self._pre()
        try:
            write_note(self.vault, id, meta, new_body, base)
        except Conflict as c:
            raise ToolError(f"{id} changed since you read it (now version {c.current.mtime_ns}); read it again")
        self.index.update(id)
        self._commit(mode, id)
        return f"Saved {id} ({mode})."

    def t_review_inbox(self):
        ids = [i for i in sorted(all_ids(self.vault)) if i.startswith("inbox/ai/") and i.count("/") >= 3]
        if not ids:
            return "No proposals waiting."
        out = []
        for i in ids:
            n = try_read(self.vault, i)
            if n is None:
                continue
            body = n.body.strip().replace("\n", " ")
            out.append(f"- {i} | {n.meta.get('title', '')} | by {n.meta.get('proposed_by', '?')}"
                       f" | about {n.meta.get('about', '(none)')}\n  {body[:240]}{'…' if len(body) > 240 else ''}")
        return "\n".join(out)

    def _proposal(self, id) -> str:
        id = self._id(id)
        if not id.startswith("inbox/ai/") or id.count("/") < 3:
            raise ToolError(f"{id!r} is not a proposal")
        if (self.vault / id).is_dir():
            raise ToolError(f"{id!r} is a folder, not a proposal")
        self._read(id)
        return id

    def t_accept(self, id, parent=None):
        id = self._proposal(id)
        n = read_note(self.vault, id)
        parent = self._id(parent if parent is not None else n.meta.get("about"))
        if parent.startswith("inbox/ai"):
            raise ToolError("accept moves a proposal out of inbox/ai; pick a parent outside it")
        if try_read(self.vault, parent) is None:
            raise ToolError(f"no parent note {parent!r}")
        new_id = f"{parent}/{id.rsplit('/', 1)[1]}"
        self._pre()
        try:
            move_note(self.vault, id, new_id)
        except PartialMove:
            pass  # the note moved; a link elsewhere kept its old target
        except (ValueError, FileNotFoundError) as e:
            raise ToolError(str(e))
        self.index.rebuild()
        self._commit("accept", new_id)
        return f"Accepted {id} as {new_id}."

    def t_reject(self, id):
        id = self._proposal(id)
        self._pre()
        trash_note(self.vault, id)
        self.index.remove(id)
        self._commit("reject", id)
        return f"Rejected {id} (moved to the vault's .trash/)."


# ---- JSON-RPC over stdio ----

def handle(eng: Engram, msg: dict) -> dict | None:
    mid, method, params = msg.get("id"), msg.get("method"), msg.get("params")
    params = params if isinstance(params, dict) else {}
    if "id" not in msg:  # notification: never answered
        return None

    def ok(result):
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    if method == "initialize":
        return ok({"protocolVersion": params.get("protocolVersion") or "2025-06-18",
                   "capabilities": {"tools": {}},
                   "serverInfo": {"name": "engram", "version": "1.0.0"},
                   "instructions": INSTRUCTIONS.format(how=HOW[eng.tier])})
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": eng.tool_list()})
    if method == "tools/call":
        try:
            text, err = eng.call(params.get("name"), params.get("arguments") or {}), False
        except ToolError as e:
            text, err = str(e), True
        except TypeError as e:  # wrong or missing arguments
            text, err = f"bad arguments: {e}", True
        except (OSError, ValueError) as e:
            text, err = f"failed: {e}", True
        return ok({"content": [{"type": "text", "text": redact(text)}], "isError": err})
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}


def serve(eng: Engram, inp=sys.stdin, out=sys.stdout):
    for line in inp:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        else:
            reply = handle(eng, msg) if isinstance(msg, dict) else \
                {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "invalid request"}}
        if reply is not None:
            out.write(json.dumps(reply, ensure_ascii=False) + "\n")
            out.flush()


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--agent", required=True, help="who this client is: claude, codex, gemini, antigravity, ...")
    a = ap.parse_args()
    vault = Path(os.environ.get("SM_VAULT") or Path.home() / "second-mind" / "vault").expanduser()
    if not (vault / "shrestha").is_dir():
        sys.exit(f"engram: no vault at {vault}; run server.py once to create it")
    serve(Engram(vault, a.agent))


if __name__ == "__main__":
    main()
