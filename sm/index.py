"""FTS5 full-text search over the vault, stored in vault/.index.db."""
import sqlite3
from contextlib import closing
from pathlib import Path

from sm.vault import all_ids, read_note

SCHEMA = ("CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5("
          "id UNINDEXED, title, summary, body, tokenize='unicode61')")


def _match_query(q: str) -> str:
    terms = [f'"{t.replace(chr(34), chr(34) * 2)}"' for t in q.split()]
    if terms:
        terms[-1] += "*"  # prefix search on the last term
    return " ".join(terms)


class Index:
    def __init__(self, vault: Path):
        self.vault = Path(vault)
        self.db = self.vault / ".index.db"

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db)
        conn.execute(SCHEMA)
        return conn

    def _row(self, id: str) -> tuple:
        n = read_note(self.vault, id)
        title = n.meta.get("title") or id.rsplit("/", 1)[-1]
        return id, str(title), str(n.meta.get("summary") or ""), n.body

    @staticmethod
    def _delete(conn: sqlite3.Connection, id: str, subtree: bool) -> None:
        conn.execute("DELETE FROM notes WHERE id = ?", (id,))
        if subtree:
            p = id + "/"
            conn.execute("DELETE FROM notes WHERE substr(id, 1, ?) = ?", (len(p), p))

    def rebuild(self) -> int:
        rows = []
        for id in all_ids(self.vault):
            try:
                rows.append(self._row(id))
            except (OSError, ValueError):  # unreadable or non-UTF-8 note: skip it
                continue
        with closing(self._connect()) as conn, conn:
            conn.execute("DELETE FROM notes")
            conn.executemany("INSERT INTO notes(id, title, summary, body) VALUES (?,?,?,?)", rows)
        return len(rows)

    def update(self, id: str) -> None:
        try:
            row = self._row(id)
        except FileNotFoundError:
            return self.remove(id, subtree=False)
        with closing(self._connect()) as conn, conn:
            self._delete(conn, id, subtree=False)
            conn.execute("INSERT INTO notes(id, title, summary, body) VALUES (?,?,?,?)", row)

    def remove(self, id: str, subtree: bool = True) -> None:
        with closing(self._connect()) as conn, conn:
            self._delete(conn, id, subtree)

    def search(self, q: str, limit: int = 20) -> list[dict]:
        match = _match_query(q)
        if not match:
            return []
        with closing(self._connect()) as conn:
            try:
                rows = conn.execute(
                    "SELECT id, title, snippet(notes, -1, '<mark>', '</mark>', '…', 12) "
                    "FROM notes WHERE notes MATCH ? ORDER BY bm25(notes, 0, 10, 5, 1) LIMIT ?",
                    (match, limit)).fetchall()
            except sqlite3.OperationalError:
                return []
        return [{"id": i, "title": t, "snippet": s} for i, t, s in rows]
