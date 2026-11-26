# Engram MCP server — design (approved 2026-11-26)

## Why
The vault is only worth keeping if it stays full. Shrestha uses several AIs; each should read Engram before answering about them and record what it learns, so the vault fills itself.

## Goals
- One local MCP server (stdio) that any MCP client can launch.
- Claude edits notes directly. Every other AI only proposes; Claude or Shrestha reviews.
- Every AI change is its own git commit in the vault, so it can be seen and undone.

## Non-goals
- No network transport, no auth server, no remote. ChatGPT's app (no local stdio MCP) is out.
- No delete or move tools for AIs (reject only trashes an inbox proposal, recoverable from `.trash/`).

## Anti-goals
- An AI silently overwriting Shrestha's edit. An AI writing a secret into the vault, or wiping one it saw as `[REDACTED]`.

## Approaches
1. **Stdio MCP server reusing `sm/` (picked).** Stdlib only, same code paths as the app, nothing to run in the background.
2. HTTP MCP endpoint inside `server.py`. Needs the app running and a token per client; more moving parts.
3. Files-only convention (AIs write markdown into a folder). No conflict check, no tiers, no search.

## Design
- `python3 ~/second-mind/mcp_server.py --agent <name>`; vault from `SM_VAULT` or `~/second-mind/vault`.
- Tier comes from the `--agent` flag in each client's config, never from the client's self-reported `clientInfo`. `claude` = editor, anything else = contributor.
- Tools: `search`, `read`, `tree`, `pack`, `propose` for everyone; `create`, `edit`, `review_inbox`, `accept`, `reject` for Claude only. `tools/list` shows only the caller's tools and `tools/call` checks again.
- `edit` replace needs the `version` from `read` (mtime_ns); a changed file is refused. `append` needs none. A note holding a secret can only be appended to.
- Writes containing a secret pattern are refused. All output goes through `redact()`.
- Proposals land in `inbox/ai/<agent>/<slug>` with `proposed_by` and an optional `about` (suggested parent). `accept` moves one to its parent.
- Before each AI write, pending user changes are committed as `autosave`; the AI change is then committed alone as `<agent>: <action> <id>` with author `<agent> via Engram`.
- Server `instructions` tell the AI to check Engram before answering about Shrestha and to record durable facts.

## Left to the builder
Tool argument names, output formatting, per-client config syntax.
