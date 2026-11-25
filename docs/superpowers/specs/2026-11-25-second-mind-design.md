# Second Mind — design

Date: 2026-11-25 · Status: revised after builder check + Codex and Gemini review (see `docs/reviews/2026-11-25-second-opinions.md`)

## Intent

A visual, personal "second mind" that sits on the laptop and connects every AI Shrestha uses (Claude Code, Claude desktop/web, ChatGPT, Gemini, Codex) to one shared memory of Shrestha's projects, tasks, decisions and Claude setup.

Why: every AI starts cold. Shrestha re-explains context in each chat, long chats burn usage by being re-read every turn, and what one AI learns (Gemini reading a PDF, a Claude session making a decision) never reaches the others. The router skill decides *who* does the work; nothing gives them shared memory.

The core idea: **disk is unlimited and free, context is small and costly.** Everything lives on disk. Each AI gets only a small, budgeted slice ("context pack") for the task at hand, and can pull more on demand.

## Goals

1. Everything revolves around Shrestha: one tree rooted at `Shrestha`, e.g. `Shrestha › Work › Branch HQ › Internal work`. The path is the address and the breadcrumb.
2. Its own Obsidian: a free, local app to browse, write and link notes, with a graph view showing the tree plus cross-links between branches. Shrestha wants this built, not borrowed from Obsidian.
3. Context packs: pick a node, get ancestor summaries + the node + its most relevant links, cut at a token budget, with the estimated count shown. Zero model calls.
4. Local AI tools connect directly via one MCP server; web chats via a Chrome extension.
5. Claude setup is part of the mind: `~/.claude/skills/*`, `CLAUDE.md`, `AGENTS.md` and memory files appear as nodes (read-only in v1).
6. Capture a chat from claude.ai / ChatGPT / Gemini web into the tree, and condense it into a short note.

## Non-goals (v1)

- Auto-capturing every chat. Capture is click-only.
- Embeddings / semantic search. SQLite FTS5 full-text search first.
- Editing `~/.claude` files from the app (mounts are read-only in v1).
- A savings meter. Packs show an estimated token count only.
- Merging a new distilled chat into an existing note automatically (known gap; capture creates a new note, Shrestha reconciles).
- Remote MCP, cloud sync, phone access, multiple users.
- The second mind drafting new skills (later), personal skills profile.

## Anti-goals (failure even if it works)

- It costs more tokens than it saves. Browsing, linking, searching and building packs use **zero** model calls.
- The graph turns into an uncurated dump nobody can read.
- An AI silently rewrites notes, skills or config.
- The vault (chats, possibly pasted keys) leaks off the laptop or is readable by arbitrary websites.

## Constraints

- macOS laptop, Chrome. Local only.
- Small: no framework. Python stdlib (`http.server`, `sqlite3`) where possible; the MCP server may use the official `mcp` SDK in a venv.
- Vault stays plain markdown + `[[links]]` (Obsidian-compatible), so the notes never depend on the app.
- Build cheaply on usage: Opus plans, Sonnet builds logic, the graph page (visual) is built by Opus with a `ui-ux-pro-max` design pass and a browser check.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Obsidian + a Chrome clipper | Least work; graph for free. No own app, no packs, no MCP. |
| **B** | **Own local app: markdown vault + local server + graph page + MCP server + Chrome extension** | **Chosen by Shrestha.** The only one that reduces context per task. Cost: AI site layouts change, so capture needs maintenance. |
| C | A web page with manual paste | Quick, but sees nothing on the sites. |

## Decisions

