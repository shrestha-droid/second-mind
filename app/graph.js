// 3D holographic graph view (app-direction.md §Graph (3D holo tank)). Canvas 2D with its own perspective projection.
// Deterministic sphere layout from holoLayout, read-only. app.js calls renderGraph after every data refresh, so the
// canvas, camera and loop live per container and a call only swaps the data.

const ROOT = "shrestha";
const DAY = 864e5;
const TAU = Math.PI * 2;
const R_WORLD = 260, CAM_D = 680, FOCAL = 520;
const BEARING = { work: -54, college: 18, social: 90, competitions: 162, builds: 234 }; // degrees, clockwise, y down (as lib.js)
const ORDER = ["work", "college", "social", "competitions", "builds"];
const HUE = { work: "#E3B34C", college: "#58B8D6", social: "#E685A6", competitions: "#A98FF5", builds: "#5BC993", inbox: "#94A3B8" };
const HOLO = "#38BDF8", RETICLE = "#E0F2FE", CLEAR = "#05080F";
const ENTER_DELAY = [0, 80, 180, 280, 280]; // ms, by tier: centre, branch, project, deeper, inbox

// ---------- pure helpers (no DOM, tested in app/tests/graph.test.mjs) ----------

export const ZOOM_MIN = 0.4, ZOOM_MAX = 2.5;
export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
export const nodeRadius = (degree) => 4.5 + Math.min(3, 0.7 * Math.log(1 + degree));

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

