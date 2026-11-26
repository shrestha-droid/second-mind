import { test } from "node:test";
import assert from "node:assert/strict";
import { clampZoom, nodeRadius, degrees, staleLevel, neighbours, visibleIds, topByDegree, buildNav, step, holoLayout, galaxyLayout, project, labelCap, labelPriority, placeLabels } from "../graph.js";
import { orreryLayout } from "../lib.js";

const N = (id, extra = {}) => ({ id, title: id, ...extra });
const nodes = [
  N("shrestha"), N("shrestha/work"), N("shrestha/builds"), N("shrestha/college"),
  N("shrestha/builds/jar"), N("shrestha/builds/ward"), N("shrestha/builds/jar/notes"),
  N("shrestha/work/acme"), N("inbox/idea"),
];
const edges = [
  ...["work", "builds", "college"].map((b) => ({ source: "shrestha", target: `shrestha/${b}`, kind: "tree" })),
  { source: "shrestha/builds", target: "shrestha/builds/jar", kind: "tree" },
  { source: "shrestha/builds", target: "shrestha/builds/ward", kind: "tree" },
  { source: "shrestha/builds/jar", target: "shrestha/builds/jar/notes", kind: "tree" },
  { source: "shrestha/work", target: "shrestha/work/acme", kind: "tree" },
  { source: "shrestha/builds/jar", target: "shrestha/work/acme", kind: "link" },
];

test("clampZoom keeps 0.4..2.5", () => {
  assert.equal(clampZoom(0.1), 0.4);
  assert.equal(clampZoom(9), 2.5);
  assert.equal(clampZoom(1.2), 1.2);
});

test("nodeRadius matches the drawn size per tier, and projects grow with degree and cap", () => {
  assert.equal(nodeRadius(0), 4);
  assert.ok(nodeRadius(3) > nodeRadius(1));
  assert.equal(nodeRadius(1e9), 6);
  assert.equal(nodeRadius(5, 0), 9);
  assert.equal(nodeRadius(5, 1), 6.5);
  assert.equal(nodeRadius(5, 3), 2.2);
  assert.equal(nodeRadius(5, 4), 3);
});

test("degrees counts both ends of tree and link edges", () => {
  const d = degrees(edges);
  assert.equal(d.get("shrestha/builds/jar"), 3);
  assert.equal(d.get("shrestha"), 3);
  assert.equal(d.get("shrestha/work/acme"), 2);
  assert.equal(d.get("inbox/idea"), undefined);
});

test("staleLevel: fresh, 30-day, 90-day and undated", () => {
  const today = new Date(2026, 10, 26);
  assert.equal(staleLevel({ stale: false, updated: "2020-01-01" }, today), 0);
  assert.equal(staleLevel({ stale: true, updated: "2026-10-01" }, today), 1);
  assert.equal(staleLevel({ stale: true, updated: "2026-08-28" }, today), 1); // exactly 90 days
  assert.equal(staleLevel({ stale: true, updated: "2026-08-27" }, today), 2);
  assert.equal(staleLevel({ stale: true, updated: null }, today), 2);
  assert.equal(staleLevel({ stale: true, updated: "soon" }, today), 2);
});

test("neighbours is one hop, both directions, without self", () => {
  assert.deepEqual([...neighbours("shrestha/builds/jar", edges)].sort(), ["shrestha/builds", "shrestha/builds/jar/notes", "shrestha/work/acme"]);
  assert.equal(neighbours("inbox/idea", edges).size, 0);
});

test("visibleIds filters to one branch plus the centre", () => {
  assert.equal(visibleIds(nodes, null).size, nodes.length);
  assert.deepEqual([...visibleIds(nodes, "builds")].sort(), ["shrestha", "shrestha/builds", "shrestha/builds/jar", "shrestha/builds/jar/notes", "shrestha/builds/ward"]);
});

test("topByDegree sorts by degree then id", () => {
  const d = new Map([["a", 1], ["b", 3], ["c", 3], ["d", 0]]);
  assert.deepEqual([...topByDegree(["a", "b", "c", "d"], d, 2)], ["b", "c"]);
});

test("buildNav and step walk the tree by arrow keys", () => {
  const pos = orreryLayout(nodes);
  const nav = buildNav(new Set(nodes.map((n) => n.id)), pos);
  assert.equal(step(nav, "shrestha/builds/jar", "ArrowUp"), "shrestha/builds");
  assert.equal(step(nav, "shrestha/builds/jar", "ArrowDown"), "shrestha/builds/jar/notes");
  assert.equal(step(nav, "shrestha", "ArrowUp"), null);
  assert.equal(step(nav, "shrestha/builds/jar/notes", "ArrowDown"), null);
  assert.equal(nav.up.get("inbox/idea"), "shrestha");
  // centre's children run clockwise from the top: work (-54), college (18), builds (234), inbox (-90 sits last at 360)
  const kids = nav.kids.get("shrestha");
  assert.deepEqual(kids.filter((k) => !k.startsWith("inbox/")), ["shrestha/work", "shrestha/college", "shrestha/builds"]);
  const r = step(nav, "shrestha/builds/jar", "ArrowRight"), l = step(nav, "shrestha/builds/jar", "ArrowLeft");
  assert.equal(r, "shrestha/builds/ward");
  assert.equal(l, "shrestha/builds/ward"); // two siblings wrap both ways
  assert.equal(step(nav, "shrestha/work/acme", "ArrowRight"), null); // only child
});

