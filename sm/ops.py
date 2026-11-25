"""Vault write operations: create, move (with link rewrite), trash, snapshot."""
import os
import re
import subprocess
import time
from pathlib import Path

from sm.links import CODE_RE, LINK_RE, resolve
from sm.vault import Note, all_ids, read_note, slugify, valid_id, write_note

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


def create_note(vault: Path, parent_id: str, title: str, type: str, folder: bool) -> Note:
    id = f"{parent_id}/{slugify(title)}"
    if not valid_id(parent_id) or not valid_id(id):
        raise ValueError(f"invalid note id: {id!r}")
    if _exists(vault, id):
        raise FileExistsError(id)
    _promote(vault, parent_id)
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
        note = read_note(vault, i)
        done = _rewrite(note, ids, mapping)
        if done:
            changes.append((mapping.get(i, i), done, note.mtime_ns))

    parent = new_id.rsplit("/", 1)[0]
    if (vault / f"{parent}.md").exists():
        _promote(vault, parent)
    (vault / parent).mkdir(parents=True, exist_ok=True)
    os.replace(src, vault / new_id if is_dir else vault / f"{new_id}.md")
    # ponytail: a Conflict mid-loop leaves earlier notes rewritten; no rollback
    for nid, (meta, body), mtime in changes:
        write_note(vault, nid, meta, body, mtime)  # rename keeps mtime, so the base still holds
    return len(changes)


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