// FNV-1a of the id seeds a Mulberry32 stream, so every node lands in the same place on every load.
function seeded(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
export function project(p, cam) {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const x1 = p.x * cy - p.z * sy, z1 = p.x * sy + p.z * cy;
  const y2 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
  const s = (FOCAL * (cam.zoom ?? 1) * (cam.fit ?? 1)) / (CAM_D + z2);
  const depth = Math.min(1, Math.max(0, (R_WORLD - z2) / (2 * R_WORLD)));
  return { sx: (cam.cx ?? 0) + x1 * s, sy: (cam.cy ?? 0) + y2 * s, s, depth };
}

// ---------- drawing helpers ----------

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
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

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const desat = (h) => { const c = rgb(h), l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; return toHex(c.map((v) => lerp(v, l, 0.5))); };
const BG = rgb(CLEAR);
const fogCache = new Map();
// Back half fades toward the clear colour; the ramp-in over t 0.4-0.5 keeps nodes from popping at the halfway line.
function fog(h, t) {
  const q = Math.round(t * 20), key = h + q;
  let c = fogCache.get(key);
  if (!c) {
    const tq = q / 20, k = tq < 0.5 ? (1 - tq) * 0.65 * Math.min(1, (0.5 - tq) * 10) : 0;
    c = toHex(rgb(h).map((v, i) => lerp(v, BG[i], k)));
    fogCache.set(key, c);
  }
  return c;
}
const sprites = new Map();
function sprite(h) {
  let c = sprites.get(h);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d"), [r, gr, b] = rgb(h), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${r},${gr},${b},1)`);
  grad.addColorStop(0.3, `rgba(${r},${gr},${b},.45)`);
  grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprites.set(h, c);
  return c;
}
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
  canvas.setAttribute("aria-label", "Note graph. Arrow keys move between notes, Enter opens one, C adds it to the pack, Space flies to it, Shift and arrows orbit, plus and minus zoom, 0 or Escape resets.");
  const live = Object.assign(document.createElement("div"), { className: "sr-only" });
  live.setAttribute("aria-live", "polite");
  const ctx = canvas.getContext("2d");

  const st = {
    nodes: [], byId: new Map(), edges: [], adj: new Map(), vis: new Set(), nav: { up: new Map(), kids: new Map() },
    yaw: 0, pitch: 0, zoom: 1, idleT: 0, lastInput: -Infinity, tw: null,
    w: 0, h: 0, dpr: 1, raf: 0, last: 0, enterT0: null,
    focus: ROOT, lastFocusId: undefined, filter: null, stale: true, links: true,
    cand: null, candT: 0, hot: null, hl: 0, hLast: null, down: null,
    particles: [], fonts: { mono: "monospace", sans: "sans-serif" },
  };

  // Ambient particles: fixed seed, outside the node shell.
  const pr = seeded("particles");
  for (let i = 0; i < 40; i++) {
    const r = 320 + 100 * pr(), az = pr() * TAU, el = Math.asin(pr() * 2 - 1) * 0.8;
    st.particles.push({ r, az, el, a: 0.08 + 0.06 * pr(), w: (0.01 + 0.02 * pr()) * (pr() < 0.5 ? -1 : 1) });
  }

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
    measureHud();
    wake();
  }
  function measureHud() { st.hudW = hud.offsetWidth; st.hudH = hud.offsetHeight; }

  st.setData = (payload, focusId) => {
    const pos = holoLayout(payload), deg = degrees(payload.edges), today = new Date();
    st.nodes = [];
    st.byId = new Map();
    for (const n of payload.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const br = branchOf(n.id);
      const node = {
        id: n.id, title: n.title || n.id, tier: p.tier, x: p.x, y: p.y, z: p.z, br,
        hue: p.tier === 0 ? "#FFFFFF" : HUE[br] ?? HOLO, deg: deg.get(n.id) || 0,
        stale: staleLevel(n, today), pinned: !!n.pinned, sx: 0, sy: 0, s: 1, t: 0.5, r: 0, a: 0,
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
    if (focusId !== st.lastFocusId) {
      st.lastFocusId = focusId;
      if (focusId && st.byId.has(focusId)) st.focus = focusId;
    }
    if (!st.byId.has(st.focus)) st.focus = ROOT;
    if (st.hot && !st.byId.has(st.hot)) st.hot = null;
    setFilter(st.filter);
  };

  // ---------- camera ----------
  const fit = () => (Math.min(st.w, st.h) * 0.4) / 245; // the node shell projects to ~245px at fit 1
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

  function draw(now, dt) {
    const { w, h } = st, rmo = reduced();
    if (st.enterT0 === null && st.nodes.length) st.enterT0 = rmo ? -Infinity : now;
    const el = st.enterT0 === null ? 0 : now - st.enterT0;
    const entering = el < 900;

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
    if (!rmo) for (const p of st.particles) p.az += p.w * dt;
    const cam = {
      yaw: st.yaw, pitch: Math.max(-1.2, Math.min(1.2, st.pitch + (rmo ? 0 : 0.03 * Math.sin((TAU * st.idleT) / 24)))),
      zoom: st.zoom, fit: fit(), cx: w / 2, cy: h / 2,
    };

    // hover intent (45ms), then a 120ms ease-out
    if (st.cand !== st.hot && now - st.candT >= 45) st.hot = st.cand;
    const kb = document.activeElement === canvas && canvas.matches(":focus-visible");
    const H = st.hot ?? (kb ? st.focus : null);
    if (H) st.hLast = H;
    const hlTarget = H ? 1 : 0;
    st.hl = hlTarget > st.hl ? Math.min(1, st.hl + dt / 0.12) : Math.max(0, st.hl - dt / 0.12);
    if (dt === 0) st.hl = hlTarget; // a first or on-demand frame lands on the end state
    const hl = easeOutCubic(st.hl), HL = H ?? (hl > 0 ? st.hLast : null);
    const near = HL ? st.adj.get(HL) ?? new Set() : new Set();
    const dim = lerp(1, 0.25, hl);
    const zt = `${Math.round(st.zoom * 100)}%`;
    if (zoomOut.textContent !== zt) zoomOut.textContent = zt;

    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // HUD rings and the yaw ticks
    const m = Math.min(w, h), hk = rmo ? 1 : easeOutExpo(clamp01(el / 250)), sc = 0.92 + 0.08 * hk;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(sc, sc);
    ctx.strokeStyle = HOLO;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.12 * hk;
    for (const k of [0.42, 0.44]) { ctx.beginPath(); ctx.arc(0, 0, k * m, 0, TAU); ctx.stroke(); }
    const ro = 0.44 * m;
    for (let i = 0; i < 72; i++) {
      const a = (i * TAU) / 72 + cam.yaw, major = i % 6 === 0, len = major ? 8 : 4, c = Math.cos(a), s = Math.sin(a);
      ctx.globalAlpha = (major ? 0.3 : 0.15) * hk;
      ctx.beginPath();
      ctx.moveTo(c * ro, s * ro);
      ctx.lineTo(c * (ro + len), s * (ro + len));
      ctx.stroke();
    }
    ctx.restore();

    // particles
    ctx.fillStyle = HOLO;
    for (const p of st.particles) {
      const d = dirOf(p.az, p.el), q = project({ x: d[0] * p.r, y: d[1] * p.r, z: d[2] * p.r }, cam);
      ctx.globalAlpha = p.a * hk;
      ctx.fillRect(Math.round(q.sx), Math.round(q.sy), 1, 1);
    }

    // project nodes (entrance flies them out from the origin)
    const list = [];
    for (const n of st.nodes) {
      if (!st.vis.has(n.id)) continue;
      const ek = rmo ? 1 : easeOutCubic(clamp01((el - 150 - ENTER_DELAY[n.tier]) / 370));
      if (ek <= 0) continue;
      const q = project({ x: n.x * ek, y: n.y * ek, z: n.z * ek }, cam);
      n.sx = q.sx; n.sy = q.sy; n.s = q.s; n.t = q.depth;
      const lit = n.id === HL || near.has(n.id);
      n.da = (0.22 + 0.78 * q.depth ** 1.4) * ek;
      n.a = n.da * (HL && !lit ? dim : 1);
      n.ek = ek;
      const base = n.tier === 0 ? 9 : n.tier === 1 ? 6.5 : n.tier === 2 ? 4 + Math.min(2, 0.5 * Math.log(1 + n.deg)) : n.tier === 3 ? 2.2 : 3;
      n.r = Math.max(1.5, base * q.s) * (n.id === HL ? 1 + 0.25 * hl : 1);
      list.push(n);
    }
    st.drawn = list;
    const staleOn = (n) => st.stale && n.stale && n.tier !== 0;

    // glow pass, additive, unsorted
    ctx.globalCompositeOperation = "lighter";
    for (const n of list) {
      if (n.tier === 0 || n.tier === 4 || staleOn(n)) continue;
      const [gr, ga] = n.tier === 1 ? [28, 0.16] : n.tier === 2 ? [16, 0.12] : [8, 0.08];
      const R = gr * n.s;
      ctx.globalAlpha = ga * n.a;
      ctx.drawImage(sprite(n.hue), n.sx - R, n.sy - R, R * 2, R * 2);
    }
    ctx.globalCompositeOperation = "source-over";

    // edges
    const ef = rmo ? 1 : clamp01((el - 450) / 450);
    if (ef > 0) {
      ctx.lineWidth = 1;
      for (const e of st.edges) {
        if (e.link || !e.a.ek || !e.b.ek || !st.vis.has(e.a.id) || !st.vis.has(e.b.id)) continue;
        const hot = HL && (e.a.id === HL || e.b.id === HL);
        ctx.globalAlpha = ef * (hot ? lerp(0.22, 0.28, hl) : 0.22 * (HL ? dim : 1)) * (e.a.da + e.b.da) / 2;
        ctx.strokeStyle = e.hue;
        ctx.beginPath();
        ctx.moveTo(e.a.sx, e.a.sy);
        ctx.lineTo(e.b.sx, e.b.sy);
        ctx.stroke();
      }
      if (st.links) {
        ctx.lineWidth = 0.75;
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = HOLO;
        for (const e of st.edges) {
          if (!e.link || !e.a.ek || !e.b.ek || !st.vis.has(e.a.id) || !st.vis.has(e.b.id)) continue;
          const hot = HL && (e.a.id === HL || e.b.id === HL);
          const c = project({ x: (e.a.x + e.b.x) * 0.41, y: (e.a.y + e.b.y) * 0.41, z: (e.a.z + e.b.z) * 0.41 }, cam);
          ctx.globalAlpha = ef * (hot ? lerp(0.09, 0.55, hl) : 0.09 * ((e.a.da + e.b.da) / 2) * (HL ? dim : 1));
          ctx.beginPath();
          ctx.moveTo(e.a.sx, e.a.sy);
          ctx.quadraticCurveTo(c.sx, c.sy, e.b.sx, e.b.sy);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // labels: at most 16, by priority, then front first
    const showRet = st.focus !== ROOT || kb;
    const pri = (n) => {
      if (n.id === HL && hl > 0.01) return 0;
      if (near.has(n.id) && hl > 0.01) return 1;
      if (n.id === st.focus && showRet) return 2;
      if (n.tier === 1) return 3;
      if (n.tier === 2) return 4;
      return 9;
    };
    // Greedy placement in priority order: a label that would overlap one already placed is skipped.
    const labelled = new Set(), boxes = [];
    for (const [, n] of list.map((n) => [pri(n), n]).filter(([p]) => p < 9).sort((a, b) => a[0] - b[0] || b[1].t - a[1].t)) {
      if (labelled.size === 16) break;
      const x = n.sx + n.r + 6, x2 = x + labelWidth(n), y = n.sy - 7, y2 = n.sy + 7;
      if (boxes.some((b) => x < b[2] && x2 > b[0] && y < b[3] && y2 > b[1])) continue;
      boxes.push([x, y, x2, y2]);
      labelled.add(n);
    }

    // cores and labels, back to front
    list.sort((a, b) => a.t - b.t);
    ctx.lineJoin = "round";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const spin = rmo ? 0 : (-0.12 * now) / 1000;
    for (const n of list) {
      const { sx, sy, s, r } = n, stale = staleOn(n), lit = n.id === HL && hl > 0;
      const hue = stale ? n.hueStale : n.hue, col = lit && hl > 0.5 ? "#FFFFFF" : fog(hue, n.t);
      const a = n.a * (stale ? 0.45 : 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      if (n.tier === 4) {
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
      if (n.tier === 0) {
        ctx.strokeStyle = HOLO;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 16 * s, 0, TAU); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = spin * 24 * s;
        ctx.globalAlpha = a * 0.6;
        ctx.beginPath(); ctx.arc(sx, sy, 24 * s, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      } else if (n.tier === 1 || n.tier === 2) {
        ctx.strokeStyle = fog(hue, n.t);
        ctx.lineWidth = n.tier === 1 ? 1 : 0.75;
        ctx.globalAlpha = a * (n.tier === 1 ? 0.6 : 0.4);
        ctx.beginPath(); ctx.arc(sx, sy, (n.tier === 1 ? 12 : 8) * s, 0, TAU); ctx.stroke();
      }
      if (n.pinned) {
        ctx.globalAlpha = n.ek * (HL && !(n.id === HL || near.has(n.id)) ? dim : 1);
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath(); ctx.arc(sx, sy, 2, 0, TAU); ctx.fill();
        ctx.strokeStyle = RETICLE;
        ctx.globalAlpha *= 0.8;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(r + 2, 10 * s), 0, TAU); ctx.stroke();
      }
      if (lit && st.hot === n.id) corners(sx, sy, r + 8, hl);
      if (n.id === st.focus && showRet) {
        ctx.globalAlpha = 0.9 * n.ek;
        ctx.strokeStyle = RETICLE;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(sx, sy, r + 8, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (!st.hot || st.hot === n.id) corners(sx, sy, r + 8, 1);
      }
      if (labelled.has(n)) label(n, r, lit, a);
    }

    // corner readouts
    if (ef > 0) readouts(ef * 0.65, cam);
    ctx.globalAlpha = 1;
    return !rmo || st.tw || entering || st.cand !== st.hot || st.hl !== hlTarget;
  }

  function corners(x, y, d, k) {
    ctx.globalAlpha = k;
    ctx.strokeStyle = RETICLE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(x + sx * d, y + sy * (d - 4));
      ctx.lineTo(x + sx * d, y + sy * d);
      ctx.lineTo(x + sx * (d - 4), y + sy * d);
    }
    ctx.stroke();
  }

  function labelFont(n) {
    const branch = n.tier === 1;
    ctx.font = branch ? `500 11px ${st.fonts.mono}` : `400 ${n.tier >= 3 ? 10 : 11}px ${st.fonts.sans}`;
    ctx.letterSpacing = branch ? "0.88px" : "0px";
    return ell(branch ? n.title.toUpperCase() : n.title);
  }
  function labelWidth(n) {
    const key = st.fontGen || 0;
    if (n.lwKey !== key) { n.lw = ctx.measureText(labelFont(n)).width; n.lwKey = key; }
    return n.lw;
  }
  function label(n, r, lit, a) {
    const branch = n.tier === 1, text = labelFont(n), x = n.sx + r + 6;
    ctx.globalAlpha = Math.max(a, lit ? 1 : 0);
    ctx.lineWidth = 3;
    ctx.strokeStyle = CLEAR;
    ctx.strokeText(text, x, n.sy);
    ctx.fillStyle = lit ? "#FFFFFF" : branch ? fog(n.hue, n.t) : n.tier === 0 ? "#FFFFFF" : fog("#CBD5E1", n.t);
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
    const legend = "←→↑↓ MOVE · ↵ OPEN · ⇧←→ ORBIT · ESC RESET";
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
      if (!d.drag && Math.hypot(x - d.x, y - d.y) >= 4) { d.drag = true; canvas.classList.add("orbiting"); setCand(null); }
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
    } else if (k === "Enter" && n) { flyTo(n); st.onOpen?.(n.id, { keyboard: true }); }
    else if ((k === "c" || k === "C") && n) st.onPack?.(n.id);
    else if (k === " " && n) flyTo(n);
    else if (k === "+" || k === "=") { st.tw = null; st.zoom = clampZoom(st.zoom * 1.15); markInput(); wake(); }
    else if (k === "-" || k === "_") { st.tw = null; st.zoom = clampZoom(st.zoom / 1.15); markInput(); wake(); }
    else if (k === "Escape" && st.filter) setFilter(null);
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
  document.addEventListener("visibilitychange", wake);
  rm.addEventListener("change", wake);
  const cs = getComputedStyle(document.documentElement);
  st.fonts = { mono: cs.getPropertyValue("--mono").trim() || "monospace", sans: cs.getPropertyValue("--sans").trim() || "sans-serif" };
  Promise.all(["400 10px", "500 11px"].map((f) => document.fonts.load(`${f} "Plex Mono"`)).concat(document.fonts.load('400 11px "Plex Sans"')))
    .then(() => { st.fontGen = (st.fontGen || 0) + 1; if (visible() && !st.raf) draw(performance.now(), 0); }, () => {});
  return st;
}
