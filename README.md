# Second Mind

A local, Obsidian-like notes app. Notes are plain markdown files in a vault on disk, organised as a tree of folder notes, linked to each other, searchable (SQLite FTS5), and shown in a 3D graph view. The server is Python stdlib only; the app is vanilla JS in `app/`.

## Run

```
python3 server.py
```

Then open http://127.0.0.1:7337.

Or build the macOS app once with `scripts/make_app.sh` and open **Engram** from Spotlight (⌘Space). It starts the server if needed and opens the app in its own Chrome window. Server log: `~/Library/Logs/Engram.log`.

- The server binds to `127.0.0.1` only. Nothing leaves the laptop.
- The vault is `~/second-mind/vault` (override with `SM_VAULT`). It is created on first run, with its own git repo (no remote is ever added) and a starting note tree. Existing notes are never overwritten.
- The port is 7337 (override with `SM_PORT`).
- An API token is generated into `~/second-mind/.token` (mode 600) and injected into the page. This repo git-ignores `vault/` and `.token`; the vault repo git-ignores `_raw/`, `.index.db` and `.trash/`.

## AI access (MCP)

`mcp_server.py` is a local stdio MCP server, so the AI tools you use can read the vault and write to it. It uses only the Python stdlib and the same code as the app. Nothing has to be running in the background.

- **Claude** (`--agent claude`) is the editor. It can search, read, create, edit, and review the inbox, and it can accept or reject proposals.
- **Every other agent** is a contributor. It can search, read and pack notes, and can only `propose`. Proposals land in `inbox/ai/<agent>/`, where you or Claude review them.
- The tier comes from the `--agent` flag in each client's config, never from what the client says about itself.
- A replace needs the `version` returned by `read`. If the note changed since that read, the replace is refused. A note that holds a secret can only be appended to. Input that contains a secret is refused, and all output is redacted.
- Before each AI write, your pending edits are committed as `autosave`. The AI's change is then committed alone as `<agent>: <action> <id>`, with author `<agent> via Engram`. To see or undo an AI change, use `git log` or `git revert` in the vault.

Register it once per client (use absolute paths):

```
claude mcp add engram --scope user -- /opt/homebrew/bin/python3 ~/second-mind/mcp_server.py --agent claude
codex mcp add engram -- /opt/homebrew/bin/python3 ~/second-mind/mcp_server.py --agent codex
gemini mcp add -s user engram /opt/homebrew/bin/python3 ~/second-mind/mcp_server.py --agent gemini
agy mcp add engram /opt/homebrew/bin/python3 -- ~/second-mind/mcp_server.py --agent antigravity
```

For Claude Desktop, add this under `mcpServers` in `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
"engram": {"command": "/opt/homebrew/bin/python3", "args": ["/Users/<you>/second-mind/mcp_server.py", "--agent", "claude"]}
```

## Tests

```
python3 -m unittest discover -s tests -v
node --test app/tests/
```
