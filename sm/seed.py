"""Starting note tree and the vault's own git repo."""
import subprocess
from pathlib import Path

from sm.ops import _ensure_dirs
from sm.vault import write_note

SEED = [
    ("shrestha", "Shrestha", "person"),
    ("shrestha/work", "Work", "area"),
    ("shrestha/college", "College", "area"),
    ("shrestha/social", "Social", "area"),
    ("shrestha/competitions", "Competitions & hackathons", "area"),
    ("shrestha/builds", "Builds", "area"),
    ("shrestha/work/branch-hq", "Branch HQ", "project"),
    ("shrestha/work/branch-hq/internal-work", "Internal work", "area"),
    ("shrestha/work/money", "Money", "area"),
    ("shrestha/social/youtube", "YouTube", "project"),
    ("shrestha/competitions/branch-pay", "Branch Pay", "project"),
    ("shrestha/competitions/gemma-hackathon", "Gemma hackathon", "project"),
    ("shrestha/builds/jarvis", "Jarvis", "project"),
    ("shrestha/builds/conclave", "Conclave", "project"),
    ("shrestha/builds/claude-setup", "Claude setup", "area"),
    ("shrestha/builds/nest-5782", "OWASP Nest", "project"),
    ("inbox", "Inbox", "area"),
]

IGNORE = ["_raw/", ".index.db", ".index.db-*", ".trash/"]


def seed(vault: Path) -> list[str]:
    """Create missing seed notes as folder notes; never overwrite. Returns ids created."""
    created = []
    for id, title, type in SEED:
        if (vault / id / "_index.md").exists() or (vault / f"{id}.md").exists():
            continue
        _ensure_dirs(vault, id)  # promotes a pre-existing leaf ancestor to a folder
        meta = {"title": title, "type": type, "summary": "", "links": [], "pinned": False}
        write_note(vault, id, meta, "", None)
        created.append(id)
    return created


def init_repo(vault: Path) -> None:
    """git init if needed and ensure .gitignore lines. Never adds a remote."""
    vault.mkdir(parents=True, exist_ok=True)
    if not (vault / ".git").exists():
        subprocess.run(["git", "init", "-q"], cwd=vault, check=False)
    gi = vault / ".gitignore"
    have = gi.read_text().splitlines() if gi.exists() else []
    missing = [l for l in IGNORE if l not in have]
    if missing:
        gi.write_text("\n".join(have + missing) + "\n")
