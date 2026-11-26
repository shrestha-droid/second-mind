# Second Mind

A local, Obsidian-like notes app. Notes are plain markdown files in a vault on disk, organised as a tree of folder notes, linked to each other, searchable (SQLite FTS5), and shown in a 3D graph view. The server is Python stdlib only; the app is vanilla JS in `app/`.

## Run

```
python3 server.py
```

Then open http://127.0.0.1:7337.

- The server binds to `127.0.0.1` only. Nothing leaves the laptop.
- The vault is `~/second-mind/vault` (override with `SM_VAULT`). It is created on first run, with its own git repo (no remote is ever added) and a starting note tree. Existing notes are never overwritten.
- The port is 7337 (override with `SM_PORT`).
- An API token is generated into `~/second-mind/.token` (mode 600) and injected into the page. This repo git-ignores `vault/` and `.token`; the vault repo git-ignores `_raw/`, `.index.db` and `.trash/`.

## Tests

```
python3 -m unittest discover -s tests -v
node --test app/tests/
```
