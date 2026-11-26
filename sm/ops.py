"""Vault write operations: create, move (with link rewrite), trash, snapshot."""
import os
import re
import subprocess
import time
from pathlib import Path

from sm.links import CODE_RE, LINK_RE, resolve
from sm.vault import Conflict, Note, all_ids, read_note, slugify, try_read, valid_id, write_note

ROOTS = ("shrestha", "inbox")


def _exists(vault: Path, id: str) -> bool:
    return (vault / id).is_dir() or (vault / f"{id}.md").exists()


def _promote(vault: Path, id: str) -> None:
    """Turn leaf `id.md` into folder `id/_index.md`, content kept."""
    if (vault / id).is_dir():
        return
    leaf = vault / f"{id}.md"
    if not leaf.exists():
        raise FileNotFoundError(id)
    (vault / id).mkdir()
    os.replace(leaf, vault / id / "_index.md")


def _ensure_dirs(vault: Path, id: str) -> None:
    """Make `id` and every ancestor a directory, promoting leaf `.md` ancestors."""
    parts = id.split("/")
    for n in range(1, len(parts) + 1):
        anc = "/".join(parts[:n])
        if (vault / f"{anc}.md").exists():
            _promote(vault, anc)
        else:
            (vault / anc).mkdir(exist_ok=True)


class PartialMove(Exception):
    """The move happened, but some links could not be rewritten."""

    def __init__(self, moved_to: str, unrewritten: list[str], rewritten: int):
        super().__init__(f"moved to {moved_to}; links not rewritten in {unrewritten}")
        self.moved_to, self.unrewritten, self.rewritten = moved_to, unrewritten, rewritten


def create_note(vault: Path, parent_id: str, title: str, type: str, folder: bool) -> Note:
    id = f"{parent_id}/{slugify(title)}"
    if not valid_id(parent_id) or not valid_id(id):
        raise ValueError(f"invalid note id: {id!r}")
    if _exists(vault, id):
        raise FileExistsError(id)
    if not _exists(vault, parent_id):
        raise FileNotFoundError(parent_id)
    _ensure_dirs(vault, parent_id)
    if folder:
        (vault / id).mkdir()
    meta = {"title": title, "type": type, "summary": "", "links": [], "pinned": False}
    return write_note(vault, id, meta, "", None)


def _retarget(raw: str, ids: set[str], mapping: dict[str, str]) -> str:
    """Rewrite the target of one link's inner text, keeping any |alias / #heading."""
    target, suffix = re.fullmatch(r"([^|#]*)(.*)", raw, re.S).groups()
    hit = resolve(target.strip(), ids) if target.strip() else None
    return mapping[hit] + suffix if hit in mapping else raw


def _rewrite(note: Note, ids: set[str], mapping: dict[str, str]) -> tuple[dict, str] | None:
    sub = lambda m: f"[[{_retarget(m[1], ids, mapping)}]]"
    parts, pos = [], 0
    for m in CODE_RE.finditer(note.body):  # code spans stay as written
        parts += [LINK_RE.sub(sub, note.body[pos:m.start()]), m.group()]
        pos = m.end()
    body = "".join(parts) + LINK_RE.sub(sub, note.body[pos:])
    meta = note.meta
    if isinstance(meta.get("links"), list):
        links = []
        for e in meta["links"]:
            if isinstance(e, str):
                inner = e.strip().removeprefix("[[").removesuffix("]]")
                new = _retarget(inner, ids, mapping)
                if new != inner:
                    e = f"[[{new}]]" if e.strip().startswith("[[") else new
            links.append(e)
        meta = {**meta, "links": links}
    return (meta, body) if (meta, body) != (note.meta, note.body) else None


def move_note(vault: Path, id: str, new_id: str) -> int:
    if id in ROOTS or new_id in ROOTS:
        raise ValueError(f"cannot move {id!r} to {new_id!r}: root note")
    if not valid_id(id) or not valid_id(new_id):
        raise ValueError(f"invalid note id: {id!r} -> {new_id!r}")
    if new_id == id or new_id.startswith(id + "/"):
        raise ValueError(f"cannot move {id!r} into itself")
    if _exists(vault, new_id):
        raise ValueError(f"{new_id!r} already exists")
    is_dir = (vault / id).is_dir()
    src = vault / id if is_dir else vault / f"{id}.md"
    if not src.exists():
        raise FileNotFoundError(id)

    # resolve links against the vault as it is before the move
    ids = set(all_ids(vault))
    mapping = {i: new_id + i[len(id):] for i in ids if i == id or i.startswith(id + "/")}
    changes = []
    for i in sorted(ids):
        note = try_read(vault, i)  # an unreadable note cannot be rewritten; it still moves
        new = note and _rewrite(note, ids, mapping)
        if new:
            changes.append((mapping.get(i, i), new, note.mtime_ns))

    _ensure_dirs(vault, new_id.rsplit("/", 1)[0])
    os.replace(src, vault / new_id if is_dir else vault / f"{new_id}.md")
    done, failed = 0, []
    for nid, (meta, body), mtime in changes:
        try:
            try:
                write_note(vault, nid, meta, body, mtime)  # rename keeps mtime, so the base still holds
            except Conflict as c:  # edited meanwhile: redo the rewrite on the fresh content, once
                fresh = _rewrite(c.current, ids, mapping)
                if fresh:
                    write_note(vault, nid, *fresh, c.current.mtime_ns)
            done += 1
        except Conflict:
            failed.append(nid)
    if failed:
        raise PartialMove(new_id, failed, done)
    return done


def trash_note(vault: Path, id: str) -> Path:
    if id in ROOTS:
        raise ValueError(f"cannot trash root note {id!r}")
    if not valid_id(id):
        raise ValueError(f"invalid note id: {id!r}")
    src = vault / id if (vault / id).is_dir() else vault / f"{id}.md"
    if not src.exists():
        raise FileNotFoundError(id)
    dest = vault / ".trash" / f"{time.strftime('%Y%m%d-%H%M%S')}-{id.replace('/', '__')}"
    dest.parent.mkdir(exist_ok=True)
    os.replace(src, dest)
    return dest


def snapshot(vault: Path, min_interval_s: int = 300, now: float | None = None) -> bool:
    # ponytail: time-gated snapshot, per-save commits if history needs finer grain
    now = time.time() if now is None else now
    git_dir = vault / ".git"
    if not git_dir.is_dir():  # never let git walk up into some other repo
        return False
    stamp = git_dir / "sm-last-snapshot"
    try:
        if now - float(stamp.read_text()) < min_interval_s:
            return False
    except (OSError, ValueError):
        pass

    def git(*args):
        return subprocess.run(["git", *args], cwd=vault, check=False, capture_output=True)

    git("add", "-A")
    if git("diff", "--cached", "--quiet").returncode != 1:  # 1 = staged changes
        return False
    if git("commit", "-q", "-m", "autosave").returncode != 0:
        return False
    stamp.write_text(str(now))
    return True
