# App direction: Orrery

Source: Gemini 4 Neon (`gemini-direction.md`, full reasoning there) + `ui-ux-pro-max` checklist. This file is what Tasks 9-10 build from. Where the two differ, this file wins. Contrast re-checked by script on 2026-11-25: every text/accent/branch hue is ≥ 4.5:1 on background, surface and raised, both themes.

## Concept

**Orrery.** A precision drafting table: Shrestha at the origin, five life branches on fixed bearings, projects orbiting them. Watch-dial density, 1px hairlines, ink on vellum. No glow, no cards, no shadows on panes. Beautiful because it is exact, not because it is decorated.

## Tokens

```css
:root[data-theme="dark"] {
  --bg:#111214; --surface:#17191C; --raised:#1F2227; --border:#2B2F36;
  --text:#E6E8EC; --muted:#9097A3; --accent:#F07855;
  --work:#E3B34C; --college:#58B8D6; --social:#E685A6; --competitions:#A98FF5; --builds:#5BC993;
  --shadow-pop: 0 20px 48px rgba(0,0,0,.48);
}
:root[data-theme="light"] {
  --bg:#F6F5F0; --surface:#ECEAE3; --raised:#FFFFFF; --border:#D8D5CC;
  --text:#18191C; --muted:#5C5E66; --accent:#B83E1B;
  --work:#8A5E0A; --college:#116A8A; --social:#A3335A; --competitions:#6142B3; --builds:#14724B;
  --shadow-pop: 0 16px 40px rgba(24,25,28,.14);
}
```
Theme follows `prefers-color-scheme`; a toggle in the top bar overrides it (stored in `localStorage`). Components use tokens only, never raw hex. A note's branch is the second segment of its id (`shrestha/<branch>/…`); `--branch` is set per element from it. Inbox and the root use `--accent` / `--text`.

## Type

Fonts are vendored woff2 under `app/vendor/fonts/` (OFL), never a CDN. **Ask Shrestha before downloading** (Task 8, same ask as `marked`): IBM Plex Sans, IBM Plex Mono, Source Serif 4, variable or 400/500/600, ~300 KB total. Until then fallbacks: `-apple-system, system-ui` / `Charter, Georgia, serif` / `ui-monospace, SF Mono, Menlo`.

| Use | Font | Size / weight / line-height |
|---|---|---|
| Breadcrumb, tabs | Plex Sans | 12 / 500 / 16, +0.01em |
| Tree rows, backlink titles | Plex Sans | 13 / 400 (500 active) / 20 |
| Cmd+K input | Plex Sans | 15 / 400 / 22 |
| Eyebrows (BACKLINKS, CONTEXT PACK) | Plex Sans | 10.5 / 600 / caps, +0.08em |
| Note body | Source Serif 4 | 16.5 / 400 / 1.68, measure 66ch |
| H1 / H2 / H3 | Source Serif 4 | 26 / 20 / 16.5, weight 600, tracking -0.02em / -0.015em / 0 |
| Code | Plex Mono | 13 / 400 / 1.55 |
| Counts, ≈tokens, dates, keycaps, HUD | Plex Mono | 11 / 400 / 14, `tabular-nums` |
| Branch labels in graph | Plex Mono | 10.5 / 500 / caps, +0.09em |

Blockquote: 15.5 italic, 2px left rule in `--branch` at 60%.

## Layout (1440×900 target, works from 1024)

