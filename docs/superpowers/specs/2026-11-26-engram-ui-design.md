# Engram UI: the constellation (approved 2026-11-26, "1 . go")

## Why
The notes are read by the AIs, not by Shrestha day to day. Shrestha opens Engram to see how their life connects and to fix something when it is wrong. So the graph is the hero screen and editing is a light "click a node, fix it" flow. It must feel sci-fi (not a copy of any film UI), and look great at 17 notes and readable at 500+.

## Goals
- Graph view is the default route. Clicking a node opens it in Split, so the graph stays beside the note.
- Real WebGL 3D: orbit, dolly, fly-through, not a zoom on a flat picture.
- A structure that is not a sphere: a galaxy disc.
- Colour aesthetics the user can switch: Cyan (default), Crimson, Violet, Amber, Emerald.

## Non-goals
- No new server API. No physics simulation. No editing inside the 3D scene.

## Anti-goals
- A pretty scene that hides the structure. A UI that drops below 50 fps at 500 notes on a laptop. Losing keyboard and screen-reader access.

## Approaches
1. **three.js WebGL, vendored (picked).** Real lights, bloom, fog, depth, 500+ nodes as instanced meshes. ~750 KB of vendored MIT code, no build step.
2. Keep Canvas2D and add effects. No real depth or bloom; the "zoom on a flat picture" look the user rejected.
3. A graph library (3d-force-graph). Force layout looks like every other graph, adds a dependency tree, and moves the layout away from the tree.

## Design
- **Layout (`galaxyLayout`, pure, tested):** root at the origin as a glowing core. Each branch is a log-spiral arm on its BEARING; projects sit along the arm, deeper notes in a small cluster around their parent, rising in y with tier so the disc has depth. Inbox is a tilted satellite ring at r≈300.
- **Scene (`graph-gl.js`, lazy-loaded so tests never import three):** instanced node spheres with an additive halo, curved tree edges in the branch hue, cross-links as lifted bright arcs, light pulses travelling root-outward, starfield, accent nebula, polar floor grid, fog, UnrealBloom.
- **Camera:** drag orbits, wheel dollies, click flies through space to the node, "Tour" flies branch to branch, idle drift. Reduced motion: no drift, no tour, short cuts.
- **Labels:** HTML overlay projected each frame, collision handled by the existing `labelPriority`/`placeLabels`.
- **Hover:** node and neighbours lit, the rest dimmed.
- **Themes:** `data-accent` on `<html>`, saved in localStorage `sm-accent`. Each sets `--accent`, `--holo`, and a branch palette. The graph reads the CSS vars and recolours live. The graph pane stays dark in both light and dark app themes.
- **Kept:** `renderGraph` API, keyboard nav (arrows, Enter, C, F, Space, 0/Esc, +/-), live region, HUD toggles (Stale, Cross-links, Re-centre, filter chip), the static demo build. No WebGL: a plain message.

## Left to the builder
Exact sizes, colours per theme, easing, label styling, HUD layout.
