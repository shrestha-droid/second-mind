# Second opinions on the design — 2026-11-25

Inputs: first draft of `docs/superpowers/specs/2026-11-25-second-mind-design.md`. Each reviewer saw the design, not Claude's preferences.

## Where they agreed (adopted)
- Build order: ship vault + packs + MCP first (stable CLI interfaces), Chrome extension last. (Codex, Gemini)
- Live editing of `~/.claude` files is risky: read-only mounts in v1. (Codex, Gemini)
- The savings meter can't prove much (undefined baseline, chars/4 estimate): dropped; packs show "≈" tokens. (Codex, Gemini)
- Packs: recency is a weak relevance signal; show what was cut, allow overrides, add `pinned`. (Codex, Gemini)

## Codex only (adopted)
- localhost + CORS is not an access boundary: Host check (DNS rebinding), Origin check, token, JSON-only, tests.
- Keep raw transcripts and secrets out of git; vault in its own remote-less repo.
- MCP: start with one client, verify each; treat `add_note` content as untrusted; sanitise, size-limit.
- Same-chat distill is not a dependable default: manual first, same-chat as explicit action with preview.
- Capture: virtualised/lazy-loaded chats; show preview + completeness, keep manual paste.

## Gemini only
- Adopted: SQLite FTS5 (stdlib) for ranked search; `pinned` flag; stale-summary warnings (context rot).
- Known gap, not v1: merging a new distilled chat into existing notes.
- Not adopted as stated: "drop the custom graph UI, use Obsidian". The visual graph is the point for Shrestha; instead Obsidian covers viewing during phase 1 and the graph page comes in phase 2.

## Builder check (Sonnet) — resolved in the doc
Git/remote layout, mount metadata and placement, meter baseline (meter dropped), MCP read restrictions + redaction, extension node picker, server lifecycle + venv path.