test("buildNav skips ids without a layout position", () => {
  const pos = orreryLayout(nodes);
  pos.delete("shrestha/builds/ward");
  const nav = buildNav(new Set(nodes.map((n) => n.id)), pos);
  assert.ok(!nav.kids.get("shrestha/builds").includes("shrestha/builds/ward"));
});

// ---------- 3D layout ----------

const payload = { nodes, edges };
const unit = (p) => { const r = Math.hypot(p.x, p.y, p.z); return [p.x / r, p.y / r, p.z / r]; };
const angle = (a, b) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

// Five branches of 8 projects, 2-3 depth-3 notes per project (two with a depth-4 note), inbox notes up to 300 in all.
function synthetic() {
  const ns = [N("shrestha")], es = [];
  const add = (id, parent) => { ns.push(N(id)); if (parent) es.push({ source: parent, target: id, kind: "tree" }); };
  for (const b of ["work", "college", "social", "competitions", "builds"]) {
    add(`shrestha/${b}`, "shrestha");
    for (let p = 0; p < 8; p++) {
      const pid = `shrestha/${b}/p${p}`;
      add(pid, `shrestha/${b}`);
      for (let n = 0; n < 2; n++) add(`${pid}/n${n}`, pid), add(`${pid}/n${n}/d`, `${pid}/n${n}`);
      if (p < 7) add(`${pid}/n2`, pid);
    }
  }
  while (ns.length < 300) add(`inbox/i${ns.length}`);
  return { nodes: ns, edges: es };
}

test("holoLayout is deterministic and every coordinate is finite", () => {
  const big = synthetic();
  const a = holoLayout(big), b = holoLayout(structuredClone(big));
  assert.equal(a.size, big.nodes.length);
  assert.deepEqual([...a], [...b]);
  for (const p of a.values()) for (const v of [p.x, p.y, p.z]) assert.ok(Number.isFinite(v));
  assert.deepEqual(a.get("shrestha"), { x: 0, y: 0, z: 0, tier: 0 });
});

test("holoLayout keeps each project nearer its own branch than any other", () => {
  for (const pl of [payload, synthetic()]) {
    const pos = holoLayout(pl);
    const branches = [...pos].filter(([, p]) => p.tier === 1);
    for (const [id, p] of pos) {
      if (p.tier !== 2) continue;
      const own = id.split("/").slice(0, 2).join("/"), d = unit(p);
      const mine = angle(d, unit(pos.get(own)));
      for (const [bid, bp] of branches) if (bid !== own) assert.ok(mine < angle(d, unit(bp)), `${id} strays toward ${bid}`);
    }
  }
});

test("holoLayout puts inbox notes on the r=290 ring, within ±0.12 rad of the equator", () => {
  const pos = holoLayout(synthetic());
  const inbox = [...pos].filter(([id]) => id.startsWith("inbox/"));
  assert.ok(inbox.length >= 20);
  for (const [, p] of inbox) {
    const r = Math.hypot(p.x, p.y, p.z);
    assert.ok(Math.abs(r - 290) <= 1, `r ${r}`);
    assert.ok(Math.abs(Math.asin(p.z / r)) <= 0.12, `elevation ${Math.asin(p.z / r)}`);
    assert.equal(p.tier, 4);
  }
});

test("holoLayout lays out 300 nodes in under 20ms", () => {
  const big = synthetic();
  holoLayout(big); // warm the JIT
  const t0 = performance.now();
  holoLayout(big);
  assert.ok(performance.now() - t0 < 20);
});

test("galaxyLayout is deterministic, finite, and puts the centre at the origin", () => {
  const big = synthetic();
  const a = galaxyLayout(big), b = galaxyLayout(structuredClone(big));
  assert.equal(a.size, big.nodes.length);
  assert.deepEqual([...a], [...b]);
  for (const p of a.values()) for (const v of [p.x, p.y, p.z]) assert.ok(Number.isFinite(v));
  assert.deepEqual(a.get("shrestha"), { x: 0, y: 0, z: 0, tier: 0 });
});

test("galaxyLayout keeps each project nearer its own branch than any other", () => {
  for (const pl of [payload, synthetic()]) {
    const pos = galaxyLayout(pl);
    const branches = [...pos].filter(([, p]) => p.tier === 1);
    const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    for (const [id, p] of pos) {
      if (p.tier !== 2) continue;
      const own = id.split("/").slice(0, 2).join("/"), mine = d(p, pos.get(own));
      for (const [bid, bp] of branches) if (bid !== own) assert.ok(mine < d(p, bp), `${id} strays toward ${bid}`);
    }
  }
});

