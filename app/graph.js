// 3D holographic graph view (app-direction.md §Graph (3D holo tank)). Canvas 2D with its own perspective projection.
// Deterministic sphere layout from holoLayout, read-only. app.js calls renderGraph after every data refresh, so the
// canvas, camera and loop live per container and a call only swaps the data.

import {
  TAU, HUE, HOLO, RETICLE, CLEAR, INK, clamp01, lerp, easeOutCubic, seeded, projector, desat, fog, stamp, makeScene,
  drawBack, drawCore, drawBranchDeco, tagBox, drawTag, halo, drawLock, calloutBox, drawCallout, drawShock, drawScan, drawData,
} from "./graph-draw.js";

const ROOT = "shrestha";
const DAY = 864e5;
const ORDER = ["work", "college", "social", "competitions", "builds"]; // seed bearings -54°, 18°, 90°, 162°, 234° (as lib.js)

// ---------- pure helpers (no DOM, tested in app/tests/graph.test.mjs) ----------

export const ZOOM_MIN = 0.4, ZOOM_MAX = 2.5;
export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
/** Drawn core radius at scale 1, by tier: centre 9, branch 6.5, project 4 growing with degree (cap 6), deeper 2.2, inbox 3. */
export const nodeRadius = (degree, tier = 2) =>
  tier === 0 ? 9 : tier === 1 ? 6.5 : tier === 2 ? 4 + Math.min(2, 0.5 * Math.log(1 + degree)) : tier === 3 ? 2.2 : 3;

/** Edge count per node id, tree and cross-link edges alike. */
export function degrees(edges) {
  const d = new Map();
  for (const e of edges) for (const id of [e.source, e.target]) d.set(id, (d.get(id) || 0) + 1);
  return d;
}

/** 0 fresh, 1 stale (the server's 30-day flag), 2 older than 90 days or never dated. */
export function staleLevel(node, today = new Date()) {
  if (!node.stale) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(node.updated || "");
  if (!m) return 2;
  const days = (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(+m[1], m[2] - 1, +m[3])) / DAY;
  return days > 90 ? 2 : 1;
}

/** Ids one edge away from id. */
export function neighbours(id, edges) {
  const out = new Set();
  for (const e of edges) {
    if (e.source === id) out.add(e.target);
    else if (e.target === id) out.add(e.source);
  }
  out.delete(id);
  return out;
}

/** Ids shown under a branch filter: the centre plus that branch. No filter shows everything. */
export function visibleIds(nodes, filter) {
  return new Set(nodes.filter((n) => !filter || n.id === ROOT || (!n.id.startsWith("inbox/") && n.id.split("/")[1] === filter)).map((n) => n.id));
}

/** The n ids with the most edges, ties broken by id. */
export function topByDegree(ids, deg, n = 6) {
  return new Set([...ids].sort((a, b) => (deg.get(b) || 0) - (deg.get(a) || 0) || (a < b ? -1 : 1)).slice(0, n));
}

/**
 * Keyboard tree over the visible, laid-out ids. Inbox notes hang off the centre.
 * Siblings run clockwise: around the centre from the top gap, elsewhere across the parent's sector.
 */
export function buildNav(ids, pos) {
  const up = new Map(), kids = new Map();
  for (const id of ids) {
    if (id === ROOT || !pos.has(id)) continue;
    const p = id.startsWith("inbox/") ? ROOT : id.slice(0, id.lastIndexOf("/"));
    if (!ids.has(p) || !pos.has(p)) continue;
    up.set(id, p);
    (kids.get(p) ?? kids.set(p, []).get(p)).push(id);
  }
  const ang = (id) => (Math.atan2(pos.get(id).y, pos.get(id).x) * 180) / Math.PI;
  for (const [p, list] of kids) {
    const ref = p === ROOT ? -90 : ang(p) + 180;
    const key = (id) => Math.round(((((ang(id) - ref) % 360) + 360) % 360) * 10);
    list.sort((a, b) => key(a) - key(b) || (a < b ? -1 : 1));
  }
  return { up, kids };
}

/** Where an arrow key goes from id: ← → siblings (wrapping), ↑ parent, ↓ first child. Null if nowhere. */
export function step(nav, id, key) {
  if (key === "ArrowUp") return nav.up.get(id) ?? null;
  if (key === "ArrowDown") return nav.kids.get(id)?.[0] ?? null;
  const d = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  const sib = nav.kids.get(nav.up.get(id));
  if (!d || !sib || sib.length < 2) return null;
  return sib[(sib.indexOf(id) + d + sib.length) % sib.length];
}

const rad = (deg) => (deg * Math.PI) / 180;
// Azimuth turns in the screen plane (x right, y down) like the old bearings; elevation leans toward or away from the camera (z).
const dirOf = (az, el) => [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];

// Direction ρ away from d, at turn ψ around it.
function cone(d, rho, psi) {
  const ref = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let u = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const ul = Math.hypot(...u);
  u = u.map((c) => c / ul);
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const c = Math.cos(rho), s = Math.sin(rho), cp = Math.cos(psi), sp = Math.sin(psi);
  return [0, 1, 2].map((i) => d[i] * c + (u[i] * cp + v[i] * sp) * s);
}

/**
 * World positions on a sphere: centre at the origin, branches at r=115, projects in a ±0.42 rad cone around
 * their branch at r 175-210, deeper notes in a ±0.18 cone around their parent at r 225-265, inbox on an
 * equatorial arc at r=290. Tier 0 centre, 1 branch, 2 project, 3 deeper, 4 inbox. Orphans are left out.
 */