### Repos and storage
- Code: `~/second-mind` (git; may get a private GitHub remote later for the portfolio).
- Vault: `~/second-mind/vault`, **its own git repo with no remote, ever**, and listed in the code repo's `.gitignore`. Git gives history and undo for notes.
- Never in any git repo: `vault/**/_raw/` (raw transcripts), `.token`, `vault/.index.db`. Raw transcripts are local files only; backups of the vault are Time Machine's job.
- Tree = folders: `vault/shrestha/work/branch-hq/internal-work/`. Each folder has `_index.md` (that level's summary, ≤100 words). `vault/inbox/` holds unfiled captures and anything AIs write back.

### Note format
```yaml
---
title: Internal work
type: area          # person | project | area | task | chat | note
summary: "≤100 words. What this is and where it stands."
links: ["[[shrestha/builds/jarvis]]"]
pinned: false       # pinned notes always go into packs first
source: {ai: gemini, url: "...", captured: 2026-11-25}   # captured chats only
updated: 2026-11-25
---
body (markdown, may contain [[links]])
```

### Seed tree (confirmed by Shrestha)
Shrestha at the centre, five life branches, projects under the branch they belong to:
```
shrestha
├── work                      Work
│   ├── branch-hq             Branch HQ
│   │   └── internal-work     Internal work
│   └── money                 Money (anything about money)
├── college                   College
├── social                    Social
│   └── youtube               YouTube
├── competitions              Competitions & hackathons
│   ├── branch-pay            Branch Pay (PayPal AI Hackathon)
│   └── gemma-hackathon       Gemma hackathon
└── builds                    Builds
    ├── jarvis                Jarvis
    ├── conclave              Conclave
    ├── claude-setup          Claude setup
    └── nest-5782             OWASP Nest
```
Summaries start empty; Shrestha fills them (or asks for a one-off draft from each project's README).

### Claude setup as nodes (mounts, read-only)
- `vault/mounts.json` lists each mount: tree home (`shrestha/builds/claude-setup/skills/router`), real file (`~/.claude/skills/router/SKILL.md`), a sidecar `summary`, and `serves` (project nodes it is cross-linked to, e.g. `office`, `social`, `outreach-send`, `inbox` → `shrestha/work/branch-hq`).
- Real files are never modified and get no frontmatter. Tree home is under `claude-setup`; "serves" shows as a cross-link, not a duplicate.
- Mounted: each skill's `SKILL.md` only, `~/.claude/CLAUDE.md`, `~/AGENTS.md`, and memory files under `~/.claude/projects/*/memory/*.md`.
- Paths are resolved and must stay inside an allowlist (`~/.claude/`, `~/AGENTS.md`); symlinks out of it are refused.
- The app shows a mounted file's text and an "Open in editor" button. In-app editing is v2, with atomic writes and a tested restore.

### Context pack (zero model calls)
1. Ancestor `_index.md` summaries, root → parent, each with its `updated` date. Summaries older than 30 days are marked stale in the pack and in the UI.
2. The node: full body if it fits, else its summary.
3. Linked notes (outgoing + backlinks), summaries only: `pinned` first, then direct links, then newest `updated`.
4. Stop at the budget (default 1,500; estimate = characters / 4, labelled "≈"). The pack ends with a list of what was left out.
5. Per-pack overrides: include / exclude a note.
6. Secret-looking strings (`sk-…`, `ghp_…`, `AKIA…`, `xox…`, private-key blocks) are redacted in packs, search results and MCP output.

### Search
SQLite FTS5 index at `vault/.index.db` (stdlib `sqlite3`), rebuilt from the markdown on start and updated on each write. Markdown stays the source of truth. `_raw/` is not indexed.

### Distilling a captured chat
- v1 default: manual. Paste or capture the chat; Shrestha writes or pastes the short note (decisions, facts, open questions).
- Explicit action, never automatic: "Distill in this chat" (extension inserts the fixed distill prompt; Shrestha sends it; the reply is shown as a preview before saving).
- Optional toggle: local server runs `claude -p --model haiku` on the raw transcript.

### Connecting AIs
- **MCP server** (`~/second-mind/mcp_server.py`, stdio, reads the vault directly). Tools: `search(q)`, `get_note(path)`, `get_pack(path, budget)`, `list_tree(path)`, `add_note(title, body)`.
  - Reads refuse `_raw/`, `.token`, `.index.db` and any path escaping the vault or mount allowlist.
  - `add_note` writes only to `vault/inbox/`, sanitises filename and frontmatter, max 20 KB. Inbox content is untrusted: never auto-included in packs until Shrestha files it.
  - Writes are atomic (temp file + rename).
  - Rollout: Claude Code first. Codex CLI, Gemini CLI and Claude desktop each added only after verifying that client's current MCP config. Registration uses the venv's absolute python path, e.g. `claude mcp add --scope user second-mind -- /Users/ShresthaPandey/second-mind/.venv/bin/python /Users/ShresthaPandey/second-mind/mcp_server.py`.
- **Chrome extension** (MV3; claude.ai, chatgpt.com, gemini.google.com): Capture, Insert pack, Distill-in-this-chat. Popup has a tree picker fed by the server, remembers the last node per chat URL. Capture shows a preview and turn count before saving; manual paste always works as fallback. Per-site DOM selectors in one file.
- No remote MCP / tunnel in v1.

### Local server and security
- Started by hand in v1 (`python3 server.py`); a launchd login item can come later. Extension shows "server not running" clearly and keeps the unsaved capture.
- Binds `127.0.0.1` only. Every request must have `Host: 127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding).
- Write endpoints require the token header (`~/second-mind/.token`, generated on first run, chmod 600) and an `Origin` of the extension or the server's own page; JSON content-type only. CORS allows only those origins.
- Tests cover: cross-origin POST rejected, wrong Host rejected, missing token rejected, path traversal rejected.

## Architecture

```
Claude Code / Codex CLI / Gemini CLI / Claude desktop ──stdio──▶ mcp_server.py ─┐
                                                                                ├──▶ vault/*.md (+ .index.db FTS5)  ── read-only mounts ──▶ ~/.claude/…
graph page ◀── local server (Python stdlib, 127.0.0.1, Host/Origin/token checks) ─┘
                 ▲
Chrome extension (Capture / Insert pack / Distill) ──POST + token──┘
```

### The app (own Obsidian), served at `http://127.0.0.1:<port>`
- **Sidebar:** the tree from `shrestha` down; create, rename, move, delete (delete goes to `vault/.trash/`, never hard-deleted).
- **Note view:** markdown editor with a rendered preview; frontmatter fields (title, type, summary, pinned) as a small form above the body; autosave with atomic writes.
- **Links:** `[[` autocomplete from note paths/titles; clicking a link opens the note; a link to a missing note offers to create it; backlinks panel under each note. Rename/move rewrites `[[links]]` that point at the old path (builder's call, marked).
- **Graph view:** radial tree with Shrestha at the centre; tree edges solid, cross-links dashed; Claude-setup nodes styled distinctly (once mounts land); stale nodes marked; click a node to open it; filter to the current branch.
- **Search:** search box (FTS5) and a quick switcher (Cmd+K) to jump to any note.
- **Pack panel:** **Copy pack** with ≈ token count and the include/exclude list.
- Inbox count badge.
- Not in v1: plugins, themes marketplace, canvas, daily notes, sync, mobile.

## Phases (Shrestha's own Obsidian first, brittle extension last)

1. Vault + seed tree + FTS5 search + pack builder + local server + **the app** (sidebar, editor, links, backlinks, graph, search, pack panel). **Usable on its own.**
2. MCP server for Claude Code, then read-only mounts of the Claude setup.
3. Extra MCP clients (Codex CLI, Gemini CLI, Claude desktop), each verified.
4. Chrome extension: Capture, Insert pack, Distill-in-this-chat.

Each phase is checked in use before the next.

## Left to the builder

- Graph library (force-graph vs Cytoscape), markdown renderer and editor component: all vendored locally, no CDN, no build step if avoidable.
- MCP: official Python `mcp` SDK in `.venv` (preferred) unless it fights a client.
- API shapes, FTS ranking details, port number.
- Visual design of the app (Opus + `ui-ux-pro-max`, Gemini design direction, checked in the browser).

## After it ships

Standing rules apply: portfolio entry (local app, so a screenshot of the local page; no live deploy), CV if strong, LinkedIn draft for approval. Repo private, so no repo link in the post.