test("galaxyLayout is a disc, not a sphere, with inbox on the r=300 ring", () => {
  const pos = [...galaxyLayout(synthetic())];
  const disc = pos.filter(([, p]) => p.tier < 4).map(([, p]) => p);
  const ext = (k) => Math.max(...disc.map((p) => p[k])) - Math.min(...disc.map((p) => p[k]));
  assert.ok(ext("y") < 0.35 * Math.max(ext("x"), ext("z")), `y ${ext("y")} x ${ext("x")} z ${ext("z")}`);
  const inbox = pos.filter(([id]) => id.startsWith("inbox/"));
  assert.ok(inbox.length >= 20);
  for (const [, p] of inbox) {
    assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 300) <= 1);
    assert.equal(p.tier, 4);
  }
});

test("galaxyLayout lays out 300 nodes in under 20ms", () => {
  const big = synthetic();
  galaxyLayout(big);
  const t0 = performance.now();
  galaxyLayout(big);
  assert.ok(performance.now() - t0 < 20);
});

test("project: origin at the screen centre, nearer points larger and in front", () => {
  const cam = { yaw: 0, pitch: 0, zoom: 1, fit: 1, cx: 100, cy: 50 };
  const o = project({ x: 0, y: 0, z: 0 }, cam);
  assert.deepEqual([o.sx, o.sy], [100, 50]);
  assert.ok(Math.abs(o.s - 520 / 680) < 1e-9);
  const near = project({ x: 0, y: 0, z: -260 }, cam), far = project({ x: 0, y: 0, z: 260 }, cam);
  assert.ok(near.s > o.s && o.s > far.s);
  assert.equal(near.depth, 1);
  assert.equal(far.depth, 0);
  // a quarter turn of yaw brings +x to the front
  const turned = project({ x: 260, y: 0, z: 0 }, { ...cam, yaw: -Math.PI / 2 });
  assert.ok(Math.abs(turned.depth - 1) < 1e-9 && Math.abs(turned.sx - 100) < 1e-6);
  const z2 = project({ x: 10, y: 0, z: 0 }, { ...cam, zoom: 2 }).sx - 100, z1 = project({ x: 10, y: 0, z: 0 }, cam).sx - 100;
  assert.ok(Math.abs(z2 - 2 * z1) < 1e-9);
});

// The graph builds its arrow-key order from the 3D layout's x and y, so check that path too.
const navOf = (pl) => { const pos = holoLayout(pl); return buildNav(new Set(pl.nodes.map((n) => n.id)), pos); };

test("buildNav over holoLayout orders the centre's branches work, college, builds", () => {
  const kids = navOf(payload).kids.get("shrestha").filter((k) => !k.startsWith("inbox/"));
  assert.deepEqual(kids, ["shrestha/work", "shrestha/college", "shrestha/builds"]);
});

test("buildNav over holoLayout: right then left comes back for every node with siblings (300 nodes)", () => {
  const big = synthetic(), nav = navOf(big);
  let checked = 0;
  for (const { id } of big.nodes) {
    const sib = nav.kids.get(nav.up.get(id));
    if (!sib || sib.length < 2) continue;
    assert.equal(step(nav, step(nav, id, "ArrowRight"), "ArrowLeft"), id);
    assert.equal(new Set(sib).size, sib.length);
    checked++;
  }
  assert.ok(checked > 200, String(checked));
});

test("labels: compact tank caps at 8, neighbours of the hover obey the tier gate", () => {
  assert.equal(labelCap(337), 8);
  assert.equal(labelCap(1440), 15);
  const cands = Array.from({ length: 20 }, (_, i) => ({ box: [0, i * 30, 50, i * 30 + 16] }));
  assert.equal(placeLabels(cands, { cap: labelCap(337) }).length, 8);
  assert.equal(placeLabels(cands, { cap: labelCap(1440) }).length, 15);
  // 4px padding: boxes 2px apart collide, 6px apart do not
  assert.equal(placeLabels([{ box: [0, 0, 10, 10] }, { box: [12, 0, 20, 10] }], { cap: 15 }).length, 1);
  assert.equal(placeLabels([{ box: [0, 0, 10, 10] }, { box: [16, 0, 20, 10] }], { cap: 15 }).length, 2);
  // a box inside the r+22 ring round the locked node is dropped
  assert.equal(placeLabels([{ box: [100, 100, 140, 116] }], { cap: 15, avoid: [90, 108, 30] }).length, 0);
  const near = new Set(["far", "close", "br"]), ctx = { hover: "h", hl: 1, focus: "x", showRet: false, near, fit: 1 };
  assert.equal(labelPriority({ id: "far", tier: 2, s: 0.6, t: 0.1 }, ctx), 9);
  assert.equal(labelPriority({ id: "close", tier: 3, s: 0.9, t: 0.9 }, ctx), 3);
  assert.equal(labelPriority({ id: "br", tier: 1, s: 1, t: 0.3 }, ctx), 9);
  assert.equal(labelPriority({ id: "close", tier: 3, s: 0.9, t: 0.9 }, { ...ctx, compact: true }), 9);
  assert.equal(labelPriority({ id: "x", tier: 2, s: 0.5, t: 0.1 }, { ...ctx, showRet: true, compact: true }), 1);
});
