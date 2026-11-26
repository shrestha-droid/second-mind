"""Build the read-only static demo into demo/site/ (or the path given).

It seeds a fresh temp vault (never the real one), adds sample notes about the app
itself, snapshots every API read into data.json, and copies app/ next to a fetch
shim (demo.js) that answers the app's API calls from that file.

    python3 demo/build.py [out_dir]
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import note_json  # noqa: E402
from sm.links import graph_payload  # noqa: E402
from sm.ops import create_note  # noqa: E402
from sm.pack import build_pack  # noqa: E402
from sm.seed import seed  # noqa: E402
from sm.vault import all_ids, read_note, tree, write_note  # noqa: E402

BUDGETS = [1500, 3000, 6000, 12000]  # the pack panel's presets (app/index.html)

# (parent, title, type, folder, summary, pinned, body). Facts come from README.md and
# docs/superpowers/specs/2026-11-25-second-mind-design.md.
NOTES = [
    ("shrestha/builds", "Second Mind", "project", True,
     "A local, Obsidian-like notes app: markdown vault, search, 3D graph, context packs.", True,
     "A local notes app. Notes are plain markdown files in a vault on disk, organised as a "
     "tree of folder notes, linked to each other, searchable and shown in a 3D graph.\n\n"
     "The idea: **disk is unlimited and free, context is small and costly.** Everything "
     "lives on disk; each AI gets only a small, budgeted slice of it.\n\n"
     "## Parts\n\n- [[Vault]]: where notes live\n- [[Search]]: SQLite FTS5\n"
     "- [[Graph view]]: the 3D holographic graph\n- [[Context packs]]: budgeted slices for an AI\n"
     "- [[Local server]]: Python stdlib, `127.0.0.1` only\n- [[Roadmap]]: what comes next\n"),
    ("shrestha/builds/second-mind", "Vault", "area", False,
     "Plain markdown files with a small frontmatter, in their own git repo.", False,
     "Every note is a markdown file. Folder notes are `_index.md` inside their folder.\n\n"
     "Frontmatter fields: `title`, `type`, `summary`, `links`, `pinned`, `updated`.\n\n"
     "- The vault gets its own git repo; **no remote is ever added**.\n"
     "- Deleting a note moves it to `.trash/`, never a hard delete.\n"
     "- Saves are atomic, and a note changed on disk is never overwritten silently.\n\n"
     "Indexed by [[Search]]; drawn by the [[Graph view]].\n"),
    ("shrestha/builds/second-mind", "Search", "area", False,
     "SQLite FTS5 index, rebuilt from the markdown on start and updated on each write.", False,
     "The index lives at `vault/.index.db` (stdlib `sqlite3`). Markdown stays the source of "
     "truth, so the index can always be rebuilt.\n\n"
     "Secret-looking strings (`sk-…`, `ghp_…`, `AKIA…`, `xox…`, private keys) are redacted in "
     "search results and in [[Context packs]].\n\n"
     "Try the search box in the sidebar, or press ⌘K to jump to any note.\n"),
    ("shrestha/builds/second-mind", "Graph view", "area", False,
     "A 3D holographic graph on Canvas: tree edges solid, cross-links dashed.", False,
     "Drawn with Canvas 2D, no WebGL and no libraries. Drag to orbit, scroll to zoom, click a "
     "node to open it.\n\n"
     "- Tree edges come from the folder structure of the [[Vault]].\n"
     "- Cross-links come from `[[wiki links]]` in note bodies.\n"
     "- Stale notes (summary older than 30 days) are marked.\n"
     "- Press F to filter to the current branch.\n"),
    ("shrestha/builds/second-mind", "Context packs", "area", False,
     "Pick a note, get a budgeted context slice for an AI. Zero model calls.", True,
     "A pack is built in this order, and cut at the budget:\n\n"
     "1. Ancestor summaries, root to parent, each with its `updated` date.\n"
     "2. The note: full body if it fits, else its summary.\n"
     "3. Linked notes (outgoing and backlinks), summaries only: pinned first, then direct "
     "links, then newest.\n\n"
     "The default budget is 1,500 tokens (estimate = characters / 4, labelled ≈). The pack "
     "ends with a list of what was left out. Open the Pack tab on any note to see one.\n\n"
     "Secrets are redacted, as in [[Search]].\n"),
    ("shrestha/builds/second-mind", "Local server", "area", False,
     "Python stdlib HTTP server bound to 127.0.0.1:7337. Nothing leaves the laptop.", False,
     "`python3 server.py`, then open http://127.0.0.1:7337.\n\n"
     "- Binds to `127.0.0.1` only.\n"
     "- Writes need an API token (generated into `.token`, mode 600) and a JSON content type.\n"
     "- One write lock; a save against a stale copy gets a 409 with the current note.\n\n"
     "It serves the [[Vault]], [[Search]] and [[Context packs]] to the app.\n"),
    ("shrestha/builds/second-mind", "Roadmap", "area", False,
     "Phase 1 is the app. Next: an MCP server, more MCP clients, then a Chrome extension.", False,
     "1. Vault, seed tree, FTS5 search, pack builder, local server and the app. **Done.**\n"
     "2. MCP server for Claude Code, then read-only mounts of the [[Claude setup]].\n"
     "3. Extra MCP clients (Codex CLI, Gemini CLI, Claude desktop), each verified.\n"
     "4. Chrome extension: Capture, Insert pack, Distill-in-this-chat.\n\n"
     "Each phase is checked in use before the next.\n"),
    ("inbox", "Welcome to the demo", "note", False,
     "This copy runs in your browser on sample notes. Edits stay in this tab.", False,
     "This is a static copy of Second Mind on sample notes. It is read-only: edits you make "
     "stay in this tab and are gone on reload; creating, moving and deleting are turned off.\n\n"
     "Start at [[Second Mind]], open the graph, or try the Pack tab.\n\n"
     "The real app runs locally: `python3 server.py`.\n"),
]

ROOT_BODY = ("This is the demo vault. The tree is the app's starting seed tree; "
             "[[Second Mind]] holds sample notes about the app itself.\n")


def build_vault(vault: Path) -> None:
    seed(vault)
    root = read_note(vault, "shrestha")
    write_note(vault, "shrestha", root.meta, ROOT_BODY, None)
    for parent, title, type, folder, summary, pinned, body in NOTES:
        n = create_note(vault, parent, title, type, folder)
        write_note(vault, n.id, {**n.meta, "summary": summary, "pinned": pinned}, body, None)


def snapshot(vault: Path) -> dict:
    ids = all_ids(vault)
    return {
        "tree": {"root": tree(vault), "inbox": tree(vault, root="inbox")},
        "graph": graph_payload(vault),
        "notes": {i: note_json(vault, read_note(vault, i)) for i in ids},
        "packs": {i: {str(b): build_pack(vault, i, b) for b in BUDGETS} for i in ids},
    }


def main(out: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "vault"
        vault.mkdir()
        build_vault(vault)
        data = snapshot(vault)
    if out.exists():
        # Only ever replace an earlier build, never a directory that holds other files.
        if any(out.iterdir()) and not (out / "data.json").is_file():
            raise SystemExit(f"refusing to overwrite {out}: not an earlier demo build")
        shutil.rmtree(out)
    shutil.copytree(ROOT / "app", out / "app", ignore=shutil.ignore_patterns("tests"))
    shutil.copy(ROOT / "demo" / "demo.js", out / "demo.js")
    (out / "data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    html = (out / "app" / "index.html").read_text(encoding="utf-8")
    html = (html.replace("{{TOKEN}}", "demo")
                .replace('href="/app/', 'href="app/').replace('src="/app/', 'src="app/')
                .replace('<script type="module"', '<script src="demo.js"></script>\n<script type="module"', 1)
                .replace('<div id="banner-down"',
                         '<div class="banner banner-demo">Demo on sample notes. Edits stay in this tab. '
                         '<a style="color:inherit;text-decoration:underline" href="https://github.com/shrestha-droid/second-mind">Run it locally</a></div>\n'
                         '<div id="banner-down"', 1))
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / "app" / "index.html").unlink()
    (out / ".nojekyll").write_text("")
    print(f"demo built: {out} ({len(data['notes'])} notes)")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "demo" / "site")