export function holoLayout(payload) {
  const ids = new Set(payload.nodes.map((n) => n.id));
  const pos = new Map(), dir = new Map(), kids = new Map();
  for (const id of [...ids].sort()) {
    if (id === ROOT || id.startsWith("inbox/") || !id.startsWith(`${ROOT}/`)) continue;
    const p = id.slice(0, id.lastIndexOf("/"));
    (kids.get(p) ?? kids.set(p, []).get(p)).push(id);
  }
  const put = (id, d, r, tier) => {
    dir.set(id, d);
    pos.set(id, { x: d[0] * r, y: d[1] * r, z: d[2] * r, tier });
  };
  if (!ids.has(ROOT)) return pos;
  pos.set(ROOT, { x: 0, y: 0, z: 0, tier: 0 });

  // Five 72° slots from the old bearings, then the five between them. Elevation alternates ±0.35 by slot.
  const slots = [...ORDER.map((_, k) => -54 + 72 * k), ...ORDER.map((_, k) => -18 + 72 * k)];
  const taken = new Set();
  const branches = kids.get(ROOT) || [];
  const slotOf = new Map();
  for (const id of branches) {
    const k = ORDER.indexOf(id.split("/")[1]);
    if (k >= 0) { slotOf.set(id, k); taken.add(k); }
  }
  for (const id of branches) {
    if (slotOf.has(id)) continue;
    // ponytail: ten slots; an eleventh unknown branch shares a seeded bearing. Add rings if that ever happens.
    const k = slots.findIndex((_, i) => !taken.has(i));
    if (k >= 0) taken.add(k);
    slotOf.set(id, k);
  }
  const walk = (parent, spread, r0, r1, tier) => {
    const list = kids.get(parent) || [];
    list.forEach((id, i) => {
      const rnd = seeded(id);
      const d = cone(dir.get(parent), spread * Math.sqrt((i + 0.5) / list.length), i * 2.39996 + rnd() * 0.3);
      put(id, d, r0 + (r1 - r0) * rnd(), tier);
      walk(id, 0.18, 225, 265, 3);
    });
  };
  for (const id of branches) {
    const k = slotOf.get(id);
    const az = k >= 0 ? slots[k] : seeded(id)() * 360;
    put(id, dirOf(rad(az), (k >= 0 ? k : 0) % 2 ? -0.35 : 0.35), 115, 1);
    walk(id, 0.42, 175, 210, 2);
  }

  const inbox = [...ids].filter((id) => id.startsWith("inbox/")).sort();
  inbox.forEach((id, i) => {
    const az = -120 + 60 * (inbox.length > 1 ? i / (inbox.length - 1) : 0.5);
    put(id, dirOf(rad(az), (seeded(id)() * 2 - 1) * 0.12), 290, 4);
  });
  return pos;
}

/**
 * Perspective projection: yaw about y, then pitch about x, camera CAM_D in front of the origin looking down +z.
 * cam {yaw, pitch, zoom, fit, cx, cy}. depth 0 is the back of the sphere, 1 the front.
 */
export const project = (p, cam) => projector(cam)(p.x, p.y, p.z);

// ---------- drawing helpers ----------

const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const bez = (a, b, t) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
function cubicBezier(x1, y1, x2, y2) {
  return (x) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (bez(x1, x2, m) < x) lo = m; else hi = m; }
    return bez(y1, y2, (lo + hi) / 2);
  };
}
const easeFly = cubicBezier(0.22, 1, 0.36, 1);
const wrapPi = (a) => a - TAU * Math.round(a / TAU);

const ell = (s, n = 18) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);
const fmtDeg = (r) => { const d = (r * 180) / Math.PI; return `${d < 0 ? "−" : ""}${Math.abs(d).toFixed(1)}°`; };
const branchOf = (id) => (id.startsWith("inbox/") ? "inbox" : id === ROOT ? null : id.split("/")[1]);

// ---------- renderer ----------

const states = new WeakMap();

/** Draw (or redraw with new data) the graph in container. Keeps camera, focus and loop across calls. */
export function renderGraph(container, payload, { focusId, onOpen, onPack } = {}) {
  let st = states.get(container);
  if (!st) states.set(container, (st = mount(container)));
  st.onOpen = onOpen;
  st.onPack = onPack;
  st.setData(payload, focusId);
}


