# Second Mind Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, local, self-built Obsidian-style app for Shrestha's vault: notes in a `shrestha › …` tree, editor with `[[links]]`, backlinks, a radial graph, full-text search and copyable context packs.

**Architecture:** A Python stdlib package `sm/` owns the vault (markdown files are the source of truth), links, an SQLite FTS5 index and the pack builder. `server.py` (stdlib `http.server`, 127.0.0.1 only) exposes a small JSON API and serves a vanilla-JS app from `app/`. Pure frontend logic lives in `app/lib.js` and is tested with `node --test`.

**Tech Stack:** Python 3.15 stdlib (`http.server`, `sqlite3` FTS5, `unittest`), vanilla ES modules, hand-rolled SVG graph, vendored `marked` for markdown, Node 26 for JS tests only.

**Spec:** `docs/superpowers/specs/2026-11-25-second-mind-design.md`

## Global Constraints

- Phase 1 uses Python stdlib only: no pip, no venv. JS has no npm dependencies; the only vendored files are `app/vendor/marked.esm.js` and the woff2 fonts in `app/vendor/fonts/` (IBM Plex Sans, IBM Plex Mono, Source Serif 4; OFL). No CDN, no build step.
- Zero model calls anywhere in phase 1.
- Server binds `127.0.0.1` only, port `7337` (plan's call). Tests use port 0.
- Vault: `~/second-mind/vault`, its own git repo, **no remote, ever**; already ignored by the code repo (`vault/` in `.gitignore`). `.token` never committed.
- Note ids: `/`-joined lowercase slug segments matching `^(shrestha|inbox)(/[a-z0-9][a-z0-9-]{0,63})*$`. A folder id is backed by `<id>/_index.md`; a leaf id by `<id>.md`. `_raw`, `.trash`, dotfiles are never ids.
- Pack budget default `1500`; tokens = `ceil(len(text) / 4)`, always shown with "≈".
- Stale = `updated` missing or older than 30 days.
- Inbox notes never enter a pack unless explicitly included.
- Breadcrumb separator: `›`. Product name: "Second Mind".
- Writes are atomic: temp file in the same folder + `os.replace`.
- Visual work (Tasks 9-10) is built by Opus after loading `ui-ux-pro-max`, from `docs/design/app-direction.md` ("Orrery": tokens, type, layout, graph, motion; already written), and checked in the browser in dark and light. Where that file is more specific than a task's Behaviour list, the file wins. The bar: as aesthetic as possible, exact, calm; no generic SaaS look.
- Test command (Python): `cd ~/second-mind && python3 -m unittest discover -s tests -v`. JS: `cd ~/second-mind && node --test app/tests/`.

## Review Focus

1. **A note edited outside the app** (Claude, Obsidian, git checkout) while it is open: the app must not silently overwrite it. Pinned by `test_write_conflict` (Task 3) and `test_put_conflict_409` (Task 7).
2. **A pasted/captured note containing `<script>`, raw HTML or `javascript:` links**: renders inert. Pinned by `safeHref` and `renderMarkdown escapes html` tests (Task 8).
3. **Search text with punctuation or FTS syntax** (`c++`, `"`, `AND`, `-x`, `*`): no error, sensible results. Pinned by `test_search_weird_input` (Task 4).
4. **Renaming/moving a note others link to**, or moving a folder into its own child: links keep resolving; the bad move is refused. Pinned by `test_move_rewrites_links` and `test_move_into_self_refused` (Task 3).
5. **Hand-edited frontmatter**: missing, malformed, unknown keys, CRLF line endings: note still opens; unknown keys survive a save. Pinned by `test_parse_tolerant` (Task 1).

---

## File map

```
sm/__init__.py      empty
sm/vault.py         frontmatter, ids/paths, read/write, tree        (Task 1)
sm/links.py         extract/resolve links, backlinks, graph payload (Task 2)
sm/ops.py           create, move (+link rewrite), trash, snapshot   (Task 3)
sm/index.py         FTS5 search index                                (Task 4)
sm/redact.py        secret redaction                                 (Task 5)
sm/pack.py          context pack builder                             (Task 5)
sm/seed.py          seed tree + vault git init                       (Task 6)
server.py           HTTP API, security, static files                 (Task 7)
app/index.html, app/app.css, app/app.js, app/graph.js, app/lib.js, app/vendor/marked.esm.js
app/tests/lib.test.mjs
tests/test_vault.py, test_links.py, test_ops.py, test_index.py, test_pack.py, test_seed.py, test_server.py
tests/helpers.py    make_vault(tmpdir, notes: dict[str,str]) -> Path  (Task 1)
.claude/launch.json preview config                                   (Task 9)
README.md           how to run                                       (Task 11)
```

---

### Task 1: Vault core (frontmatter, ids, read/write, tree)

**Files:** Create `sm/__init__.py`, `sm/vault.py`, `tests/helpers.py`, `tests/test_vault.py`

**Interfaces — Produces:**
- `@dataclass Note: id: str; meta: dict; body: str; mtime_ns: int`
- `class Conflict(Exception): current: Note`
- `parse_note(text: str) -> tuple[dict, str]`
- `dump_note(meta: dict, body: str) -> str`
- `valid_id(id: str) -> bool`
- `note_path(vault: Path, id: str) -> Path` (ValueError on invalid id; folder → `_index.md`, else `<id>.md`; result must resolve inside `vault`)
- `read_note(vault: Path, id: str) -> Note` (FileNotFoundError)
- `write_note(vault: Path, id: str, meta: dict, body: str, base_mtime_ns: int | None) -> Note` (sets `meta["updated"]` to today ISO; raises `Conflict` if file exists and its `mtime_ns != base_mtime_ns` when base given)
- `all_ids(vault: Path) -> list[str]` (sorted; skips dot-dirs, `_raw`, non-`.md`)
- `is_stale(meta: dict, today: date) -> bool`
- `tree(vault: Path, root: str = "shrestha", today: date | None = None) -> dict` → `{"id","title","type","stale","children":[...]}`, children sorted folders-first then title
- `slugify(title: str) -> str` (lowercase, non-alnum → `-`, collapsed, trimmed, max 64; empty → `"untitled"`)
- `tests/helpers.make_vault(tmp: Path, notes: dict[str, str]) -> Path`: keys are vault-relative file paths, values file text.

**Frontmatter format (plan's call: a YAML subset we both read and write, still valid YAML for Obsidian):** block between first-line `---` and next `---`. Each line `key: value`. Value starting with `"` or `[` → `json.loads`; `true`/`false` → bool; else stripped bare string. Unparseable lines are kept under `meta["_raw_lines"]` and written back verbatim. `dump_note` writes strings with `json.dumps(ensure_ascii=False)`, bools lowercase, lists as JSON; key order preserved. The spec's `source: {...}` becomes three flat keys `source_ai`, `source_url`, `captured`.

- [ ] **Step 1: Write failing tests** in `tests/test_vault.py`:
  - `test_roundtrip`: `parse_note(dump_note({"title":"Internal work","type":"area","links":["[[shrestha/builds/jarvis]]"],"pinned":False}, "Body"))` returns the same dict and `"Body"`.
  - `test_parse_tolerant`: no frontmatter → `({}, text)`; CRLF text parses same as LF; line `weird: {a: 1` lands in `_raw_lines` and survives `dump_note`→`parse_note`; unknown key `colour: "red"` is preserved.
  - `test_ids`: `valid_id("shrestha/branch-hq")` True; `"shrestha/../x"`, `"shrestha/_raw"`, `"shrestha/.trash"`, `"other"`, `"shrestha/Bad"` False; `note_path` raises ValueError for them.
  - `test_note_path_folder_vs_leaf`: folder `shrestha/jarvis/` → `.../jarvis/_index.md`; leaf → `.../idea.md`.
  - `test_write_conflict`: write, then touch file with a different mtime, `write_note(..., base_mtime_ns=old)` raises `Conflict` whose `.current.body` is the on-disk body.
  - `test_tree`: vault with `shrestha/_index.md`, `shrestha/branch-hq/_index.md`, `shrestha/branch-hq/internal-work/_index.md`, `shrestha/note.md`, `shrestha/_raw/x.md` → nested ids exactly those four (no `_raw`); stale flag true for `updated: "2026-01-01"` with `today=date(2026,11,25)`.
- [ ] **Step 2:** Run `python3 -m unittest tests.test_vault -v` → fails (ImportError).
- [ ] **Step 3:** Implement `sm/vault.py` and `tests/helpers.py` to the interfaces above.
- [ ] **Step 4:** Run `python3 -m unittest tests.test_vault -v` → all pass.
- [ ] **Step 5:** `git add sm tests && git commit -m "feat: vault core (frontmatter, ids, tree)"`

### Task 2: Links, backlinks, graph payload

**Files:** Create `sm/links.py`, `tests/test_links.py`

**Interfaces — Consumes:** Task 1 `read_note`, `all_ids`, `is_stale`. **Produces:**
- `extract_links(meta: dict, body: str) -> list[str]` — targets from body `[[target]]`, `[[target|alias]]`, `[[target#heading]]` plus `meta["links"]` entries; deduped, order kept; text inside backtick code ignored.
- `resolve(target: str, ids: set[str]) -> str | None` — exact id; else `shrestha/<target>`; else unique id whose last segment equals `slugify(target)`; else None.
- `link_index(vault: Path) -> dict` → `{"out": {id: [ids]}, "back": {id: [ids]}, "missing": {id: [targets]}}`
- `graph_payload(vault: Path, today: date | None = None) -> dict` → `{"nodes":[{"id","title","type","stale","parent","pinned"}], "edges":[{"source","target","kind": "tree"|"link"}]}`; inbox notes included with `parent: None`.

- [ ] **Step 1: Failing tests:** `test_extract` (alias, heading, frontmatter links, code span ignored); `test_resolve` (exact, `jarvis` → `shrestha/jarvis`, unique basename, ambiguous basename → None); `test_backlinks` (A links B ⇒ `back["B"] == ["A"]`); `test_missing` (link to `nowhere` listed in `missing`); `test_graph_payload` (tree edges parent→child, link edges, no duplicate link edge when A links B twice).
- [ ] **Step 2:** Run `python3 -m unittest tests.test_links -v` → FAIL.
- [ ] **Step 3:** Implement `sm/links.py`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** `git commit -m "feat: links, backlinks, graph payload"`

### Task 3: Note operations (create, move with link rewrite, trash, snapshot)

**Files:** Create `sm/ops.py`, `tests/test_ops.py`

**Interfaces — Consumes:** Tasks 1-2. **Produces:**
- `create_note(vault: Path, parent_id: str, title: str, type: str, folder: bool) -> Note` — id `parent_id/slugify(title)`; FileExistsError on clash; if parent is a leaf file it is promoted to `parent/_index.md` first; frontmatter `{title, type, summary: "", links: [], pinned: false}`.
- `move_note(vault: Path, id: str, new_id: str) -> int` — moves file or folder; returns count of notes whose links were rewritten. Rewrite rule: every `[[t]]`/`[[t|a]]`/frontmatter link whose `resolve` hits the moved id (or an id under the moved folder) is rewritten to the new full id, alias kept. Refuses (ValueError): moving `shrestha` or `inbox`, invalid `new_id`, `new_id` existing, `new_id` inside `id`.
- `trash_note(vault: Path, id: str) -> Path` — moves file/folder to `vault/.trash/<YYYYmmdd-HHMMSS>-<id with / → __>`; refuses roots.
- `snapshot(vault: Path, min_interval_s: int = 300, now: float | None = None) -> bool` — `git add -A && git commit -m "autosave"` in the vault if the last snapshot (tracked in `vault/.git/sm-last-snapshot`) is older than `min_interval_s`; returns whether it committed. No-op if nothing changed. `# ponytail: time-gated snapshot, per-save commits if history needs finer grain`.

- [ ] **Step 1: Failing tests:** `test_create_leaf_and_folder`; `test_create_under_leaf_promotes`; `test_create_clash`; `test_move_rewrites_links` (C links `[[shrestha/a/b|Bee]]` and `[[b]]`; move `shrestha/a` → `shrestha/x`; C now has `[[shrestha/x/b|Bee]]` and `[[shrestha/x/b]]`; return value 1); `test_move_into_self_refused`; `test_trash` (file gone from `all_ids`, present under `.trash`); `test_snapshot_gated` (git-init temp vault; two writes with `now` 10s apart → one commit; third after 301s → second commit).
- [ ] **Step 2:** Run `python3 -m unittest tests.test_ops -v` → FAIL.
- [ ] **Step 3:** Implement `sm/ops.py` (git via `subprocess.run([...], cwd=vault, check=False)`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** `git commit -m "feat: create, move with link rewrite, trash, snapshot"`

### Task 4: FTS5 search index

**Files:** Create `sm/index.py`, `tests/test_index.py`

**Interfaces — Consumes:** Task 1. **Produces:** `class Index(vault: Path)` with `rebuild() -> int` (notes indexed), `update(id: str) -> None`, `remove(id: str) -> None` (also removes ids under a folder prefix), `search(q: str, limit: int = 20) -> list[dict]` → `[{"id","title","snippet"}]`. DB at `vault/.index.db`; table `notes USING fts5(id UNINDEXED, title, summary, body, tokenize='unicode61')`; title matches weighted higher via `bm25(notes, 0, 10, 5, 1)`.

Query rule: split `q` on whitespace, drop empty, wrap each term in double quotes with internal `"` doubled, append `*` to the last term (prefix search), join with spaces. Empty query → `[]`.

- [ ] **Step 1: Failing tests:** `test_rebuild_and_search` (title hit ranks above body hit); `test_update_and_remove`; `test_prefix` (`"jar"` finds Jarvis); `test_search_weird_input` (`c++`, `"`, `AND`, `-x`, `*`, `(` each return a list, no exception); `test_raw_not_indexed`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** `git commit -m "feat: FTS5 search index"`

### Task 5: Redaction and context pack

**Files:** Create `sm/redact.py`, `sm/pack.py`, `tests/test_pack.py`

**Interfaces — Consumes:** Tasks 1-2. **Produces:**
- `redact(text: str) -> str` replaces with `[REDACTED]`: `sk-[A-Za-z0-9_-]{20,}`, `ghp_[A-Za-z0-9]{36}`, `github_pat_[A-Za-z0-9_]{20,}`, `AKIA[0-9A-Z]{16}`, `xox[abprs]-[A-Za-z0-9-]{10,}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`.
- `estimate_tokens(text: str) -> int` = `ceil(len(text)/4)`
- `build_pack(vault: Path, id: str, budget: int = 1500, include: list[str] = (), exclude: list[str] = (), today: date | None = None) -> dict` → `{"text","tokens","included":[ids],"omitted":[ids]}`

Algorithm (spec §Context pack): always include ancestor summaries root→parent (with `updated`, `STALE` marker) and the node's title+summary even if over budget; then the node's full body if it still fits, else note "(body omitted)"; then candidates = `include` ids first, then `pinned`, then direct out/back links ordered by newest `updated`; skip `exclude` and any `inbox/…` id not in `include`; add each candidate's `- [[id]] Title: summary` line while it fits; everything skipped for budget goes in `omitted` and a final `## Left out` list. Whole text passes through `redact` last.

Text layout:
```
# Context pack: Shrestha › Work › Branch HQ › Internal work (≈N tokens)
## Path
- Shrestha (updated 2026-11-25): …
## Note: Internal work
…
## Linked
- [[shrestha/builds/jarvis]] Jarvis: …
## Left out
- [[…]] …
```

- [ ] **Step 1: Failing tests:** `test_redact` (each pattern; normal text untouched); `test_pack_order` (path then note then pinned link before newer unpinned link); `test_pack_budget` (budget 200 → `tokens <= 200` unless the minimum alone exceeds it; omitted listed); `test_pack_minimum_over_budget` (budget 10 still has path + node summary); `test_pack_inbox_excluded` (backlink from `inbox/x` absent unless in `include`); `test_pack_exclude`; `test_pack_redacts`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** `git commit -m "feat: redaction and context packs"`

### Task 6: Seed tree and vault repo

**Files:** Create `sm/seed.py`, `tests/test_seed.py`

**Interfaces — Consumes:** Task 1 `write_note`. **Produces:** `SEED: list[tuple[str, str, str]]` (id, title, type) and `seed(vault: Path) -> list[str]` (ids created; never overwrites existing files; idempotent), `init_repo(vault: Path) -> None` (`git init` if no `.git`; writes vault `.gitignore` with `_raw/`, `.index.db`, `.index.db-*`, `.trash/`; never adds a remote).

SEED (confirmed by Shrestha; spec §Seed tree): `shrestha` "Shrestha" person; branches (type `area`): `shrestha/work` "Work", `shrestha/college` "College", `shrestha/social` "Social", `shrestha/competitions` "Competitions & hackathons", `shrestha/builds` "Builds"; under them (type `project` unless noted): `shrestha/work/branch-hq` "Branch HQ", `shrestha/work/branch-hq/internal-work` "Internal work" (area), `shrestha/work/money` "Money" (area), `shrestha/social/youtube` "YouTube", `shrestha/competitions/branch-pay` "Branch Pay", `shrestha/competitions/gemma-hackathon` "Gemma hackathon", `shrestha/builds/jarvis` "Jarvis", `shrestha/builds/conclave` "Conclave", `shrestha/builds/claude-setup` "Claude setup" (area), `shrestha/builds/nest-5782` "OWASP Nest"; plus folder `inbox` with `_index.md` "Inbox". All folders, summaries empty. `test_seed_creates_tree` asserts exactly these 16 ids.

- [ ] **Step 1: Failing tests:** `test_seed_creates_tree` (all ids in `all_ids`); `test_seed_idempotent` (second run returns `[]`, edited summary untouched); `test_init_repo` (`.git` exists, `git remote` output empty, `.gitignore` has `_raw/`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "feat: seed tree and vault repo"`

### Task 7: Local server and API

**Files:** Create `server.py`, `tests/test_server.py`

**Interfaces — Consumes:** Tasks 1-6. **Produces:** `make_server(vault: Path, app_dir: Path, token: str, port: int = 7337) -> ThreadingHTTPServer`; `main()` (creates `.token` via `secrets.token_urlsafe(32)` with mode 600 if missing; `init_repo`; `seed`; `Index.rebuild()`; serves; prints `Second Mind on http://127.0.0.1:7337`).

Routes (JSON in/out):

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/` | — | `app/index.html` with `{{TOKEN}}` replaced |
| GET | `/app/<file>` | — | static from `app_dir` only |
| GET | `/api/tree` | — | `{"root": tree(), "inbox": tree(root="inbox")}` |
| GET | `/api/graph` | — | `graph_payload()` |
| GET | `/api/note` | `?id=` | `{id, meta, body, mtime_ns, backlinks:[{id,title}], outlinks:[{id,title}], missing:[targets]}` |
| PUT | `/api/note` | `{id, meta, body, base_mtime_ns}` | note JSON; 409 `{current: note}` on conflict |
| POST | `/api/note` | `{parent, title, type, folder}` | note JSON, 201 |
| POST | `/api/move` | `{id, new_id}` | `{id: new_id, rewritten: n}` |
| POST | `/api/trash` | `{id}` | `{ok: true}` |
| GET | `/api/search` | `?q=` | search results |
| GET | `/api/pack` | `?id=&budget=&include=a,b&exclude=c` | pack dict |

Security, every request: `Host` must equal `127.0.0.1:<port>` or `localhost:<port>` else 403. Write methods (PUT/POST): header `X-SM-Token` equals token (`hmac.compare_digest`) else 403; `Origin`, when present, must be `http://127.0.0.1:<port>` or `http://localhost:<port>` else 403; `Content-Type` must start `application/json` else 415; body > 1 MB → 413. No CORS headers in phase 1. Invalid id → 400; missing → 404. Every write: under one `threading.Lock` (`# ponytail: global write lock, fine for one user`), then index sync (create/put: `Index.update(id)`; move: `Index.remove(old)` + `Index.update` for each moved and each rewritten id; trash: `Index.remove(id)`), then `snapshot`. API responses run `redact` only on pack and search output (notes are shown as written).

- [ ] **Step 1: Failing tests** (server on port 0 in a thread, `http.client`): `test_get_tree`; `test_note_crud` (create → read → put → move → trash); `test_put_conflict_409`; `test_wrong_host_403`; `test_post_without_token_403`; `test_post_evil_origin_403`; `test_text_plain_415`; `test_big_body_413`; `test_bad_id_400` (`?id=../../etc/passwd`); `test_static_traversal_404` (`/app/../server.py`); `test_index_injects_token`; `test_search_and_pack`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `server.py`. **Step 4:** PASS, and full suite `python3 -m unittest discover -s tests -v` PASS.
- [ ] **Step 5:** `git commit -m "feat: local server, JSON API, security checks"`

### Task 8: Frontend logic (`app/lib.js`) and vendored markdown

**Files:** Create `app/lib.js`, `app/tests/lib.test.mjs`, `app/vendor/marked.esm.js`, `app/vendor/fonts/*.woff2`, `app/vendor/VERSIONS.md`

**Interfaces — Produces (ES module exports):**
- `wikilinkQuery(text: string, cursor: number) -> {start: number, query: string} | null` — open `[[` before cursor with no `]]` or newline between.
- `rankMatches(query: string, nodes: {id,title}[], limit = 8) -> nodes` — case-insensitive; title prefix > title substring > id substring; empty query → first `limit` by title.
- `safeHref(href: string) -> string | null` — allows `http:`, `https:`, `mailto:`, `#…`, and relative paths; everything else (incl. `javascript:`, `data:`, `vbscript:`, whitespace/case tricks) → null.
- `renderMarkdown(md: string, resolve: (target) => string | null) -> string` — uses vendored `marked` with: raw HTML escaped (never passed through), links through `safeHref` (null → plain text), images same rule, `[[t|a]]` → `<a class="wikilink" href="#/n/<id>">a</a>` or `<a class="wikilink missing" data-target="t">a</a>`.
- `breadcrumb(id: string, titleOf: (id) => string) -> {id,title}[]`
- `orreryLayout(nodes: {id,parent,links}[]) -> Map<string,{x,y,depth,branch}>` — deterministic, per `app-direction.md` §Graph: `shrestha` at (0,0); branches on r=150 at bearings Work −54°, College 18°, Social 90°, Competitions 162°, Builds 234° (0° = +x, clockwise, SVG coords); depth-2 nodes sorted by id, spread evenly across a 56° sector centred on the parent's bearing, radius 255–330 (alternating when > 4); depth 3+ 38–58 px beyond the parent along its bearing; `inbox/*` evenly on r=72 between −120° and −60°. `branch` = second id segment, `"inbox"` or `null` for the root.

- [ ] **Step 1: Ask Shrestha** before downloading (one ask): `marked` latest release `lib/marked.esm.js` from npm/unpkg (~40 KB), and the woff2 files for IBM Plex Sans, IBM Plex Mono and Source Serif 4 from their official GitHub releases (~300 KB total). On yes, save to `app/vendor/`, record version + URL + sha256 of each in `VERSIONS.md`. On no, the app uses the system fallbacks in `app-direction.md`.
- [ ] **Step 2: Failing tests** in `app/tests/lib.test.mjs` (`node:test`, `node:assert`): `wikilinkQuery` (`"see [[jar"` cursor end → `{start:4, query:"jar"}`; closed link → null; across newline → null); `rankMatches` order; `safeHref` (`"JaVaScRiPt:alert(1)"`, `" javascript:x"`, `"data:text/html,x"` → null; `"https://a.b"`, `"#/n/x"` kept); `renderMarkdown escapes html` (`<script>x</script>` and `<img src=x onerror=y>` appear escaped, no `<script` tag in output); `renderMarkdown wikilinks` (resolved and missing); `orreryLayout` (root at 0,0; `shrestha/work` at distance 150 and angle −54°; every `shrestha/builds/*` child within ±28° of 234° and at radius 255–330; an `inbox/x` node at r=72 between −120° and −60°; calling twice on shuffled input gives identical maps).
- [ ] **Step 3:** Run `node --test app/tests/` → FAIL. **Step 4:** Implement `app/lib.js`. **Step 5:** Run → PASS.
- [ ] **Step 6:** `git commit -m "feat: frontend logic and vendored marked"`

### Task 9: The app shell — sidebar, editor, links, backlinks, search, pack panel

**Files:** Create `app/index.html`, `app/app.css`, `app/app.js`, `.claude/launch.json`. Read: `docs/design/app-direction.md`

**Interfaces — Consumes:** Task 7 API, Task 8 `lib.js`. **Produces:** `app.js` exports `openNote(id)` and `showView("note" | "graph" | "split")` used by Task 10; hash routes `#/n/<id>`, `#/graph`, `#/split/<id>`.

Behaviour (spec §The app):
- Layout: left sidebar (tree from `/api/tree`, collapsible, inbox section with count badge, "+" to create child note or folder, right-click/menu: rename, move, trash), centre note pane, right panel (backlinks, outlinks, missing links, pack).
- Note pane: breadcrumb (`›`, clickable); frontmatter form (title, type select of `person|project|area|task|chat|note`, summary textarea with live word count warning above 100, pinned toggle); body textarea with the rendered preview beside it (via `renderMarkdown`; ⌘E toggles reading mode); autosave 800 ms after last keystroke via PUT with `base_mtime_ns`; on 409 show banner "Changed on disk" with **Reload** and **Keep mine** (Keep mine re-PUTs with the new `mtime_ns`).
- `[[` autocomplete in the textarea from `/api/graph` nodes via `wikilinkQuery` + `rankMatches`; Enter/Tab inserts `[[id]]`. Clicking a missing link offers "Create note".
- Search box (debounced 200 ms, `/api/search`); quick switcher on Cmd+K (`rankMatches` over graph nodes).
- Pack panel: budget presets 1.5K/3K/6K/12K (default 1500) plus fill bar, include/exclude checkboxes, **Copy pack** copies `text` to clipboard, shows `≈N tokens` and omitted list.
- All writes send `X-SM-Token` from `<meta name="sm-token" content="{{TOKEN}}">`.
- Keyboard reachable; visible focus; works at 1280 px and 1920 px wide.

- [ ] **Step 1:** Read `docs/design/app-direction.md` (done: Gemini 4 Neon direction, contrast verified).
- [ ] **Step 2:** Load `ui-ux-pro-max`; build `index.html`, `app.css`, `app.js` from the direction file (Opus): tokens as CSS variables, both themes, top bar, sidebar, note pane, inspector, Cmd+K, motion and reduced-motion.
- [ ] **Step 3:** Add `.claude/launch.json` config `second-mind` → `python3 server.py`, port 7337; `preview_start`.
- [ ] **Step 4: Browser check** (built-in browser): create a note under Branch HQ, type `[[jar` and pick Jarvis, see backlink on Jarvis, rename the note and confirm the link still opens, edit the file on disk from the shell while open and see the conflict banner, Cmd+K to a note, search "internal", copy a pack and see ≈ tokens, preview a note containing `<script>alert(1)</script>` and confirm nothing runs, switch dark/light and screenshot both, emulate reduced motion. Zero console errors.
- [ ] **Step 5:** `git commit -m "feat: app shell, editor, links, search, packs"`

### Task 10: Graph view

**Files:** Create `app/graph.js`; Modify `app/app.js` (route `#/graph`, toolbar button), `app/app.css`

**Interfaces — Consumes:** `/api/graph`, `lib.orreryLayout`, `app.openNote`. **Produces:** `renderGraph(container: HTMLElement, payload, {focusId?: string, onOpen: (id) => void}) -> void`.

Behaviour: exactly `app-direction.md` §Graph and §Motion: SVG, reticle, centre mark with branch ticks, branch hues, node sizes by link degree, solid curved tree edges, dashed cross-link arcs, inbox diamonds on their arc, stale (30d/90d) styling, `pinned` nodes get a second hairline ring, hover 1-hop highlight with dimming, keyboard traversal and focus reticle, zoom 0.4–2.5× and pan (viewBox), HUD, ⌥-click branch filter, entrance choreography ≤ 560 ms, reduced-motion fallback. Also Split view (⌘2).

- [ ] **Step 1:** Build `graph.js` and wire the route (Opus, same direction file).
- [ ] **Step 2: Browser check:** seeded tree appears radially; a cross-link created in Task 9 shows dashed; click opens the note; focus filter works; zoom/pan smooth with 300 synthetic notes (create via a throwaway script into a temp vault, not the real one).
- [ ] **Step 3:** `git commit -m "feat: radial graph view"`

### Task 11: End-to-end check and README

**Files:** Create `README.md`

- [ ] **Step 1:** README: what it is (one paragraph), `python3 server.py`, open `http://127.0.0.1:7337`, where the vault lives, that it never leaves the laptop, how to run both test suites.
- [ ] **Step 2:** Run both suites: `python3 -m unittest discover -s tests -v` and `node --test app/tests/` → all PASS.
- [ ] **Step 3:** Start the real server once against `~/second-mind/vault`; confirm seed tree, `.token` mode `600` (`stat -f %Lp .token` → `600`), `git -C vault remote` empty, `git status` in the code repo shows no vault or token files.
- [ ] **Step 4:** Run `codex` skill `review` on the branch in the background (CLAUDE.md rule: >20 lines, touches data); fix real findings.
- [ ] **Step 5:** `git commit -m "docs: README and phase 1 check"`