- **Top bar** 36px, `--surface`, 1px bottom hairline. Left: breadcrumb `Shrestha › Work › Branch HQ` (12px; each crumb clickable, branch crumb tinted). Centre: segmented switch Graph ⌘1 · Split ⌘2 · Note ⌘3 (24px tall, 4px radius). Right: pack pill `≈1,240 / 1,500` (11px mono, 1px border; click focuses pack tab), theme toggle, ⌘K button. All icons inline SVG, 16px, `aria-label`.
- **Sidebar** 240px (drag 200–340, ⌘\ toggles), `--surface`, 1px right hairline. Top: filter box (typing filters the tree; Enter runs full-text search, results inline with 2-line snippets, matches `<mark>`). Then **Inbox** row pinned with accent count badge. Then the tree from `Shrestha`: 26px rows, 12px indent per level, 1px guide lines at 40% `--border`, branch rows prefixed by a 6px dot in branch hue. Stale rows (>30 days) show muted title + small `30d+` mono tag.
- **Centre** `1fr`, min 500px, `--bg`.
  - Note mode: frontmatter as a compact grid (28px rows: Type, Summary, Pinned, Updated) above a 1px hairline; then the body. v1 editing = **source and preview side by side** inside the centre pane (50/50, scroll-synced by ratio), ⌘E toggles preview-only reading. Prose column max 68ch, padding 44px 36px 96px. (Gemini's caret-line live preview is v2.)
  - Graph mode: full-bleed SVG, HUD bottom-left (28px, 12px inset, `--raised`, 1px border, 4px radius): zoom %, Stale toggle, Cross-links toggle, Re-centre (0).
  - Split mode: 45% graph / 55% note, 1px draggable divider. Clicking a node opens its note on the right without moving keyboard focus; Enter moves focus into the note.
- **Inspector** 300px (drag 260–420, ⌘⇧\ toggles), `--surface`, 1px left hairline, two tabs (32px): **Links (n)** and **Pack**.
  - Links: Backlinks then Outgoing; each row: 5px branch dot, title (13px/500), 2-line excerpt (12px muted), 1px dividers.
  - Pack: presets `1.5K · 3K · 6K · 12K` (default 1.5K, per spec); 3px fill bar (accent ≤ 90%, `--work` ochre 90–100%); rows (28px) for each included item with checkbox (include/exclude override) and right-aligned `≈640` mono; "Left out" list below in muted; sticky 48px footer with full-width 34px button **Copy pack · ⌘⇧C** showing `≈1,240 tokens`, flips to "Copied" for 1400ms.
- **Cmd+K** 560px wide (max `100vw - 32px`), top 14vh, max 440px tall, `--raised`, 1px border, 8px radius, `--shadow-pop`. 44px input; 36px rows: branch dot, title with matched chars bold, path right-aligned in 11px mono. `/` prefix = full-text search. Footer legend: ↵ open · ⌘↵ open in split · ⇧↵ add to pack.
- Panes have no shadows, no rounded cards, no gaps: only hairlines. Radius anywhere ≤ 8px.

## Graph

Radial, deterministic, never force-directed: same vault → same picture, so Builds is always in the same place.

- **Bearings** (0° = 3 o'clock, clockwise in SVG): Work −54°, College 18°, Social 90°, Competitions 162°, Builds 234°. The top gap (−90°) belongs to the Inbox.
- **Reticle:** two hairline circles at r=150 and r=290, `--border` at 35%.
- **Centre (Shrestha):** solid r=10 `--text`, 3px gap, 1.5px ring at r=16, plus five 4px ticks (r 16→20) at the branch bearings in branch hues. Hover shows `5 branches · N notes` 12px below in mono.
- **Branches (depth 1):** on r=150 at their bearing. Fill r=8 in branch hue + 1.25px ring at r=12, 40% hue. Label always on (zoom ≥ 0.45): mono caps, 14px outside the ring.
- **Projects (depth 2):** within a 56° sector centred on the parent's bearing (8° gutter), radii 255–330, children sorted by id and spread evenly; alternate radii when > 4 in a sector. r = 4.5 + min(3, 0.7·ln(1 + links)). Fill branch hue. Label 12px Plex Sans at zoom ≥ 0.85 (always for the 6 highest-degree), ellipsis at 136px, `paint-order: stroke` 3px `--bg` halo.
- **Deeper (depth 3+):** hollow r=3, 1.25px branch-hue stroke, 38–58px out from parent along its bearing. Label on hover/focus or zoom ≥ 1.35.
- **Tree edges:** 1.25px, cubic curve, child's branch hue at 38% (dark) / 42% (light).
- **Cross-links:** 1px, `stroke-dasharray: 3 4`, quadratic arc bent 18% toward the origin, `--muted` at 28%. HUD toggle hides them.
- **Inbox:** hollow 9px diamonds (rotated square), 1.5px accent stroke dashed `2 2`, on an arc at r=72 from −120° to −60°; dotted tether to the centre (`1 4`, accent 35%).
- **Stale** (>30 days): fill transparent, 1.25px stroke at 50% hue, label 55%. >90 days: stroke dashed `2 2`.
- **Hover:** node scales 1.2 with a 1.5px ring at r+4 in hue. 1-hop neighbours stay 100%; their tree edges 1.75px at 90%; their cross-links turn accent 1.5px at 90%. Everything else dims to 16% (dark) / 20% (light). 45ms hover-intent delay.
- **Keyboard:** graph is focusable; arrows move along bearings/children (← → siblings, ↑ parent, ↓ first child), Enter opens, C adds to pack override. Focus ring: 1.5px dashed accent `4 3` at r+7. Every node has `role="button"` and `aria-label="<title>, <branch>"`.
- **Zoom/pan:** wheel + drag, 0.4–2.5×, `0` re-centres. Branch filter: clicking a branch label while holding ⌥ shows only that branch.
- No blur, no glow, no bloom, anywhere.

## Motion

| What | Duration | Easing |
|---|---|---|
| Pane collapse/expand | 180ms | `cubic-bezier(.2,0,0,1)` |
| View switch | 140ms opacity, note text `translateY(6px→0)` | `cubic-bezier(.25,.1,.25,1)` |
| Cmd+K open / close | 110ms (opacity, scale .985→1) / 80ms | `cubic-bezier(.16,1,.3,1)` / `ease-in` |
| Graph entrance | centre + reticle 160ms; branches fly out from origin 300ms, stagger 22ms, start 60ms; projects 220ms from parent, stagger 8ms capped at 160ms, start 150ms; tree edges grow with children; cross-links fade in from 380ms over 180ms. Settled ≤ 560ms | `cubic-bezier(.16,1,.3,1)` |
| Node hover ring/scale | 100ms | `cubic-bezier(.2,0,0,1)` |
| Neighbour dim | 130ms after 45ms intent | `ease-out` |
| Copy confirm | 120ms in, hold 1400ms, 200ms out | `ease-out` |

Animate only `opacity` and `transform` (pane width is the one exception). Entrance plays once per load, not on every view switch. `prefers-reduced-motion: reduce`: final layout at first paint, 80ms opacity fades only, everything else instant.

## Rules (from ui-ux-pro-max)

- SVG icons only, never emoji. Visible focus on every control (accent 1.5px). Hover transitions 100–180ms. `cursor: pointer` on clickables.
- Colour never carries meaning alone: stale also gets the `30d+` tag / dashed stroke; inbox also gets the diamond shape.
- Empty states say what to do: empty note body "Write here. `[[` links a note."; empty inbox "Nothing to file."; no search hits "No notes match. Try fewer words."
- Server down: thin accent banner under the top bar "Server not running: `python3 server.py`", edits kept in memory, retried.

## Avoid

1. Force-directed drift and neon glow: positions must not move between loads.
2. SaaS chrome: rounded floating cards, pane shadows, streaks, heatmaps, icon toolbars. Show only numbers that matter (≈tokens, backlinks, inbox).
3. Mouse-only graph: every graph action has a key.
