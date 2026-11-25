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
| Branch labels in graph | Plex Mono | 11 / 500 / caps, +0.08em |

Blockquote: 15.5 italic, 2px left rule in `--branch` at 60%.

## Layout (1440×900 target, works from 1024)

- **Top bar** 36px, `--surface`, 1px bottom hairline. Left: breadcrumb `Shrestha › Work › Branch HQ` (12px; each crumb clickable, branch crumb tinted). Centre: segmented switch Graph ⌘1 · Split ⌘2 · Note ⌘3 (24px tall, 4px radius). Right: pack pill `≈1,240 / 1,500` (11px mono, 1px border; click focuses pack tab), theme toggle, ⌘K button. All icons inline SVG, 16px, `aria-label`.
- **Sidebar** 240px (drag 200–340, ⌘\ toggles), `--surface`, 1px right hairline. Top: filter box (typing filters the tree; Enter runs full-text search, results inline with 2-line snippets, matches `<mark>`). Then **Inbox** row pinned with accent count badge. Then the tree from `Shrestha`: 26px rows, 12px indent per level, 1px guide lines at 40% `--border`, branch rows prefixed by a 6px dot in branch hue. Stale rows (>30 days) show muted title + small `30d+` mono tag.
- **Centre** `1fr`, min 500px, `--bg`.
  - Note mode: frontmatter as a compact grid (28px rows: Type, Summary, Pinned, Updated) above a 1px hairline; then the body. v1 editing = **source and preview side by side** inside the centre pane (50/50, scroll-synced by ratio), ⌘E toggles preview-only reading. Prose column max 68ch, padding 44px 36px 96px. (Gemini's caret-line live preview is v2.)
  - Graph mode: full-bleed canvas holo tank (see §Graph), HUD bottom-right (28px, 12px inset, restyled to the tank, 1px border, 4px radius): zoom %, Stale toggle, Cross-links toggle, Re-centre (0).
  - Split mode: 45% graph / 55% note, 1px draggable divider. Clicking a node opens its note on the right without moving keyboard focus; Enter moves focus into the note.
- **Inspector** 300px (drag 260–420, ⌘⇧\ toggles), `--surface`, 1px left hairline, two tabs (32px): **Links (n)** and **Pack**.
  - Links: Backlinks then Outgoing; each row: 5px branch dot, title (13px/500), 2-line excerpt (12px muted), 1px dividers.
  - Pack: presets `1.5K · 3K · 6K · 12K` (default 1.5K, per spec); 3px fill bar (accent ≤ 90%, `--work` ochre 90–100%); rows (28px) for each included item with checkbox (include/exclude override) and right-aligned `≈640` mono; "Left out" list below in muted; sticky 48px footer with full-width 34px button **Copy pack · ⌘⇧C** showing `≈1,240 tokens`, flips to "Copied" for 1400ms.
- **Cmd+K** 560px wide (max `100vw - 32px`), top 14vh, max 440px tall, `--raised`, 1px border, 8px radius, `--shadow-pop`. 44px input; 36px rows: branch dot, title with matched chars bold, path right-aligned in 11px mono. `/` prefix = full-text search. Footer legend: ↵ open · ⌘↵ open in split · ⇧↵ add to pack.
- Panes have no shadows, no rounded cards, no gaps: only hairlines. Radius anywhere ≤ 8px.

## Graph (3D holo tank)

Changed 2026-11-26 at Shrestha's request: the graph is a 3D holographic constellation, a cinematic AI-HUD look (scattered nodes in depth, glow, slow rotation, HUD rings and ticks). The reference is mood only: no film assets, logos, names or copied interfaces. The 2D orrery below this line in git history is retired. Source for the numbers: a Gemini design pass (`.gemini-out/2026-11-26-holo-graph.md`, not committed), merged with the overrides marked **(ours)**.

**Rendering.** One `<canvas>` in Canvas 2D, own perspective projection, `globalCompositeOperation = 'lighter'` for the glow pass. No WebGL, no libraries. Device pixel ratio capped at 2. Glow = one pre-rendered 64×64 radial-gradient sprite per hue on an offscreen canvas, stamped with `drawImage`; never `shadowBlur`, never CSS `filter`. The animation loop runs only while the graph is visible (`document.hidden` false, graph or split view active) and stops when idle with reduced motion on.

**The tank.** The graph pane is a dark "holo tank" in **both** themes **(ours)**: background radial gradient `#0A1324` (centre) → `#04070D` (edge), clear colour `#05080F`. In light theme it gets a 1px `--border` frame; its HUD text stays light. Holo colour `#38BDF8`. Branch hues are the app's **dark-theme** branch tokens in both themes **(ours)**: Work `#E3B34C`, College `#58B8D6`, Social `#E685A6`, Competitions `#A98FF5`, Builds `#5BC993`. Inbox `#94A3B8`. Hover/focus: core `#FFFFFF`, reticle `#E0F2FE`. Dim (non-neighbours while hovering/focusing) multiplies alpha to 0.25.

**Additive budget.** Glow sprites 0.08–0.16 alpha, edges 0.06–0.28. Nothing above 0.20 where layers stack.

**Camera.** World sphere R = 260. Camera at z = −680, focal length f = 520, scale `s = f / (f + z_cam)`. Yaw/pitch orbit; pitch clamped ±1.2 rad. Zoom multiplies f, 0.4–2.5×.

**Layout** (pure, deterministic, no simulation). Seed per node from its id: FNV-1a → Mulberry32. Same payload → same coordinates, byte for byte.
- Centre (Shrestha) at the origin.
- Branches at r = 115, azimuth = the old bearings (Work −54°, College 18°, Social 90°, Competitions 162°, Builds 234°) **(ours, keeps each branch where it always was)**, elevation alternating ±0.35 rad in that order. A branch with no seed bearing takes the next free 72° slot.
- Projects (depth 2): in a cone of ±0.42 rad around their branch's direction, r 175–210 (from the seed), spread by golden angle 2.39996 rad over the children sorted by id.
- Deeper (depth 3+): cone ±0.18 rad around the parent's direction, r 225–265.
- Inbox: an equatorial ring at r = 290, elevation ±0.12 rad from the seed, azimuth spread by sorted index over the top arc (−120° to −60°) **(ours, same place the inbox always lived)**.
- 40 ambient particles at r 320–420 (seeded), 1px squares, holo at 0.08–0.14.

**Depth cues.** t = depth in [0,1] (0 back, 1 front). Size `max(1.5, r_base·s)`. Alpha `0.22 + 0.78·t^1.4`. Back half (t < 0.5): lerp colour toward `#05080F` by `(1−t)·0.65`. Draw order: additive glow pass (unsorted), then edges, then cores and labels sorted back-to-front.

**Nodes.**
- Centre: 9px `#FFFFFF` core, 16px holo ring 1.5px, 24px dashed `[4,4]` outer ring counter-rotating −0.12 rad/s.
- Branch: 6.5px core in hue, 12px ring 1px at 0.6, 28px glow at 0.16.
- Project: 4px core, 8px ring 0.75px at 0.4, 16px glow at 0.12. Core radius also grows with link degree: `+ min(2, 0.5·ln(1+degree))` **(ours)**.
- Deeper: 2.2px dot, 8px glow at 0.08.
- Inbox: 3px hollow diamond, 1px stroke `#94A3B8`, no glow.
- Stale (>30 days): hollow core (stroke only), hue desaturated 50%, alpha ×0.45, no glow. >90 days: the stroke is dashed `[2,2]` **(ours: shape cue, colour never alone)**.
- Pinned: 2px `#FFFFFF` inner dot + 10px `#E0F2FE` ring at 0.8, ignoring fog.

**Edges.** Tree: 1px straight, branch hue at `0.22·α_depth`. Cross-link: 0.75px dashed `[2,4]` quadratic, control point = midpoint ×0.82 toward the origin, holo at 0.09 idle, 0.55 when an endpoint is hovered or focused. The HUD toggle hides cross-links.

**Labels.** Max 16 per frame, priority: focused/hovered, its 1-hop neighbours, branches, then by depth. Offset `r_screen + 6`px on x, middle baseline, truncate at 18 chars + `…`.
- Branch: Plex Mono 11px caps +0.08em, front half only (or always when focused).
- Project: Plex Sans 11px, when scale ≥ 0.85 or hovered.
- Deeper/Inbox: Plex Sans 10px, on hover/focus or as a 1-hop neighbour.
- Text gets a 3px `#05080F` stroke halo (`strokeText` before `fillText`).

**HUD.** Two screen-space rings at 0.42 and 0.44 × min(w,h), 1px holo at 0.12. 72 ticks on the outer ring, rotating with yaw; minor 4px at 0.15, every 30° 8px at 0.30. Corner readouts, Plex Mono 10px caps +0.12em, 0.65 alpha, 16px inset:
- top-left `GRAPH // 284 NODES · 412 LINKS`
- top-right `YAW 142.4° · PITCH −12.0°`
- bottom-left focused node path (`SHRESTHA › WORK › BRANCH HQ`) and a key legend `←→↑↓ MOVE · ↵ OPEN · ⇧←→ ORBIT · ESC RESET`
- bottom-right zoom % and the active branch filter (with a clear button).
The existing DOM HUD (zoom %, Stale toggle, Cross-links toggle, Re-centre) stays as real buttons over the canvas, restyled to the tank. Scanlines: static 1px line every 3px, holo at 0.025 **(optional, off if it costs frames)**.

**Interaction.**
- Drag orbits (yaw/pitch); a press that moves < 4px is a click. Wheel zooms. Click picks the front-most node whose projected disc + 6px contains the pointer; it opens the note (`onOpen`). ⌥-click on a branch filters to that branch; the chip or Esc clears it.
- Hover (45ms intent, 120ms ease-out): radius +25%, 4 corner reticle ticks at `r_screen + 8`, 1-hop neighbours to full alpha, others dim to 0.25.
- Keyboard **(ours: keeps the tree-walk keys, Tab is never trapped)**: canvas is focusable (`tabindex=0`, `role="application"`, `aria-roledescription="3D graph"`). ← → siblings, ↑ parent, ↓ first child, Enter opens, C adds to the pack override, Space flies the camera to the focused node, ⇧+arrows orbit 15°, `+`/`−` zoom 15%, `0` or Esc resets camera (Esc first clears a filter). Each focus change updates a visually hidden `aria-live="polite"` region: `"<title>, <branch>, <n> links"`. Focus shows the reticle in accent `#E0F2FE`, dashed.
- Fly-to on select (Space, or opening from Split): 550ms `cubic-bezier(.22,1,.36,1)`, shortest-path yaw/pitch to bring the node to the front, f ×1.35.

### v2 look (Claude's direction, 2026-11-26)

Shrestha asked for no more outside design passes and for the graph to "go all out". This subsection is Claude's own direction and **wins over everything above it** where they differ. Same tank, hues, camera model, layout seeds and keys; much more depth, light and life.

**Fit.** Focal length scales with the pane: `f = 0.84 × min(w, h)` at zoom 1 (900px tall → 756). Zoom still multiplies f, 0.4–2.5×. Split view therefore fills its pane instead of drawing small. Recompute on resize and on a `devicePixelRatio` change.

**Back layers** (drawn first, in this order):
- Vignette: radial `#000` from 0 at 0.55·max(w,h) to 0.35 at the corners.
- Starfield: 220 stars, seeded, on a shell at r 900–1400, projected with yaw ×0.35 and pitch ×0.35 (parallax: they drift slower than the graph). 0.5–1.2px, `#CBD5E1` at 0.15–0.5. 12% of them twinkle (sine, period 3–7s, seeded phase).
- Nebulae: one soft cloud per branch, a pre-rendered 256px radial sprite in the branch hue, centred on the branch direction projected at r 200, drawn at 0.35·min(w,h) radius, alpha 0.045, `'lighter'`. They turn with the graph.
- Floor grid: a polar grid on the plane y = +330 (below the sphere): rings at r 100–500 every 100 (64-segment polylines) and 24 spokes, holo at 0.06 × depth alpha. Turns with yaw.
- Wireframe globe at r 300: latitudes 0°, ±30°, ±60° and 12 meridians, 48 segments each. Holo 0.035 on the back half, 0.07 on the front; equator 0.10.

**Core (Shrestha)** — a reactor, not a dot:
- 9px `#FFFFFF` core; 40px holo glow pulsing 0.16→0.24→0.16 over 3.2s.
- Arc ring A: r 16, one 300° arc, 1.5px, +0.35 rad/s, holo 0.55.
- Arc ring B: r 22, two 110° arcs opposite each other, 1px, −0.22 rad/s, holo 0.40.
- Ring C: r 29, dashed `[2,3]` full circle, +0.08 rad/s, holo 0.30.
- Label `SHRESTHA` centred under ring C, Plex Mono 11px caps +0.14em, `#E0F2FE`.
All radii × projection scale s.

**Branch nodes.** 6.5px core; 34px glow at 0.16; a 4-point flare: a 26px horizontal and an 18px vertical hairline, each a linear gradient hue → transparent from the centre, alpha 0.35. Orbit ring at 14px, 1px, hue 0.5, carrying one bright 60° arc at 0.9 that turns at 0.5 rad/s.

**Branch callouts.** Branch labels are tags, not floating text: a leader line leaves the node at 45° up and outward (away from the screen centre on x) for 14px, then runs 28px horizontal; 1px hue at 0.7, with a 2px dot at the elbow. Above the horizontal run: the name in Plex Mono 11px caps +0.08em, hue at 0.95; under the run: `<n> NOTES` (descendant count) in Plex Mono 9.5px caps at 0.55. Shown for every branch on the front half, and always when focused.

**Labels, readable.** Fill `#F1F5F9`, alpha `max(0.72, depth alpha)`; halo 3px `#05080F` at 0.9. Project labels Plex Sans 11.5px. Label gating: branch tags need t ≥ 0.5 (front half) or focus; project labels need s ≥ 0.85 or hover/focus; max 16 a frame as before.

**Edges.** Tree edges are a linear gradient from the parent's hue to the child's, alpha as before. Cross-links unchanged.

**Energy pulses.** Light travels outward along the tree: spawn 3 a second, at most 24 alive. Each starts at the centre on a random branch path and runs centre → branch → project (or deeper), 600ms per edge. A pulse is a 3px glow stamp in the edge's hue with a 5-stamp trail fading 0.5 → 0.

**Target lock (hover and keyboard focus).**
- Four corner brackets snap in from r+20 to r+8 over 140ms, 1.25px `#E0F2FE`.
- A dashed `[3,5]` ring at r+12 turning 0.8 rad/s.
- A holo callout panel, drawn in canvas: leader 40px at −30° then 24px flat; panel 184×64, background `#05080F` at 0.82, 1px holo border at 0.5, 2px left bar in the node's hue, 8px chamfer on the top-right corner. Line 1: title, Plex Sans 12.5px `#F8FAFC`, truncated to fit. Line 2: `WORK · 7 LINKS`, Plex Mono 9.5px caps 0.65. Line 3: `UPDATED 2026-11-02`, or `STALE · 41D` with the stale shape cue. It flips to the left of the node if it would leave the canvas. 120ms fade.

**Click.** A shockwave: a ring from r to r+60 in 500ms, 1.5px hue, alpha 0.6 → 0, and a second ring 80ms behind it. The note opens at once; the ring is decoration.

**Entrance.** Replaces the fly-out row in §Motion. 0–250ms HUD rings scale .92 → 1 and fade in. 150–750ms a scan line sweeps the tank top to bottom: 2px holo at 0.5 with a 60px glow below it at 0.08, full width. Each node appears as the line passes its screen y: alpha 0 → 1 in 120ms and radius from 0.85× to 1× world position in 300ms (easeOutCubic). Edges, tags and readouts fade in 600–1000ms. Then idle.

**HUD data panel** (real numbers only, computed from the payload). Under the top-left readout: a 44px donut, 3px thick, one arc per branch sized by its note count with 2° gaps; beside it five rows, Plex Mono 9.5px caps, a 6px hue swatch then `WORK 42`. Under those, a stale meter: 80×3px track at holo 0.15, filled by the stale share in `#94A3B8`, labelled `STALE 18%`. Hidden when the canvas is under 760px wide.

**Keys added.** `F` filters to the focused node's branch (the keyboard route to the ⌥-click filter); Esc clears it. Add it to the canvas `aria-label` and the legend: `F FILTER`.

**Reduced motion.** No pulses, twinkle, ring spin, scan line or shockwave (a 150ms opacity flash instead); brackets appear without the snap; the core glow holds at 0.20. Final layout at first paint.

**Budget.** ≥ 50fps median at 1440×900, DPR 2, 300 nodes, measured headless as before. If over budget, drop in this order: gradient edges → solid child hue; star twinkle; meridians 12 → 8; nebulae.

## Motion

| What | Duration | Easing |
|---|---|---|
| Pane collapse/expand | 180ms | `cubic-bezier(.2,0,0,1)` |
| View switch | 140ms opacity, note text `translateY(6px→0)` | `cubic-bezier(.25,.1,.25,1)` |
| Cmd+K open / close | 110ms (opacity, scale .985→1) / 80ms | `cubic-bezier(.16,1,.3,1)` / `ease-in` |
| Graph entrance (3D) | 900ms total: HUD rings scale .92→1 and fade in 0–250ms (easeOutExpo); nodes fly out from the origin 150–650ms staggered by tier (centre 0, branches +80ms, projects +180ms, deeper/inbox +280ms, easeOutCubic); edges and readouts fade in 450–900ms | as listed |
| Graph idle | yaw 0.045 rad/s, pitch sine ±0.03 rad over 24s; pauses on any pointer/key input, resumes 4000ms after the last | linear |
| Graph fly-to | 550ms | `cubic-bezier(.22,1,.36,1)` |
| Node hover ring/scale | 100ms | `cubic-bezier(.2,0,0,1)` |
| Neighbour dim | 130ms after 45ms intent | `ease-out` |
| Copy confirm | 120ms in, hold 1400ms, 200ms out | `ease-out` |

Animate only `opacity` and `transform` (pane width is the one exception). Entrance plays once per load, not on every view switch. Canvas animation is the graph's own exception to "opacity and transform only". `prefers-reduced-motion: reduce`: final layout at first paint, no idle rotation, static particles, fly-to is a 150ms move, 80ms opacity fades only elsewhere.

## Rules (from ui-ux-pro-max)

- SVG icons only, never emoji. Visible focus on every control (accent 1.5px). Hover transitions 100–180ms. `cursor: pointer` on clickables.
- Colour never carries meaning alone: stale also gets the `30d+` tag / dashed stroke; inbox also gets the diamond shape.
- Empty states say what to do: empty note body "Write here. `[[` links a note."; empty inbox "Nothing to file."; no search hits "No notes match. Try fewer words."
- Server down: thin accent banner under the top bar "Server not running: `python3 server.py`", edits kept in memory, retried.

## Avoid

1. Force-directed drift: positions must not move between loads. Glow lives only inside the graph tank, as sprites within the additive budget; never on app chrome. No fake telemetry ("DECRYPTING…"), CRT distortion, chromatic aberration, scanlines above 0.04 alpha, idle spin above 0.10 rad/s, or pure #00FF00/#FF00FF.
2. SaaS chrome: rounded floating cards, pane shadows, streaks, heatmaps, icon toolbars. Show only numbers that matter (≈tokens, backlinks, inbox).
3. Mouse-only graph: every graph action has a key.
