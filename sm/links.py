"""Wiki links, backlinks and the graph payload (read-only over the vault)."""
import re
from datetime import date
from pathlib import Path

from sm.vault import all_ids, is_stale, slugify, try_read

CODE_RE = re.compile(r"```.*?(```|\Z)|`[^`\n]*`", re.S)
LINK_RE = re.compile(r"\[\[([^\[\]\n]+)\]\]")


def _target(raw: str) -> str:
    return re.split(r"[|#]", raw, maxsplit=1)[0].strip()


def extract_links(meta: dict, body: str) -> list[str]:
    raw = LINK_RE.findall(CODE_RE.sub("", body))
    fm = meta.get("links")
    if isinstance(fm, list):
        for e in fm:
            if isinstance(e, str):
                raw.append(e.strip().removeprefix("[[").removesuffix("]]"))
    return list(dict.fromkeys(t for t in map(_target, raw) if t))


def resolve(target: str, ids: set[str]) -> str | None:
    if target in ids:
        return target
    if f"shrestha/{target}" in ids:
        return f"shrestha/{target}"
    slug = slugify(target)
    hits = [i for i in ids if i.rsplit("/", 1)[-1] == slug]
    return hits[0] if len(hits) == 1 else None


def link_index(vault: Path) -> dict:
    ids = all_ids(vault)
    idset = set(ids)
    out = {i: [] for i in ids}
    back = {i: [] for i in ids}
    missing: dict[str, list[str]] = {}
    for i in ids:
        note = try_read(vault, i)
        if note is None:
            continue
        for t in extract_links(note.meta, note.body):
            r = resolve(t, idset)
            if r is None:
                missing.setdefault(i, []).append(t)
            elif r != i and r not in out[i]:
                out[i].append(r)
                back[r].append(i)
    return {"out": out, "back": back, "missing": missing}


def graph_payload(vault: Path, today: date | None = None) -> dict:
    today = today or date.today()
    ids = all_ids(vault)
    nodes: dict[str, dict] = {}

    def add(id: str, meta: dict):
        parent = id.rsplit("/", 1)[0] if id.startswith("shrestha/") else None
        nodes[id] = {"id": id, "title": str(meta.get("title") or id.rsplit("/", 1)[-1]),
                     "type": meta.get("type"), "stale": is_stale(meta, today),
                     "parent": parent, "pinned": meta.get("pinned") is True,
                     "updated": u if isinstance(u := meta.get("updated"), str) else None}

    for i in ids:
        if i != "inbox" and (n := try_read(vault, i)):
            add(i, n.meta)
    # folders with notes but no _index.md still need a node, so tree edges stay connected
    for i in list(nodes):
        while i.startswith("shrestha/"):
            i = i.rsplit("/", 1)[0]
            if i not in nodes:
                add(i, {})

    edges = [{"source": n["parent"], "target": n["id"], "kind": "tree"}
             for n in nodes.values() if n["parent"]]
    for src, targets in link_index(vault)["out"].items():
        edges += [{"source": src, "target": t, "kind": "link"}
                  for t in targets if src in nodes and t in nodes]
    return {"nodes": list(nodes.values()), "edges": edges}