function mount(container) {
  const rm = matchMedia("(prefers-reduced-motion: reduce)");
  const canvas = document.createElement("canvas");
  canvas.className = "graph";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-roledescription", "3D graph");
  canvas.setAttribute("aria-label", "Note graph. Arrow keys move between notes, Enter opens one, C adds it to the pack, F filters to its branch, Space flies to it, Shift and arrows orbit, plus and minus zoom, 0 or Escape resets.");
  const live = Object.assign(document.createElement("div"), { className: "sr-only" });
  live.setAttribute("aria-live", "polite");
  const ctx = canvas.getContext("2d");

  const st = {
    nodes: [], byId: new Map(), edges: [], adj: new Map(), vis: new Set(), nav: { up: new Map(), kids: new Map() },
    yaw: 0, pitch: 0, zoom: 1, idleT: 0, lastInput: -Infinity, tw: null,
    w: 0, h: 0, dpr: 1, raf: 0, last: 0, enterT0: null,
    focus: ROOT, lastFocusId: undefined, filter: null, stale: true, links: true,
    cand: null, candT: 0, hot: null, hl: 0, hLast: null, lockId: null, lockT0: 0, down: null,
    pulses: [], pulseAcc: 0, shock: null, data: null, branchDirs: [],
    scene: makeScene(), fonts: { mono: "monospace", sans: "sans-serif" },
  };

  // ---------- DOM HUD (real buttons over the canvas) ----------
  const hud = Object.assign(document.createElement("div"), { className: "hud" });
  const zoomOut = Object.assign(document.createElement("span"), { className: "hud-z" });
  const hbtn = (text, title, fn, pressed) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "hud-btn", title });
    b.append(text);
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", fn);
    return b;
  };
  const sep = () => Object.assign(document.createElement("span"), { className: "hud-sep" });
  const staleBtn = hbtn("Stale", "Show stale notes as hollow", () => { st.stale = !st.stale; toggles(); }, st.stale);
  const linksBtn = hbtn("Cross-links", "Show links between notes", () => { st.links = !st.links; toggles(); }, st.links);
  const centreBtn = hbtn("Re-centre", "Re-centre the graph", () => reset());
  centreBtn.append(Object.assign(document.createElement("kbd"), { textContent: "0" }));
  const chip = hbtn("", "Show every branch", () => setFilter(null));
  chip.classList.add("hud-chip");
  chip.hidden = true;
  hud.append(zoomOut, sep(), staleBtn, linksBtn, sep(), centreBtn, chip);
  container.replaceChildren(canvas, hud, live);

  function toggles() {
    staleBtn.setAttribute("aria-pressed", String(st.stale));
    linksBtn.setAttribute("aria-pressed", String(st.links));
    wake();
  }
  const branchTitle = (b) => st.byId.get(`${ROOT}/${b}`)?.title ?? b;
  function setFilter(b) {
    st.filter = b && st.byId.has(`${ROOT}/${b}`) ? b : null;
    st.vis = visibleIds(st.nodes, st.filter);
    const xy = new Map(st.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    st.nav = buildNav(st.vis, xy);
    chip.hidden = !st.filter;
    if (st.filter) {
      chip.style.setProperty("--chip", HUE[st.filter] ?? HOLO);
      chip.replaceChildren(branchTitle(st.filter), Object.assign(document.createElement("span"), { className: "x", textContent: "×" }));
      chip.setAttribute("aria-label", `Branch filter: ${branchTitle(st.filter)}. Show every branch`);
    }
    if (!st.vis.has(st.focus)) st.focus = ROOT;
    st.linkCount = st.edges.filter((e) => e.link && st.vis.has(e.a.id) && st.vis.has(e.b.id)).length;
    st.pulses = st.pulses.filter((p) => p.path.every((n) => st.vis.has(n.id)));
    measureHud();
    wake();
  }
  function measureHud() { st.hudW = hud.offsetWidth; st.hudH = hud.offsetHeight; }

  st.setData = (payload, focusId) => {
    const pos = holoLayout(payload), deg = degrees(payload.edges), today = new Date();
    const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    st.nodes = [];
    st.byId = new Map();
    for (const n of payload.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const br = branchOf(n.id), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(n.updated || "");
      const node = {
        id: n.id, title: n.title || n.id, tier: p.tier, x: p.x, y: p.y, z: p.z, br,
        hue: p.tier === 0 ? "#FFFFFF" : HUE[br] ?? HOLO, deg: deg.get(n.id) || 0,
        stale: staleLevel(n, today), pinned: !!n.pinned, sx: 0, sy: 0, s: 1, t: 0.5, r: 0, a: 0, ek: 0,
        updated: m ? m[0] : null, days: m ? Math.round((t0 - Date.UTC(+m[1], m[2] - 1, +m[3])) / DAY) : null,
      };
      node.hueStale = desat(node.hue);
      st.nodes.push(node);
      st.byId.set(n.id, node);
    }
    st.edges = [];
    st.adj = new Map(st.nodes.map((n) => [n.id, new Set()]));
    for (const e of payload.edges) {
      const a = st.byId.get(e.source), b = st.byId.get(e.target);
      if (!a || !b || a === b) continue;
      st.edges.push({ a, b, link: e.kind === "link", hue: (b.tier ? b : a).hue });
      st.adj.get(a.id).add(b.id);
      st.adj.get(b.id).add(a.id);
    }
    // Real counts for the branch tags and the HUD data panel.
    const branches = st.nodes.filter((n) => n.tier === 1), notes = st.nodes.filter((n) => n.tier !== 0);
    for (const b of branches) b.notes = st.nodes.filter((n) => n.id.startsWith(`${b.id}/`)).length;
    const rows = branches.map((b) => ({ br: b.br, name: b.title.toUpperCase(), hue: b.hue, count: b.notes + 1 }));
    rows.sort((a, b) => (ORDER.indexOf(a.br) + 1 || 99) - (ORDER.indexOf(b.br) + 1 || 99));
    const inbox = notes.filter((n) => n.tier === 4).length;
    if (inbox) rows.push({ br: "inbox", name: "INBOX", hue: HUE.inbox, count: inbox });
    st.data = { rows, total: notes.length, staleShare: notes.length ? notes.filter((n) => n.stale).length / notes.length : 0 };
    st.branchDirs = branches.map((b) => { const l = Math.hypot(b.x, b.y, b.z) || 1; return { br: b.br, hue: b.hue, x: b.x / l, y: b.y / l, z: b.z / l }; });

    if (focusId !== st.lastFocusId) {
      const first = st.lastFocusId === undefined, n = st.byId.get(focusId);
      st.lastFocusId = focusId;
      // A note opened elsewhere (sidebar, link, hash) flies the camera to it; the first load does not.
      if (n && focusId !== st.focus) { st.focus = focusId; if (!first) flyTo(n); }
    }
    if (!st.byId.has(st.focus)) st.focus = ROOT;
    if (st.hot && !st.byId.has(st.hot)) st.hot = null;
    setFilter(st.filter);
  };

  // ---------- camera ----------
  const fit = () => (0.84 * Math.min(st.w, st.h)) / 520; // f = 0.84·min(w, h) at zoom 1
  const reduced = () => rm.matches;
  function markInput() { st.lastInput = performance.now(); }
  function flyCam(to) {
    const from = { yaw: st.yaw, pitch: st.pitch, zoom: st.zoom };
    to = { yaw: st.yaw + wrapPi((to.yaw ?? st.yaw) - st.yaw), pitch: Math.max(-1.2, Math.min(1.2, to.pitch ?? st.pitch)), zoom: clampZoom(to.zoom ?? st.zoom) };
    st.tw = { from, to, t0: performance.now(), dur: reduced() ? 150 : 550 };
    markInput();
    wake();
  }
  function flyTo(n) {
    const yaw = Math.atan2(-n.x, -n.z);
    // A node near the centre has no "front" of its own: keep the yaw, just level the camera.
    const near = Math.hypot(n.x, n.y, n.z) < 1;
    flyCam({ yaw: near ? st.yaw : yaw, pitch: near ? 0 : Math.atan2(-n.y, Math.hypot(n.x, n.z)), zoom: Math.max(st.zoom, 1.35) });
  }
  function reset() {
    flyCam({ yaw: 0, pitch: 0, zoom: 1 });
  }
  const tw0 = () => st.tw?.to ?? st;
  const shock = (n) => { st.shock = { id: n.id, t0: performance.now() }; wake(); };

  // ---------- frame ----------
  const visible = () => container.isConnected && !document.hidden && st.w > 0 && st.h > 0;
  function wake() {
    if (st.raf || !visible()) return;
    st.last = performance.now();
    st.raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    st.raf = 0;
    if (!visible()) return;
    const dt = Math.min(0.05, Math.max(0, (now - st.last) / 1000));
    st.last = now;
    if (draw(now, dt)) st.raf = requestAnimationFrame(frame);
  }

  function drawEmpty() {
    const { w, h } = st;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = RETICLE;
    ctx.font = `500 11px ${st.fonts.mono}`;
    ctx.letterSpacing = "1.54px";
    ctx.fillText("NO NOTES YET", w / 2, h / 2 - 6);
    ctx.letterSpacing = "0px";
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = INK;
    ctx.font = `400 12.5px ${st.fonts.sans}`;
    ctx.fillText("Make one with the + New note button and it appears here.", w / 2, h / 2 + 16);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    return false; // nothing moves, so the loop stops
  }

  function spawnPulse(now) {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const firsts = (st.nav.kids.get(ROOT) || []).filter((id) => !id.startsWith("inbox/"));
    if (!firsts.length) return;
    const path = [st.byId.get(ROOT)];
    for (let id = pick(firsts); id; ) {
      path.push(st.byId.get(id));
      const kids = st.nav.kids.get(id);
      id = kids?.length && (path.length < 3 || Math.random() < 0.5) ? pick(kids) : null;
    }
    if (path.length > 2 || st.nav.kids.get(path[1].id) === undefined) st.pulses.push({ path, t0: now });
  }

  function draw(now, dt) {
    const { w, h } = st, rmo = reduced();
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const zt = `${Math.round(st.zoom * 100)}%`;
    if (zoomOut.textContent !== zt) zoomOut.textContent = zt;
    if (!st.nodes.length) return drawEmpty();
    if (st.enterT0 === null) st.enterT0 = rmo ? -Infinity : now;
    const el = now - st.enterT0, entering = el < 1000;

    // camera
    if (st.tw) {
      const k = Math.min(1, (now - st.tw.t0) / st.tw.dur), e = easeFly(k), { from, to } = st.tw;
      st.yaw = lerp(from.yaw, to.yaw, e);
      st.pitch = lerp(from.pitch, to.pitch, e);
      st.zoom = lerp(from.zoom, to.zoom, e);
      if (k >= 1) st.tw = null;
    } else if (!rmo && !st.down && now - st.lastInput > 4000) {
      st.yaw += 0.045 * dt;
      st.idleT += dt;
    }
    const cam = {
      yaw: st.yaw, pitch: Math.max(-1.2, Math.min(1.2, st.pitch + (rmo ? 0 : 0.03 * Math.sin((TAU * st.idleT) / 24)))),
      zoom: st.zoom, fit: fit(), cx: w / 2, cy: h / 2,
    };
    const P = projector(cam);

    // hover intent (45ms), then a 120ms ease-out
    if (st.cand !== st.hot && now - st.candT >= 45) st.hot = st.cand;
    const kb = document.activeElement === canvas && canvas.matches(":focus-visible");
    const H = st.hot ?? (kb ? st.focus : null);
    if (H) st.hLast = H;
    if (H && H !== st.lockId) { st.lockId = H; st.lockT0 = now; }
    if (!H && st.hl === 0) st.lockId = null;
    const hlTarget = H ? 1 : 0;
    st.hl = hlTarget > st.hl ? Math.min(1, st.hl + dt / 0.12) : Math.max(0, st.hl - dt / 0.12);
    if (dt === 0) st.hl = hlTarget; // a first or on-demand frame lands on the end state
    const hl = easeOutCubic(st.hl), HL = H ?? (hl > 0 ? st.hLast : null);
    const near = HL ? st.adj.get(HL) ?? new Set() : new Set();
    const dim = lerp(1, 0.25, hl);

    const m = Math.min(w, h), hk = rmo ? 1 : easeOutExpo(clamp01(el / 250));
    const ef = rmo ? 1 : clamp01((el - 600) / 400); // edges, tags and readouts
    drawBack(ctx, st.scene, { w, h, m, cam, P, now, rmo, k: hk, branchDirs: st.branchDirs.filter((b) => !st.filter || b.br === st.filter) });

    // HUD rings and the yaw ticks
    const sc = 0.92 + 0.08 * hk;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(sc, sc);
    ctx.strokeStyle = HOLO;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.12 * hk;
    for (const k of [0.42, 0.44]) { ctx.beginPath(); ctx.arc(0, 0, k * m, 0, TAU); ctx.stroke(); }
    const ro = 0.44 * m;
    for (const major of [false, true]) {
      ctx.globalAlpha = (major ? 0.3 : 0.15) * hk;
      ctx.beginPath();
      for (let i = 0; i < 72; i++) {
        if ((i % 6 === 0) !== major) continue;
        const a = (i * TAU) / 72 + cam.yaw, len = major ? 8 : 4, c = Math.cos(a), s = Math.sin(a);
        ctx.moveTo(c * ro, s * ro);
        ctx.lineTo(c * (ro + len), s * (ro + len));
      }
      ctx.stroke();
    }
    ctx.restore();

    // project nodes; on entrance each appears as the scan line passes its screen y
    const list = [];
    for (const n of st.nodes) {
      n.ek = 0;
      if (!st.vis.has(n.id)) continue;
      P(n.x, n.y, n.z, n);
      let ak = 1;
      if (!rmo && el < 1050) {
        const tn = 150 + 600 * clamp01(n.sy / h), u = el - tn;
        ak = clamp01(u / 120);
        if (ak <= 0) continue;
        const pk = 0.85 + 0.15 * easeOutCubic(clamp01(u / 300));
        if (pk < 1) P(n.x * pk, n.y * pk, n.z * pk, n);
      }
      n.t = n.depth;
      const lit = n.id === HL || near.has(n.id);
      n.da = (0.22 + 0.78 * n.t ** 1.4) * ak;
      n.a = n.da * (HL && !lit ? dim : 1);
      n.ek = ak;
      n.r = Math.max(1.5, nodeRadius(n.deg, n.tier) * n.s) * (n.id === HL ? 1 + 0.25 * hl : 1);
      list.push(n);
    }
    st.drawn = list;
    const staleOn = (n) => st.stale && n.stale && n.tier !== 0;

    // glow pass, additive, unsorted
    ctx.globalCompositeOperation = "lighter";
    for (const n of list) {
      if (n.tier === 0 || n.tier === 4 || staleOn(n)) continue;
      const [gr, ga] = n.tier === 1 ? [34, 0.16] : n.tier === 2 ? [16, 0.12] : [8, 0.08];
      stamp(ctx, n.hue, n.sx, n.sy, gr * n.s, ga * n.a);
    }
    ctx.globalCompositeOperation = "source-over";

    // edges: tree edges run parent hue to child hue; cross-links dashed curves through the inside
    if (ef > 0) {
      ctx.lineWidth = 1;
      for (const e of st.edges) {
        const { a, b } = e;
        if (e.link || !a.ek || !b.ek) continue;
        const hot = HL && (a.id === HL || b.id === HL);
        ctx.globalAlpha = ef * (hot ? lerp(0.22, 0.28, hl) : 0.22 * (HL ? dim : 1)) * (a.da + b.da) / 2;
        const g = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
        g.addColorStop(0, fog(a.hue, a.t));
        g.addColorStop(1, fog(b.hue, b.t));
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
      if (st.links) {
        ctx.lineWidth = 0.75;
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = HOLO;
        const c = {};
        for (const e of st.edges) {
          const { a, b } = e;
          if (!e.link || !a.ek || !b.ek) continue;
          const hot = HL && (a.id === HL || b.id === HL);
          P((a.x + b.x) * 0.41, (a.y + b.y) * 0.41, (a.z + b.z) * 0.41, c);
          ctx.globalAlpha = ef * (hot ? lerp(0.09, 0.55, hl) : 0.09 * ((a.da + b.da) / 2) * (HL ? dim : 1));
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.quadraticCurveTo(c.sx, c.sy, b.sx, b.sy);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // energy pulses: centre → branch → project (or deeper), 600ms an edge
    if (!rmo && !entering) {
      st.pulseAcc += dt * 3;
      for (; st.pulseAcc >= 1; st.pulseAcc--) if (st.pulses.length < 24) spawnPulse(now);
      ctx.globalCompositeOperation = "lighter";
      st.pulses = st.pulses.filter((p) => {
        const u0 = (now - p.t0) / 600, last = p.path.length - 1;
        if (u0 - 0.25 >= last) return false;
        for (let i = 5; i >= 0; i--) {
          const u = Math.min(last - 1e-6, u0 - i * 0.05);
          if (u < 0 || (i === 0 && u0 >= last)) continue;
          const k = Math.floor(u), f = u - k, a = p.path[k], b = p.path[k + 1];
          if (!a.ek || !b.ek) return false;
          const lit = !HL || a.id === HL || b.id === HL || near.has(b.id);
          const alpha = (i ? 0.5 * (1 - (i - 1) / 5) : 0.8) * lerp(a.da, b.da, f) * (lit ? 1 : dim);
          stamp(ctx, b.hue, lerp(a.sx, b.sx, f), lerp(a.sy, b.sy, f), 4.5 * lerp(a.s, b.s, f) * (i ? 0.8 : 1), alpha);
        }
        return true;
      });
      ctx.globalCompositeOperation = "source-over";
    } else if (rmo) st.pulses = [];

    // cores, back to front
    list.sort((a, b) => a.t - b.t);
    const showRet = st.focus !== ROOT || kb;
    const turn = rmo ? 0 : (0.8 * now) / 1000;
    for (const n of list) {
      const { sx, sy, r } = n, stale = staleOn(n), lit = n.id === HL && hl > 0;
      const hue = stale ? n.hueStale : n.hue, col = lit && hl > 0.5 ? "#FFFFFF" : fog(hue, n.t);
      const a = n.a * (stale ? 0.45 : 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      if (n.tier === 0) {
        drawCore(ctx, n, now, rmo, n.a);
      } else if (n.tier === 4) {
        ctx.strokeStyle = lit ? "#FFFFFF" : fog(HUE.inbox, n.t);
        ctx.beginPath();
        ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r, sy); ctx.lineTo(sx, sy + r); ctx.lineTo(sx - r, sy);
        ctx.closePath();
        ctx.stroke();
      } else if (stale) {
        if (n.stale === 2) ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1.25;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
      }
      if (n.tier === 1) drawBranchDeco(ctx, n, fog(hue, n.t), now, rmo, a);
      else if (n.tier === 2) {
        ctx.strokeStyle = fog(hue, n.t);
        ctx.lineWidth = 0.75;
        ctx.globalAlpha = a * 0.4;
        ctx.beginPath(); ctx.arc(sx, sy, 8 * n.s, 0, TAU); ctx.stroke();
      }
      if (n.pinned) {
        ctx.globalAlpha = n.ek * (HL && !(n.id === HL || near.has(n.id)) ? dim : 1);
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath(); ctx.arc(sx, sy, 2, 0, TAU); ctx.fill();
        ctx.strokeStyle = RETICLE;
        ctx.lineWidth = 1;
        ctx.globalAlpha *= 0.8;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(r + 2, 10 * n.s), 0, TAU); ctx.stroke();
      }
      // target lock on the hovered or keyboard-focused node; the open note keeps a still lock without the panel
      if (n.id === HL && hl > 0) {
        const d = rmo ? 8 : lerp(20, 8, easeOutCubic(clamp01((now - st.lockT0) / 140)));
        drawLock(ctx, sx, sy, r, d, hl, turn);
      } else if (n.id === st.focus && showRet) drawLock(ctx, sx, sy, r, 8, 0.9 * n.ek, 0);
    }

    // click shockwave
    let shockLive = false;
    if (st.shock) {
      const n = st.byId.get(st.shock.id);
      shockLive = !!n?.ek && drawShock(ctx, n, n.tier === 0 ? HOLO : n.hue, now - st.shock.t0, rmo);
      if (!shockLive) st.shock = null;
    }

    // labels: gated, at most 16, by priority then front first; a label that would overlap one placed is skipped
    const fitK = cam.fit;
    const pri = (n) => {
      if (n.id === HL && hl > 0.01) return 0;
      if (n.id === st.focus && showRet) return 1;
      if (n.tier === 1) return n.t >= 0.5 ? 2 : 9;
      if (near.has(n.id) && hl > 0.5) return 3;
      if (n.tier === 2 && n.s / fitK >= 0.85) return 4;
      return 9;
    };
    const boxes = [], placed = [];
    // The locked node's callout carries its title, so its panel is kept clear and it gets no second label.
    const L = HL && hl > 0 && st.byId.get(HL);
    if (L?.ek) boxes.push(calloutBox(L, w, h).box);
    const root = st.vis.has(ROOT) && st.byId.get(ROOT);
    if (root?.ek) {
      const y = root.sy + 29 * root.s + 15;
      boxes.push([root.sx - 40, y - 11, root.sx + 40, y + 3]);
    }
    const cands = [];
    for (const n of list) { const p = n.tier === 0 || (n === L && n.tier !== 1) ? 9 : pri(n); if (p < 9) cands.push([p, n]); }
    cands.sort((a, b) => a[0] - b[0] || b[1].t - a[1].t);
    for (const [, n] of cands) {
      let box, g = null;
      if (n.tier === 1) {
        const [nw, tw] = tagWidths(n);
        g = tagBox(n, w / 2, nw, tw, w);
        box = g.box;
      } else {
        const x = n.sx + n.r + 6;
        box = [x, n.sy - 8, x + labelWidth(n), n.sy + 8];
      }
      if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      placed.push([n, g]);
      if (placed.length >= 15) break; // 16 with the centre's own label
    }
    placed.sort((a, b) => a[0].t - b[0].t);
    for (const [n, g] of placed) {
      const lit = n.id === HL && hl > 0;
      const k = HL && !(lit || near.has(n.id)) ? dim : 1;
      if (g) drawTag(ctx, g, ell(n.title.toUpperCase()), `${n.notes} NOTES`, n.stale && st.stale ? n.hueStale : n.hue, Math.max(ef * n.ek * k, lit ? 1 : 0), st.fonts);
      else label(n, lit, k);
    }
    if (root?.ek) {
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = `500 11px ${st.fonts.mono}`;
      ctx.letterSpacing = "1.54px";
      const y = root.sy + 29 * root.s + 15, a = root.ek * (HL && HL !== ROOT && !near.has(ROOT) ? dim : 1);
      halo(ctx, root.title.toUpperCase(), root.sx, y, a);
      ctx.globalAlpha = a;
      ctx.fillStyle = RETICLE;
      ctx.fillText(root.title.toUpperCase(), root.sx, y);
      ctx.letterSpacing = "0px";
      ctx.textAlign = "left";
    }

    // the callout panel for the locked node sits over everything in the tank
    if (L?.ek) drawCallout(ctx, L, L.tier === 0 ? HOLO : L.hue, calloutInfo(L), hl * L.ek, w, h, st.fonts);

    // entrance scan line
    if (!rmo && el >= 150 && el <= 750) drawScan(ctx, w, (h * (el - 150)) / 600);

    // corner readouts and the data panel
    if (ef > 0) readouts(ef * 0.65, cam);
    if (ef > 0 && w >= 760 && st.data) drawData(ctx, 16, 40, { ...st.data, rows: st.data.rows.map((r) => ({ ...r, dim: !!st.filter && r.br !== st.filter })) }, ef, st.fonts);
    ctx.globalAlpha = 1;
    return !rmo || !!st.tw || entering || st.cand !== st.hot || st.hl !== hlTarget || shockLive;
  }

  function calloutInfo(n) {
    const where = n.tier === 0 ? "CENTRE" : n.br === "inbox" ? "INBOX" : branchTitle(n.br).toUpperCase();
    const meta = `${where} · ${n.deg} ${n.deg === 1 ? "LINK" : "LINKS"}`;
    const when = n.stale ? (n.days != null ? `STALE · ${n.days}D` : "STALE · NO DATE") : n.updated ? `UPDATED ${n.updated}` : "NO DATE";
    return { title: n.title, meta, when, stale: n.stale };
  }

  function tagWidths(n) {
    const key = st.fontGen || 0;
    if (n.twKey !== key) {
      ctx.font = `500 11px ${st.fonts.mono}`;
      ctx.letterSpacing = "0.88px";
      const a = ctx.measureText(ell(n.title.toUpperCase())).width;
      ctx.font = `400 9.5px ${st.fonts.mono}`;
      ctx.letterSpacing = "0.76px";
      n.tw = [a, ctx.measureText(`${n.notes} NOTES`).width];
      n.twKey = key;
      ctx.letterSpacing = "0px";
    }
    return n.tw;
  }
  function labelFont(n) {
    ctx.font = `400 ${n.tier >= 3 ? 10 : 11.5}px ${st.fonts.sans}`;
    ctx.letterSpacing = "0px";
    return ell(n.title);
  }
  function labelWidth(n) {
    const key = st.fontGen || 0;
    if (n.lwKey !== key) { n.lw = ctx.measureText(labelFont(n)).width; n.lwKey = key; }
    return n.lw;
  }
  function label(n, lit, k) {
    const text = labelFont(n), x = n.sx + n.r + 6, a = lit ? 1 : Math.max(0.72, n.da) * n.ek * k;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    halo(ctx, text, x, n.sy, a);
    ctx.globalAlpha = a;
    ctx.fillStyle = lit ? "#FFFFFF" : INK;
    ctx.fillText(text, x, n.sy);
  }

  function pathOf(id) {
    const out = [];
    for (let cur = id; cur; cur = cur === ROOT ? null : cur.startsWith("inbox/") ? ROOT : cur.slice(0, cur.lastIndexOf("/"))) {
      const n = st.byId.get(cur);
      if (n) out.unshift(n.title.toUpperCase());
    }
    if (id.startsWith("inbox/")) out.splice(1, 0, "INBOX");
    return out.join(" › ");
  }

  function readouts(alpha, cam) {
    const { w, h } = st, pad = 16;
    ctx.font = `400 10px ${st.fonts.mono}`;
    ctx.letterSpacing = "1.2px";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = RETICLE;
    ctx.globalAlpha = alpha;
    ctx.textAlign = "left";
    const tl = `GRAPH // ${st.vis.size} NODES · ${st.linkCount} LINKS`;
    ctx.fillText(tl, pad, pad + 8);
    const yawDeg = ((((cam.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const tr = `YAW ${yawDeg.toFixed(1)}° · PITCH ${fmtDeg(cam.pitch)}`;
    // In a narrow pane the camera readout drops below the count instead of running into it.
    const fits = ctx.measureText(tl).width + ctx.measureText(tr).width + 24 <= w - pad * 2;
    ctx.textAlign = fits ? "right" : "left";
    ctx.fillText(tr, fits ? w - pad : pad, fits ? pad + 8 : pad + 22);
    ctx.textAlign = "left";
    // Bottom left sits beside the DOM HUD; in a narrow pane it moves up a row and drops the legend.
    const room = w - pad - st.hudW - 12 - 16;
    const legend = "←→↑↓ MOVE · ↵ OPEN · ⇧←→ ORBIT · F FILTER · ESC RESET";
    const path = pathOf(st.hot ?? st.focus);
    const wide = ctx.measureText(legend).width <= room;
    const y0 = wide ? h - pad : h - 12 - st.hudH - 10;
    if (wide) ctx.fillText(legend, pad, y0);
    let p = path;
    const max = wide ? room : w - pad * 2;
    while (p.length > 4 && ctx.measureText(p).width > max) p = "…" + p.slice(2);
    ctx.fillText(p, pad, wide ? y0 - 14 : y0);
    ctx.letterSpacing = "0px";
  }

  // ---------- input ----------
  function hitTest(x, y) {
    let best = null;
    for (const n of st.drawn || []) {
      const d = Math.hypot(n.sx - x, n.sy - y);
      if (d <= n.r + 6 && (!best || n.t > best.t)) best = n;
    }
    return best;
  }
  const local = (e) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  function setCand(id) {
    if (id === st.cand) return;
    st.cand = id;
    st.candT = performance.now();
    wake();
  }

  canvas.addEventListener("mousedown", (e) => e.preventDefault()); // a click opens the note; it should not steal focus
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    const [x, y] = local(e);
    st.down = { x, y, px: x, py: y, drag: false, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = local(e), d = st.down;
    if (d) {
      if (!d.drag && Math.hypot(x - d.x, y - d.y) >= 4) {
        d.drag = true;
        canvas.style.cursor = ""; // let .orbiting's grabbing cursor show
        canvas.classList.add("orbiting");
        setCand(null);
      }
      if (d.drag) {
        st.tw = null;
        st.yaw += (x - d.px) * 0.006;
        st.pitch = Math.max(-1.2, Math.min(1.2, st.pitch + (y - d.py) * 0.006));
        d.px = x; d.py = y;
        markInput();
        wake();
      }
      return;
    }
    const n = hitTest(x, y);
    canvas.style.cursor = n ? "pointer" : "";
    setCand(n ? n.id : null);
  });
  const endDrag = (e) => {
    const d = st.down;
    if (!d) return;
    st.down = null;
    canvas.classList.remove("orbiting");
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (d.drag || e.type !== "pointerup") return;
    const n = hitTest(...local(e));
    if (!n) return;
    markInput();
    if (e.altKey && n.tier === 1) return setFilter(st.filter === n.br ? null : n.br);
    st.focus = n.id;
    shock(n);
    flyTo(n);
    st.onOpen?.(n.id, { keyboard: false });
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => { if (!st.down) setCand(null); });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    st.tw = null;
    st.zoom = clampZoom(st.zoom * Math.exp(-e.deltaY * 0.0015));
    markInput();
    wake();
  }, { passive: false });

  function announce(n) {
    const where = n.tier === 0 ? "centre" : n.tier === 1 ? "branch" : n.br === "inbox" ? "Inbox" : branchTitle(n.br);
    live.textContent = `${n.title}, ${where}, ${n.deg} ${n.deg === 1 ? "link" : "links"}`;
  }
  canvas.addEventListener("focus", () => { const n = st.byId.get(st.focus); if (n) announce(n); wake(); });
  canvas.addEventListener("blur", wake);
  canvas.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key, n = st.byId.get(st.focus), orbit = rad(15);
    if (k.startsWith("Arrow") && e.shiftKey) {
      const base = tw0();
      if (k === "ArrowLeft" || k === "ArrowRight") flyCam({ yaw: base.yaw + (k === "ArrowRight" ? orbit : -orbit), pitch: base.pitch, zoom: base.zoom });
      else flyCam({ yaw: base.yaw, pitch: base.pitch + (k === "ArrowDown" ? orbit : -orbit), zoom: base.zoom });
    } else if (k.startsWith("Arrow")) {
      const next = step(st.nav, st.focus, k);
      if (next) { st.focus = next; announce(st.byId.get(next)); }
      markInput();
      wake();
    } else if (k === "Enter" && n) { shock(n); flyTo(n); st.onOpen?.(n.id, { keyboard: true }); }
    else if ((k === "c" || k === "C") && n) st.onPack?.(n.id);
    else if ((k === "f" || k === "F") && n) {
      // The keyboard route to ⌥-click: filter to the focused note's branch, again (or from the centre) to clear.
      const b = n.br && n.br !== "inbox" ? n.br : null;
      if (!b && !st.filter) return;
      setFilter(b && st.filter !== b ? b : null);
      live.textContent = st.filter ? `Showing ${branchTitle(st.filter)} only` : "Showing every branch";
    } else if (k === " " && n) flyTo(n);
    else if (k === "+" || k === "=") { st.tw = null; st.zoom = clampZoom(st.zoom * 1.15); markInput(); wake(); }
    else if (k === "-" || k === "_") { st.tw = null; st.zoom = clampZoom(st.zoom / 1.15); markInput(); wake(); }
    else if (k === "Escape" && st.filter) { setFilter(null); live.textContent = "Showing every branch"; }
    else if (k === "0" || k === "Escape") reset();
    else return;
    e.preventDefault();
  });

  // ---------- size, visibility, fonts ----------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    st.dpr = Math.min(2, devicePixelRatio || 1);
    if (w === st.w && h === st.h && canvas.width === Math.round(w * st.dpr)) return wake();
    st.w = w; st.h = h;
    measureHud();
    canvas.width = Math.round(w * st.dpr);
    canvas.height = Math.round(h * st.dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (visible()) draw(performance.now(), 0); // setting the size clears the canvas; repaint now, not a frame later
    wake();
  }
  new ResizeObserver(resize).observe(container);
  // A window dragged to a screen with another pixel ratio resizes nothing, so watch the ratio itself.
  const watchDpr = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener("change", () => { resize(); watchDpr(); }, { once: true });
  watchDpr();
  document.addEventListener("visibilitychange", wake);
  rm.addEventListener("change", wake);
  const cs = getComputedStyle(document.documentElement);
  st.fonts = { mono: cs.getPropertyValue("--mono").trim() || "monospace", sans: cs.getPropertyValue("--sans").trim() || "sans-serif" };
  Promise.all(["400 10px", "500 11px", "400 9.5px"].map((f) => document.fonts.load(`${f} "Plex Mono"`)).concat(["400 11.5px", "400 12.5px"].map((f) => document.fonts.load(`${f} "Plex Sans"`))))
    .then(() => { st.fontGen = (st.fontGen || 0) + 1; if (visible() && !st.raf) draw(performance.now(), 0); }, () => {});
  return st;
}
