<!-- Model: Gemini 4 Neon, Thinking High (gemini.google.com), 2026-11-25. Reply saved verbatim (page-text extraction). -->

1. Concept & Mood

Orrery — A precision astronomical drafting table where one person sits at the gravitational origin and five life domains orbit on fixed 72° bearings.
Built with the quiet density of a mechanical watch dial and archival vellum: 1px hairlines, zero decorative chrome, and high-contrast ink engineered for 6+ hours of daily reading.

2. Color Palettes (WCAG AA Verified)

Every text, accent, and branch hue passes WCAG AA (≥ 4.5:1) against both the primary background and secondary surface in both themes. Pure #000000 and #FFFFFF backgrounds are avoided to eliminate OLED halation and paper glare.

Token | Role | Dark Hex | Dark Contrast (vs Bg) | Light Hex | Light Contrast (vs Bg)
Background | Canvas, editor sheet | #111214 | — | #F6F5F0 | —
Surface | Left tree, right inspector, top bar | #17191C | — | #ECEAE3 | —
Raised Surface | Cmd+K modal, popovers, active pills | #1F2227 | — | #FFFFFF | —
Border | 1px pane dividers, hairlines, inputs | #2B2F36 | — | #D8D5CC | —
Text | Primary prose, active tree items | #E6E8EC | 15.1:1 | #18191C | 16.1:1
Muted Text | Metadata, timestamps, shortcuts, counts | #9097A3 | 6.4:1 | #5C5E66 | 5.9:1
Accent | Caret, active tab, focus ring, Cmd+K match | #F07855 | 6.7:1 | #B83E1B | 5.1:1
Work | Branch 1 (0° / 12 o'clock-right, Ochre) | #E3B34C | 9.7:1 | #8A5E0A | 5.2:1
College | Branch 2 (72°, Cerulean) | #58B8D6 | 8.3:1 | #116A8A | 5.6:1
Social | Branch 3 (144°, Dusty Rose) | #E685A6 | 7.4:1 | #A3335A | 6.1:1
Competitions & hackathons | Branch 4 (216°, Iris Violet) | #A98FF5 | 7.1:1 | #6142B3 | 6.5:1
Builds | Branch 5 (288°, Viridian) | #5BC993 | 9.1:1 | #14724B | 5.5:1

3. Type Pairing

Bundle all three families locally as variable .woff2 files (zero network font calls, SIL Open Font License).

UI — IBM Plex Sans (enable font-feature-settings: "cv01", "ss02"):

- Top bar breadcrumbs & pane tabs: 12px / weight 500 / line-height 16px / tracking +0.01em
- Sidebar tree items & backlink titles: 13px / weight 400 (500 active) / line-height 20px
- Cmd+K input: 15px / weight 400 / line-height 22px
- Section eyebrows (BACKLINKS, CONTEXT PACK): 10.5px / weight 600 / uppercase / tracking +0.08em

Note Body — Source Serif 4 (optical size font-optical-sizing: auto):

- Body prose: 16.5px / weight 400 / line-height 1.68 (27.7px) / measure 66ch (~640px)
- H1: 26px / weight 600 / line-height 1.22 / tracking -0.02em / margin-bottom 16px
- H2: 20px / weight 600 / line-height 1.3 / tracking -0.015em / margin-top 28px
- H3: 16.5px / weight 600 / line-height 1.4 / margin-top 20px
- Blockquotes: 15.5px / italic / 2px left border in parent branch hue at 60% opacity

Monospace — IBM Plex Mono (enable font-variant-numeric: tabular-nums):

- Inline code & fenced code blocks: 13px / weight 400 / line-height 1.55
- Token counters, keyboard hints (⌘K), timestamps, frontmatter keys, graph zoom HUD: 11px / weight 400 / line-height 14px
- Graph Depth-1 branch labels: 10.5px / weight 500 / uppercase / tracking +0.09em

4. Radial Graph Styling

Anchor the canvas on a faint polar coordinate reticle: two hairline concentric reference circles at r = 150px (branch orbit) and r = 290px (project orbit) stroked in Border color at 35% opacity (1px).

Centre Node (Depth 0 — Self):

- Concentric reticle at (0, 0): solid inner circle r = 10px filled with Text color, 3px void gap, outer 1.5px ring at r = 16px in Text color.
- Five 4px radial tick marks extend outward from r = 16px to r = 20px at 72° intervals (-54°, 18°, 90°, 162°, 234°), each colored in its corresponding branch hue.

Branch Nodes (Depth 1 — 5 Life Domains):

- Positioned on the r = 150px ring at the five fixed bearings.
- Filled circle r = 8px in exact branch hue, encircled by a 1.25px outer ring at r = 12px at 40% branch hue opacity.

Project Nodes (Depth 2 — Leaf Nodes):

- Arranged in a 56° angular sector centered on their parent branch bearing (8° safety gutter between adjacent branches), at radii between 255px and 330px.
- Filled circle with logarithmic degree scaling: r = 4.5 + min(3, 0.7 · ln(1 + links)) px (range 4.5px–7.5px), filled in parent branch hue.

Sub-Notes (Depth 3 — Optional Expanded Atomic Notes):

- r = 3px hollow circle with 1.25px stroke in parent branch hue, orbiting 38px–58px from their parent project node.

Edge Styles:

- Solid Tree Edges (Hierarchy): 1.25px stroke, cubic radial Bézier curve, colored in child's branch hue at 38% opacity (Dark) / 42% opacity (Light).
- Dashed Cross-Links (Wiki-links across branches): 1px stroke, stroke-dasharray: 3 4, quadratic arc bent 18% toward origin to avoid crossing Depth-0 dead center, colored in Muted Text at 28% opacity.

Glow Policy:

- Zero Gaussian blur or bloom. Glow muddies dense graphs over long sessions. Communicate hierarchy and state strictly through concentric vector rings (1px–1.5px), opacity shifts, and stroke weight.

Label Rules:

- Depth 0: No permanent label; hovering reveals 11px mono node/note totals (5 branches · 42 projects · 318 notes) 12px below.
- Depth 1: Always visible when zoom >= 0.45. 10.5px uppercase IBM Plex Mono, placed radially 14px outside the outer ring.
- Depth 2: Visible when zoom >= 0.85 (or permanently for the top 6 highest-degree projects). 12px IBM Plex Sans, truncated with ellipsis at 136px width, rendered with a 3px Background-colored paint-order: stroke halo so text remains crisp over edges.
- Depth 3: Hidden until zoom >= 1.35 or hovered/focused.

Hover & Focus States:

- Hovered Node: Scales 1.2×, gains a 1.5px crisp concentric ring at r + 4px in branch hue.
- 1-Hop Neighborhood: Direct parent, direct children, and cross-linked nodes stay at 100% opacity; connected solid edges rise to 1.75px at 90% opacity; connected dashed cross-links switch to Accent color (1.5px, 90% opacity).
- Non-Neighbors: Dim to 16% opacity (Dark) / 20% opacity (Light).
- Keyboard Focus (Arrow/hjkl traversal): Draws a 1.5px dashed Accent reticle (dasharray: 4 3) at r + 7px.

Stale Nodes (Unmodified > 30 Days):

- Fill drops to transparent; stroke becomes 1.25px solid at 50% branch hue opacity; label opacity drops to 55%.
- At > 90 days, stroke changes to dasharray: 2 2.

Inbox Nodes (Unfiled Captures):

- Placed along a dedicated holding arc at r = 72px centered at 12 o'clock (-90°, spanning -120° to -60°), sitting between Self and the 5 branches.
- Shape: 9px × 9px rotated 45° hollow diamond, 1.5px Accent stroke (dasharray: 2 2), connected to (0, 0) only by a 0.75px dotted tether (dasharray: 1 4) at 35% Accent opacity until filed into a branch.

5. Three-Pane Layout & Dimensions

Designed for 1440 × 900 default desktop viewports (functional down to 1024px, fluid to 2560px). Every partition is a crisp 1px Border hairline—no card shadows or outer gaps between panes.

Top Instrument Bar (height: 36px, full width, Surface bg, 1px bottom border):

- Left: 72px macOS traffic-light clearance (if Electron/PWA titlebar) + active breadcrumb (Builds / Orrery / graph-spec.md) in 12px mono.
- Center: 3-state segmented view switch (Graph ⌘1 | Split ⌘2 | Note ⌘3), 24px height, 4px radius.
- Right: Live Context Pack pill (CTX 2,140 / 4,000t, 11px mono, 1px border, click or ⌘⇧P to focus right inspector) + ⌘K trigger icon.

Pane 1 — Left Sidebar Tree (default: 240px, resizable 200px–340px, toggle ⌘\):

- Surface background, 1px right border.
- Top 36px inline search/filter bar (⌘⇧F expands full-text search results directly inside this pane with 2-line matched snippets and highlighted terms).
- Pinned Inbox section at top with right-aligned 11px mono count badge in Accent color.
- Five branch roots below, each prefixed with a 6px solid circle in its branch hue; tree rows are 26px tall, 12px left indent per depth level, 1px vertical guide lines at 40% Border opacity.

Pane 2 — Centre Workspace (width: 1fr, min-width: 500px):

- Background color (#111214 / #F6F5F0).
- Editor Mode: Live-preview Markdown (syntax tokens like **, ##, [[ render only when the caret enters that line/span). Prose container centered with max-width: 68ch, padding: 44px 36px 96px. Frontmatter renders as a compact 28px-row metadata grid at top (Branch, Status, Updated, Links) separated by a 1px hairline.
- Graph Mode: Full-bleed HTML5 Canvas / SVG (devicePixelRatio-scaled) with a floating 28px-high bottom-left HUD (12px inset, Raised Surface, 1px border, 4px radius): Zoom %, Stale toggle, Cross-links toggle, and Re-center (0).
- Split Mode (⌘2): 45% Graph left / 55% Editor right separated by a 1px draggable divider; clicking or focusing a node in the graph opens its note immediately without stealing keyboard focus unless Enter is pressed.

Pane 3 — Right Inspector (default: 300px, resizable 260px–420px, toggle ⌘⇧\):

- Surface background, 1px left border.
- Top 32px 2-tab bar: Links (n) and Context Pack (or vertically split 50/50 on displays ≥ 1000px tall).
- Backlinks View: Grouped into Direct Backlinks and Unlinked Mentions; each entry shows note title (13px medium), branch dot (5px), and a 2-line clamped context excerpt (12px, Muted Text, 10px vertical padding, 1px hairline divider).
- Context Pack View:
  - Budget preset strip (2K | 4K | 8K | 16K) + 3px-tall segmented fill bar (Accent when ≤ 90%, ochre at 90–100%, clipped warning above 100%).
  - Checkable inclusion rows (28px height): Active note, Parent branch brief, 1-hop backlinks, Linked tasks, plus manually pinned notes—each with right-aligned exact token count (tnum mono, e.g. 640t).
  - Sticky bottom footer (48px height, 1px top border): full-width 34px button (Copy Context Pack · ⌘⇧C) showing exact total (2,840 tokens) and switching to a crisp Copied ✓ confirmation state for 1400ms.

Overlays (Cmd+K Quick Switcher & Full-Text Search Modal):

- Width 560px (max-width: calc(100vw - 32px)), top offset 14vh, max height 440px.
- Raised Surface background, 1px border, 8px border-radius, shadow 0 20px 48px rgba(0, 0, 0, 0.48) (Dark) / 0 16px 40px rgba(24, 25, 28, 0.14) (Light).
- 44px input row (15px UI font, prefix > for commands, / for full-text search, # for branch filter) + 36px result rows with branch dot, matched title, right-aligned folder path in 11px mono, and a 26px bottom keycap legend (↵ open · ⌘↵ split · ⇧↵ add to context).

6. Motion & Reduced-Motion Fallback

View Changes & Chrome:

- Pane collapse/expand (⌘\, ⌘⇧\): 180ms cubic-bezier(0.2, 0.0, 0.0, 1.0) on width/flex-basis.
- Graph ↔ Editor switch: 140ms cubic-bezier(0.25, 0.1, 0.25, 1.0) opacity cross-fade; incoming editor prose translates translateY(6px -> 0).
- Cmd+K modal open: 110ms cubic-bezier(0.16, 1, 0.3, 1) (opacity 0 -> 1, scale 0.985 -> 1); close: 80ms ease-in.

Graph Entrance (Total choreography settles in ≤ 560ms):

- 0ms: Centre node + polar reference rings fade in (160ms ease-out, scale 0.9 -> 1).
- 60ms: 5 Depth-1 branch nodes expand radially from (0, 0) to r = 150px over 300ms cubic-bezier(0.16, 1, 0.3, 1), staggered 22ms per branch (88ms total stagger).
- 150ms: Depth-2 project nodes radiate from their parent branch position over 220ms cubic-bezier(0.16, 1, 0.3, 1), staggered 8ms per node (total stagger capped at 160ms so 80+ nodes never drag).
- 150ms–420ms: Solid tree edges grow outward synchronized with child positions; dashed cross-links fade in last (0 -> 0.28 opacity over 180ms starting at 380ms).

Hover & Focus:

- Node scale & concentric ring reveal: 100ms cubic-bezier(0.2, 0, 0, 1).
- Neighborhood dimming / undimming: 130ms ease-out preceded by a 45ms hover-intent delay so moving the cursor across the graph never causes strobing.
- Copy confirmation flash (Copy Context Pack): 120ms color transition in, held 1400ms, 200ms fade out.

Reduced-Motion Fallback (prefers-reduced-motion: reduce + in-app toggle):

- Disable all transform, radial expansion, and edge-drawing animations.
- Pre-compute final radial node coordinates synchronously before first paint so the graph appears in its resting layout immediately (80ms linear opacity fade only).
- Pane toggles, view switches, Cmd+K, and hover dimming drop to 0ms instant state swaps (or 60ms linear opacity-only transition for modals).

7. Three Anti-Patterns to Avoid

1. Unconstrained Force-Directed Drift & Neon Bloom ("The Glowing Hairball"): Running a live physics simulation that recalculates random node coordinates on every load destroys spatial memory, and additive canvas glows cause eye fatigue within 30 minutes. Lock the 5 branches to fixed 72° polar sectors and persist node coordinates per vault so your brain remembers that Builds is always upper-left and Work is always upper-right.

2. SaaS Bento Chrome & Metric Clutter: Adding 16px-rounded floating cards, drop shadows around every pane, writing streaks, activity heatmaps, or multi-row icon toolbars wastes vertical reading space and turns a private thinking tool into a dashboard begging for attention. Keep the workspace flat with 1px hairlines and surface only actionable numbers (token count, backlink count, inbox count).

3. Mouse-Only Graph & Dual-Mode Markdown Jumps: Treating the radial graph as a passive visualization unreachable via keyboard—or forcing a raw-Markdown vs. rendered-HTML toggle that shifts vertical scroll position—breaks keyboard-first flow. Support direct arrow/hjkl node traversal from the graph (Enter to edit, C to append node to Context Pack) and use single-surface inline live preview where Markdown syntax unfolds strictly on the active cursor line.
