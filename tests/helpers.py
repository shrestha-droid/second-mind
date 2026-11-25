from pathlib import Path


def make_vault(tmp: Path, notes: dict[str, str]) -> Path:
    """Write each vault-relative path -> text under tmp; return tmp."""
    for rel, text in notes.items():
        p = tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return tmp
