"""Markdown vault core: frontmatter, note ids, atomic read/write, tree."""
import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

ID_RE = re.compile(r"(shrestha|inbox)(/[a-z0-9][a-z0-9-]{0,63})*")
KEY_RE = re.compile(r"([A-Za-z0-9_-]+):\s*(.*)")
STALE_DAYS = 30


@dataclass
class Note:
    id: str
    meta: dict
    body: str
    mtime_ns: int


class Conflict(Exception):
    def __init__(self, current: Note):
        super().__init__(f"{current.id} changed on disk")
        self.current = current


# ---- frontmatter (a YAML subset we read and write) ----

def _parse_value(raw: str):
    """Return the value, or raise ValueError if the line is unparseable."""
    if raw[:1] in ('"', "["):
        return json.loads(raw)  # JSONDecodeError is a ValueError
    if raw[:1] == "{":
        raise ValueError(raw)
    return {"true": True, "false": False}.get(raw, raw)


def parse_note(text: str) -> tuple[dict, str]:
    norm = text.replace("\r\n", "\n")
    if not norm.startswith("---\n"):
        return {}, text
    lines = norm[4:].split("\n")
    try:
        end = lines.index("---")
    except ValueError:
        return {}, text
    meta, raw_lines = {}, []
    for line in lines[:end]:
        m = KEY_RE.fullmatch(line)
        try:
            if not m:
                raise ValueError(line)
            meta[m[1]] = _parse_value(m[2].strip())
        except ValueError:
            if line.strip():
                raw_lines.append(line)
    if raw_lines:
        meta["_raw_lines"] = raw_lines
    return meta, "\n".join(lines[end + 1:])


def dump_note(meta: dict, body: str) -> str:
    out = ["---"]
    for k, v in meta.items():
        if k == "_raw_lines":
            continue
        out.append(f"{k}: {'true' if v is True else 'false' if v is False else json.dumps(v, ensure_ascii=False)}")
    out += meta.get("_raw_lines", [])
    out.append("---")
    return "\n".join(out) + "\n" + body


# ---- ids and paths ----

def valid_id(id: str) -> bool:
    return bool(ID_RE.fullmatch(id))


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:64].strip("-") or "untitled"


def note_path(vault: Path, id: str) -> Path:
    if not valid_id(id):
        raise ValueError(f"invalid note id: {id!r}")
    folder = vault / id
    p = folder / "_index.md" if folder.is_dir() else vault / f"{id}.md"
    if not p.resolve().is_relative_to(vault.resolve()):
        raise ValueError(f"note id escapes vault: {id!r}")
    return p


# ---- read / write ----

def read_note(vault: Path, id: str) -> Note:
    with open(note_path(vault, id), "rb") as f:
        mtime_ns = os.fstat(f.fileno()).st_mtime_ns
        meta, body = parse_note(f.read().decode("utf-8"))
    return Note(id, meta, body, mtime_ns)


def write_note(vault: Path, id: str, meta: dict, body: str,
               base_mtime_ns: int | None) -> Note:
    path = note_path(vault, id)
    if base_mtime_ns is not None and path.exists():
        if path.stat().st_mtime_ns != base_mtime_ns:
            raise Conflict(read_note(vault, id))
    meta = {**meta, "updated": date.today().isoformat()}
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(dump_note(meta, body))
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise
    return read_note(vault, id)


# ---- listing ----

def all_ids(vault: Path) -> list[str]:
    ids = []
    for dirpath, dirs, files in os.walk(vault):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != "_raw"]
        rel = Path(dirpath).relative_to(vault)
        for f in files:
            if not f.endswith(".md"):
                continue
            id = rel.as_posix() if f == "_index.md" else (rel / f[:-3]).as_posix()
            if valid_id(id):
                ids.append(id)
    return sorted(ids)


def is_stale(meta: dict, today: date) -> bool:
    try:
        return (today - date.fromisoformat(meta["updated"])).days > STALE_DAYS
    except (KeyError, TypeError, ValueError):
        return True


def tree(vault: Path, root: str = "shrestha", today: date | None = None) -> dict:
    today = today or date.today()
    ids = all_ids(vault)
    kids: dict[str, list[str]] = {}
    for i in ids:
        if "/" in i:
            kids.setdefault(i.rsplit("/", 1)[0], []).append(i)

    def node(id: str) -> dict:
        try:
            meta = read_note(vault, id).meta
        except FileNotFoundError:
            meta = {}
        children = sorted(
            (node(c) for c in kids.get(id, [])),
            key=lambda n: (not (vault / n["id"]).is_dir(), n["title"].lower()))
        return {"id": id, "title": meta.get("title") or id.rsplit("/", 1)[-1],
                "type": meta.get("type"), "stale": is_stale(meta, today),
                "children": children}

    return node(root)
