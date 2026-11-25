"""Context pack: a budgeted markdown slice of the vault around one note."""
from datetime import date
from pathlib import Path

from sm.links import link_index
from sm.redact import estimate_tokens, redact
from sm.vault import all_ids, is_stale, read_note


def _text(v, fallback=""):
    """One-line string from a frontmatter value, or the fallback."""
    return " ".join(v.split()) if isinstance(v, str) and v.strip() else fallback


def _day(meta: dict):
    try:
        return date.fromisoformat(meta["updated"])
    except (KeyError, TypeError, ValueError):
        return None


def _is_inbox(id: str) -> bool:
    return id == "inbox" or id.startswith("inbox/")


def build_pack(vault: Path, id: str, budget: int = 1500, include=(), exclude=(),
               today: date | None = None) -> dict:
    today = today or date.today()
    node = read_note(vault, id)  # FileNotFoundError for an unknown id

    metas: dict[str, dict] = {id: node.meta}

    def meta(i: str) -> dict:
        if i not in metas:
            try:
                metas[i] = read_note(vault, i).meta
            except FileNotFoundError:
                metas[i] = {}
        return metas[i]

    def title(i: str) -> str:
        return _text(meta(i).get("title"), i.rsplit("/", 1)[-1])

    def summary(i: str) -> str:
        return _text(meta(i).get("summary"))

    parts = id.split("/")
    ancestors = ["/".join(parts[:n]) for n in range(1, len(parts))]
    path_lines = []
    for a in ancestors:
        d = meta(a).get("updated")
        d = d if isinstance(d, str) and d else "?"
        mark = f"updated {d}, STALE" if is_stale(meta(a), today) else f"updated {d}"
        path_lines.append(f"- {title(a)} ({mark})" + (f": {summary(a)}" if summary(a) else ""))
    crumb = " › ".join([title(a) for a in ancestors] + [title(id)])

    # candidates: include, then pinned direct links, then the rest newest first
    exclude, ids = set(exclude), set(all_ids(vault))
    skip = {id, *ancestors, *exclude}
    idx = link_index(vault)
    direct = [i for i in dict.fromkeys(idx["out"].get(id, []) + idx["back"].get(id, []))
              if i not in skip and not (_is_inbox(i) and i not in include)]

    def rank(i):
        d = _day(meta(i))
        return (meta(i).get("pinned") is not True, d is None, -(d.toordinal() if d else 0), i)

    cands = [i for i in dict.fromkeys(include) if i in ids and i not in skip]
    cands += [i for i in sorted(direct, key=rank) if i not in cands]

    def line(i: str, with_summary: bool) -> str:
        s = summary(i)
        return f"- [[{i}]] {title(i)}" + (f": {s}" if with_summary and s else "")

    def assemble(show_body: bool, k: int, left: list[str]) -> tuple[str, int]:
        out = []
        if path_lines:
            out += ["## Path", *path_lines]
        out.append(f"## Note: {title(id)}")
        if summary(id):
            out.append(summary(id))
        if node.body.strip():
            out.append(node.body.strip() if show_body else "(body omitted)")
        if k:
            out += ["## Linked", *(line(i, True) for i in cands[:k])]
        if left:
            out += ["## Left out", *left]
        # the header holds N, so find the least n with tokens(text(n)) == n
        # (tokens is non-decreasing in n, so n = f(n) from f(0) converges upward)
        def full(n):
            return redact("\n".join([f"# Context pack: {crumb} (≈{n} tokens)", *out]) + "\n")
        n = estimate_tokens(full(0))
        while (m := estimate_tokens(full(n))) != n:
            n = m
        return full(n), n

    def render(show_body: bool, k: int) -> tuple[str, int, bool]:
        """Pack with cands[:k] linked; the rest listed under Left out, capped to fit.
        The flag is False when the Left out section had to be dropped."""
        rest = cands[k:]
        base = assemble(show_body, k, [])
        if not rest:
            return (*base, True)

        def with_left(j: int):
            more = [f"- … and {len(rest) - j} more"] if j < len(rest) else []
            return assemble(show_body, k, [line(i, False) for i in rest[:j]] + more)

        if (full := with_left(len(rest)))[1] <= budget:
            return (*full, True)
        lo, hi = 0, len(rest) - 1  # largest j whose pack fits
        while lo < hi:
            mid = (lo + hi + 1) // 2
            lo, hi = (mid, hi) if with_left(mid)[1] <= budget else (lo, mid - 1)
        capped = with_left(lo)
        # ponytail: if even "… and K more" overflows a budget the base meets, drop the section
        return (*capped, True) if capped[1] <= budget or base[1] > budget else (*base, False)

    show_body, k = False, 0
    if render(False, 0)[1] <= budget:
        show_body = render(True, 0)[1] <= budget
        while k < len(cands) and (r := render(show_body, k + 1))[1] <= budget and r[2]:
            k += 1
    text, tokens, _ = render(show_body, k)
    return {"text": text, "tokens": tokens, "included": cands[:k], "omitted": cands[k:]}
