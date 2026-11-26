// WebGL galaxy view of the note graph. Lazy-loaded by graph.js; never imported by Node tests.
import * as THREE from "./vendor/three/three.module.js";
import { EffectComposer } from "./vendor/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "./vendor/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./vendor/three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "./vendor/three/addons/postprocessing/OutputPass.js";
import { ROOT, DAY, ORDER, galaxyLayout, buildNav, step, visibleIds, degrees, staleLevel, clampZoom, labelPriority, placeLabels, labelCap, branchOf, wrapPi, easeFly, ell, rad, nodeRadius } from "./graph.js";
import { HUE, HOLO, CLEAR, seeded, TAU, lerp, clamp01 } from "./graph-draw.js";

const SEG = 12, NPULSE = 24, FOV = 50;
const VS = `attribute vec3 aColor; attribute float aSize, aAlpha, aRing; uniform float uPx;
varying vec3 vC; varying float vA, vR;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx / max(1.0, -mv.z); vC = aColor; vA = aAlpha; vR = aRing; }`;
const FS = `varying vec3 vC; varying float vA, vR;
void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p); if (d > 1.0) discard;
  float glow = exp(-d * 5.0), ring = smoothstep(0.42, 0.5, d) * (1.0 - smoothstep(0.5, 0.6, d));
  float a = mix(glow, ring * 1.4 + glow * 0.25, vR) * vA; gl_FragColor = vec4(vC * a, a); }`;

function palette() {
  const cs = getComputedStyle(document.documentElement), v = (k, d) => cs.getPropertyValue(k).trim() || d;
  const hue = {};
  for (const b of Object.keys(HUE)) hue[b] = new THREE.Color(v(`--hue-${b}`, HUE[b]));
  return { holo: new THREE.Color(v("--holo", HOLO)), core: new THREE.Color(v("--core", "#FFFFFF")), bg: new THREE.Color(v("--void", CLEAR)), hue };
}

export function mount(container) {
  const rm = matchMedia("(prefers-reduced-motion: reduce)");
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  const canvas = renderer.domElement;
  canvas.className = "graph";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-roledescription", "3D graph");
  canvas.setAttribute("aria-label", "Note graph. Arrow keys move between notes, Enter opens one, C adds it to the pack, F filters to its branch, Space flies to it, Shift and arrows orbit, plus and minus zoom, 0 or Escape resets.");
  const div = (className, extra) => Object.assign(document.createElement("div"), { className, ...extra });
  const live = div("sr-only");
  live.setAttribute("aria-live", "polite");
  const labels = div("gl-labels"), ret = div("gl-ret", { hidden: true });
  labels.setAttribute("aria-hidden", "true");
  labels.append(ret);
  const empty = div("gl-empty", { hidden: true });
  empty.append(div("gl-empty-h", { textContent: "NO NOTES YET" }), div("gl-empty-p", { textContent: "Make one with the + New note button and it appears here." }));

  const st = {
    nodes: [], byId: new Map(), edges: [], adj: new Map(), vis: new Set(), nav: { up: new Map(), kids: new Map() },
    cam: { yaw: 0, pitch: 0.55, zoom: 1, tx: 0, ty: 0, tz: 0 }, tw: null, base: 640, w: 0, h: 0,
    focus: ROOT, lastFocusId: undefined, filter: null, stale: true, links: true, hot: null, hLast: null, hl: 0,
    down: null, lastInput: -Infinity, raf: 0, last: 0, tour: null, shock: null, swooped: false, pulses: [],
  };

  // ---------- HUD ----------
  const hud = div("hud"), zoomOut = Object.assign(document.createElement("span"), { className: "hud-z" });
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
  const tourBtn = hbtn("Tour", "Fly from branch to branch", () => (st.tour ? stopTour() : startTour()), false);
  const centreBtn = hbtn("Re-centre", "Re-centre the graph", () => { markInput(); reset(); });
  centreBtn.append(Object.assign(document.createElement("kbd"), { textContent: "0" }));
  const chip = hbtn("", "Show every branch", () => setFilter(null));
  chip.classList.add("hud-chip");
  chip.hidden = true;
  hud.append(zoomOut, sep(), staleBtn, linksBtn, tourBtn, sep(), centreBtn, chip);
  container.replaceChildren(canvas, labels, empty, hud, live);
  const measureHud = () => { st.hudW = hud.offsetWidth; st.hudH = hud.offsetHeight; };
  const syncTourBtn = () => { tourBtn.hidden = rm.matches; tourBtn.setAttribute("aria-pressed", String(!!st.tour)); };
  syncTourBtn();

  // ---------- three ----------
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.0011);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 6000);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.55, 0.12);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const px = { value: 1 }, world = new THREE.Group(), stars = new THREE.Group();
  scene.add(world, stars);
  let pal = palette(), G = {};
  const ptMat = () => new THREE.ShaderMaterial({ uniforms: { uPx: px }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const lineMat = (opacity) => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  function points(list) {
    const n = list.length, g = new THREE.BufferGeometry();
    const P = new Float32Array(n * 3), C = new Float32Array(n * 3), S = new Float32Array(n), A = new Float32Array(n), R = new Float32Array(n);
    list.forEach((o, i) => { P.set(o.p, i * 3); C.set([o.c.r, o.c.g, o.c.b], i * 3); S[i] = o.s; A[i] = o.a; R[i] = o.ring || 0; });
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(C, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(S, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(A, 1));
    g.setAttribute("aRing", new THREE.BufferAttribute(R, 1));
    return new THREE.Points(g, ptMat());
  }
  const dispose = (grp) => { grp.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); grp.clear(); };
  const colorOf = (n) => (n.tier === 0 ? pal.core : pal.hue[n.br] ?? pal.holo);
  const qAt = (q, t, out) => {
    const u = 1 - t;
    return out.set(u * u * q[0].x + 2 * u * t * q[1].x + t * t * q[2].x, u * u * q[0].y + 2 * u * t * q[1].y + t * t * q[2].y, u * u * q[0].z + 2 * u * t * q[1].z + t * t * q[2].z);
  };

  function build() {
    pal = palette();
    scene.background = pal.bg.clone();
    scene.fog.color.copy(pal.bg);
    dispose(world); dispose(stars);
    const white = new THREE.Color("#FFFFFF");
    let rnd = seeded("stars"), list = [];
    for (let i = 0; i < 2500; i++) {
      const u = rnd() * 2 - 1, ph = rnd() * TAU, r = 900 + rnd() * 1300, s = Math.sqrt(1 - u * u);
      list.push({ p: [r * s * Math.cos(ph), r * u, r * s * Math.sin(ph)], c: white.clone().lerp(pal.holo, rnd() * 0.5), s: 3 + rnd() * 5, a: 0.35 + rnd() * 0.55 });
    }
    stars.add(points(list));
    rnd = seeded("nebula");
    list = [0, 1, 2, 3].map((k) => { const a = k * 1.7 + rnd(); return { p: [520 * Math.cos(a), -160 + rnd() * 240, 520 * Math.sin(a)], c: k % 2 ? pal.holo : (pal.hue[ORDER[k]] ?? pal.holo), s: 1500, a: 0.07 }; });
    stars.add(points(list));
    // spiral-arm dust in each branch's hue
    list = [];
    const g3 = (r) => (r() + r() + r() - 1.5) / 1.5;
    for (const b of st.nodes.filter((n) => n.tier === 1)) {
      const th0 = Math.atan2(b.z, b.x), c = colorOf(b);
      rnd = seeded(`dust:${b.id}`);
      for (let i = 0; i < 600; i++) {
        const r = 40 + rnd() ** 0.8 * 360, th = th0 + 0.45 * Math.log(Math.max(r, 20) / 110) + g3(rnd) * 0.28;
        list.push({ p: [r * Math.cos(th), g3(rnd) * 9, r * Math.sin(th)], c, s: 2 + rnd() * 4, a: 0.2 + rnd() * 0.4 });
      }
    }
    if (list.length) world.add(G.dust = points(list));
    const grid = new THREE.PolarGridHelper(340, 10, 6, 64, pal.holo, pal.holo);
    grid.position.y = -40;
    grid.material.transparent = true; grid.material.opacity = 0.13; grid.material.depthWrite = false;
    world.add(grid);
    // edges: quadratic curves, tree low, links lifted
    const tree = [], link = [];
    for (const e of st.edges) {
      const a = new THREE.Vector3(e.a.x, e.a.y, e.a.z), b = new THREE.Vector3(e.b.x, e.b.y, e.b.z), len = a.distanceTo(b);
      const c = a.clone().add(b).multiplyScalar(0.5);
      c.y += e.link ? len * 0.35 + 20 : len * 0.12;
      e.q = [a, c, b];
      const arr = e.link ? link : tree, v = new THREE.Vector3();
      e.off = arr.length / 3;
      for (let s = 0; s < SEG; s++) { arr.push(...qAt(e.q, s / SEG, v).toArray(), ...qAt(e.q, (s + 1) / SEG, v).toArray()); }
    }
    const lines = (arr, op) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(arr.length), 3));
      return new THREE.LineSegments(g, lineMat(op));
    };
    world.add(G.tree = lines(tree, 0.85), G.link = lines(link, 0.9));
    // nodes + halos
    G.nodes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial(), Math.max(1, st.nodes.length));
    G.nodes.count = st.nodes.length;
    world.add(G.nodes);
    for (const n of st.nodes) { n.col = colorOf(n).clone(); n.colStale = n.col.clone().lerp(new THREE.Color(0x808080), 0.55).multiplyScalar(0.6); }
    world.add(G.halo = points(st.nodes.map((n) => ({ p: [n.x, n.y, n.z], c: n.col, s: n.r * (n.tier === 0 ? 9 : 7), a: 0 }))));
    // core rings, pulses, shock
    const ring = (r0, r1, op) => { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 128), new THREE.MeshBasicMaterial({ color: pal.holo, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); m.rotation.x = -Math.PI / 2; return m; };
    G.rings = [ring(16, 16.6, 0.8), ring(25, 25.3, 0.45), ring(60, 60.4, 0.18)];
    G.rings[1].rotation.y = 0.3;
    world.add(...G.rings);
    world.add(G.pulse = points(Array.from({ length: NPULSE }, () => ({ p: [0, 0, 0], c: pal.holo, s: 10, a: 0 }))));
    G.shock = ring(0.9, 1, 0);
    world.add(G.shock);
    st.pulses = [];
  }

  const M = new THREE.Matrix4(), V = new THREE.Vector3(), CC = new THREE.Color();
  function paint() {
    if (!G.nodes) return;
    const hot = st.hl > 0.01 ? st.hLast : null, nb = hot ? st.adj.get(hot) : null;
    const dim = (id) => (!hot || id === hot || nb?.has(id) ? 1 : lerp(1, 0.16, st.hl));
    const hc = G.halo.geometry.attributes, hcol = hc.aColor.array;
    st.nodes.forEach((n, i) => {
      const on = st.vis.has(n.id), s = on ? n.r * (n.tier === 0 ? 1.5 : 1.3) : 0, stale = st.stale && n.stale > 0;
      G.nodes.setMatrixAt(i, M.makeScale(s, s, s).setPosition(n.x, n.y, n.z));
      CC.copy(stale ? n.colStale : n.col).multiplyScalar(dim(n.id) * (n.id === hot ? 1.8 : n.id === st.focus ? 1.3 : 1));
      G.nodes.setColorAt(i, CC);
      CC.copy(n.col).multiplyScalar(dim(n.id));
      hcol.set([CC.r, CC.g, CC.b], i * 3);
      hc.aAlpha.array[i] = on ? (n.id === hot ? 0.95 : 0.55) * dim(n.id) : 0;
      hc.aRing.array[i] = stale ? 1 : 0;
    });
    G.nodes.instanceMatrix.needsUpdate = true;
    if (G.nodes.instanceColor) G.nodes.instanceColor.needsUpdate = true;
    hc.aColor.needsUpdate = hc.aAlpha.needsUpdate = hc.aRing.needsUpdate = true;
    const ca = new THREE.Color(), cb = new THREE.Color();
    for (const e of st.edges) {
      const arr = (e.link ? G.link : G.tree).geometry.attributes.color.array, on = st.vis.has(e.a.id) && st.vis.has(e.b.id);
      const k = !on ? 0 : !hot || e.a.id === hot || e.b.id === hot ? (hot ? 1.6 : 1) : lerp(1, 0.1, st.hl);
      if (e.link) { ca.copy(pal.holo).multiplyScalar(0.9 * k); cb.copy(ca); }
      else { ca.copy(e.a.col).multiplyScalar(0.35 * k); cb.copy(e.b.col).multiplyScalar(0.6 * k); }
      for (let s = 0; s < SEG; s++) for (let j = 0; j < 2; j++) {
        CC.copy(ca).lerp(cb, (s + j) / SEG);
        arr.set([CC.r, CC.g, CC.b], (e.off + s * 2 + j) * 3);
      }
    }
    G.tree.geometry.attributes.color.needsUpdate = G.link.geometry.attributes.color.needsUpdate = true;
    G.link.visible = st.links;
  }

  // ---------- state ----------
  function toggles() {
    staleBtn.setAttribute("aria-pressed", String(st.stale));
    linksBtn.setAttribute("aria-pressed", String(st.links));
    paint(); wake();
  }
  const branchTitle = (b) => st.byId.get(`${ROOT}/${b}`)?.title ?? b;
  function setFilter(b) {
    st.filter = b && st.byId.has(`${ROOT}/${b}`) ? b : null;
    st.vis = visibleIds(st.nodes, st.filter);
    st.nav = buildNav(st.vis, new Map(st.nodes.map((n) => [n.id, { x: n.x, y: n.z }])));
    chip.hidden = !st.filter;
    if (st.filter) {
      chip.style.setProperty("--chip", "#" + (pal.hue[st.filter] ?? pal.holo).getHexString());
      chip.replaceChildren(branchTitle(st.filter), Object.assign(document.createElement("span"), { className: "x", textContent: "×" }));
      chip.setAttribute("aria-label", `Branch filter: ${branchTitle(st.filter)}. Show every branch`);
    }
    if (!st.vis.has(st.focus)) st.focus = ROOT;
    st.pulses = [];
    measureHud(); paint(); wake();
  }
  const tw0 = () => st.tw?.to ?? st.cam;
  function flyCam(to) {
    st.tw = { from: { ...st.cam }, to: { ...st.cam, ...to }, t0: performance.now(), dur: rm.matches ? 150 : 900 };
    wake();
  }
  function flyTo(n) {
    const c = st.cam, yaw = n.tier === 0 ? c.yaw : Math.atan2(n.x, n.z);
    flyCam({ yaw: c.yaw + wrapPi(yaw - c.yaw), pitch: n.tier === 0 ? 0.55 : 0.35, zoom: Math.max(c.zoom, n.tier === 0 ? 1 : 1.8), tx: n.x, ty: n.y, tz: n.z });
  }
  const reset = () => flyCam({ yaw: st.cam.yaw + wrapPi(-st.cam.yaw), pitch: 0.55, zoom: 1, tx: 0, ty: 0, tz: 0 });
  function startTour() {
    if (rm.matches) return;
    st.tour = { i: -1, next: 0 };
    syncTourBtn(); wake();
  }
  function stopTour() { if (st.tour) { st.tour = null; syncTourBtn(); } }
  function markInput() { st.lastInput = performance.now(); stopTour(); }
  function shock(n) { st.shock = { n, t0: performance.now() }; wake(); }
  function announce(n) {
    const where = n.tier === 0 ? "centre" : n.tier === 1 ? "branch" : n.br === "inbox" ? "Inbox" : branchTitle(n.br);
    live.textContent = `${n.title}, ${where}, ${n.deg} ${n.deg === 1 ? "link" : "links"}`;
  }
  function setHot(id) {
    if (id === st.hot) return;
    st.hot = id;
    if (id) st.hLast = id;
    canvas.style.cursor = id ? "pointer" : "";
    wake();
  }

  st.setData = (payload, focusId) => {
    const pos = galaxyLayout(payload), deg = degrees(payload.edges), today = new Date();
    const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    st.nodes = []; st.byId = new Map();
    for (const n of payload.nodes) {
      const p = pos.get(n.id); if (!p) continue;
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(n.updated || ""), d = deg.get(n.id) || 0;
      const node = { id: n.id, title: n.title || n.id, tier: p.tier, x: p.x, y: p.y, z: p.z, br: branchOf(n.id), deg: d,
        r: nodeRadius(d, p.tier), stale: staleLevel(n, today), pinned: !!n.pinned, sx: 0, sy: 0, pr: 0, s: 1, t: 0.5, front: false,
        updated: m ? m[0] : null, days: m ? Math.round((t0 - Date.UTC(+m[1], m[2] - 1, +m[3])) / DAY) : null };
      st.nodes.push(node); st.byId.set(n.id, node);
    }
    st.edges = []; st.adj = new Map(st.nodes.map((n) => [n.id, new Set()]));
    for (const e of payload.edges) {
      const a = st.byId.get(e.source), b = st.byId.get(e.target);
      if (!a || !b || a === b) continue;
      st.edges.push({ a, b, link: e.kind === "link" });
      st.adj.get(a.id).add(b.id); st.adj.get(b.id).add(a.id);
    }
    build();
    empty.hidden = st.nodes.length > 0;
    if (!st.nodes.length) live.textContent = "No notes yet";
    if (focusId !== st.lastFocusId) {
      const first = st.lastFocusId === undefined, n = st.byId.get(focusId);
      st.lastFocusId = focusId;
      if (n && focusId !== st.focus) {
        if (st.filter && !visibleIds(st.nodes, st.filter).has(focusId)) { st.filter = null; live.textContent = "Showing every branch"; }
        st.focus = focusId;
        if (!first) flyTo(n);
      }
    }
    if (!st.byId.has(st.focus)) st.focus = ROOT;
    if (st.hot && !st.byId.has(st.hot)) st.hot = null;
    if (st.hLast && !st.byId.has(st.hLast)) { st.hLast = null; st.hl = 0; }
    setFilter(st.filter);
    if (!st.swooped && st.nodes.length) {
      st.swooped = true;
      if (!rm.matches) { Object.assign(st.cam, { yaw: -0.9, pitch: 1.2, zoom: 0.4 }); st.tw = { from: { ...st.cam }, to: { ...st.cam, yaw: 0, pitch: 0.55, zoom: 1 }, t0: performance.now(), dur: 2200 }; }
    }
  };

  // ---------- frame ----------
  const pool = [];
  function frame(now) {
    st.raf = 0;
    const dt = Math.min(0.05, (now - st.last) / 1000 || 0), c = st.cam, motion = !rm.matches;
    st.last = now;
    if (st.tw) {
      const k = Math.min(1, (now - st.tw.t0) / st.tw.dur), e = easeFly(k);
      for (const key in st.tw.to) c[key] = lerp(st.tw.from[key], st.tw.to[key], e);
      if (k >= 1) st.tw = null;
    }
    if (st.tour && now >= st.tour.next) {
      const bs = ORDER.map((b) => st.byId.get(`${ROOT}/${b}`)).filter((n) => n && st.vis.has(n.id));
      if (bs.length) { st.tour.i = (st.tour.i + 1) % bs.length; const n = bs[st.tour.i]; st.focus = n.id; flyTo(n); announce(n); }
      st.tour.next = now + 3200;
    }
    if (motion && !st.tw && !st.down && !st.tour && now - st.lastInput > 4000) c.yaw += 0.04 * dt;
    const want = st.hot ? 1 : 0;
    if (st.hl !== want) { st.hl = clamp01(st.hl + (want ? dt : -dt) / 0.12); paint(); }
    const dist = st.base / c.zoom, cp = Math.cos(c.pitch);
    camera.position.set(c.tx + dist * cp * Math.sin(c.yaw), c.ty + dist * Math.sin(c.pitch), c.tz + dist * cp * Math.cos(c.yaw));
    camera.lookAt(c.tx, c.ty, c.tz);
    camera.updateMatrixWorld();
    zoomOut.textContent = `${Math.round(c.zoom * 100)}%`;
    if (motion) {
      stars.rotation.y += dt * 0.006;
      if (G.dust) G.dust.rotation.y += dt * 0.01;
      G.rings?.forEach((r, i) => { r.rotation.z += dt * (0.25 - i * 0.18); });
      pulses(dt);
    }
    if (st.shock) {
      const age = (now - st.shock.t0) / 800, n = st.shock.n;
      if (age >= 1) { st.shock = null; G.shock.material.opacity = 0; }
      else { G.shock.position.set(n.x, n.y, n.z); G.shock.lookAt(camera.position); G.shock.scale.setScalar(n.r * 1.5 + age * 40); G.shock.material.opacity = 0.9 * (1 - age); }
    }
    project(dist);
    composer.render();
    if (!document.hidden && (motion || st.tw || st.hl !== want || st.shock)) st.raf = requestAnimationFrame(frame);
  }
  function pulses(dt) {
    if (!G.pulse) return;
    const tree = st.edges.filter((e) => !e.link && st.vis.has(e.a.id) && st.vis.has(e.b.id));
    const a = G.pulse.geometry.attributes;
    for (let i = 0; i < NPULSE; i++) {
      let p = st.pulses[i];
      if (!p || p.t >= 1) {
        if (!tree.length) { a.aAlpha.array[i] = 0; continue; }
        p = st.pulses[i] = { e: tree[(Math.random() * tree.length) | 0], t: p ? 0 : Math.random(), v: 0.35 + Math.random() * 0.4 };
        a.aColor.array.set([p.e.b.col.r, p.e.b.col.g, p.e.b.col.b], i * 3);
      }
      p.t += dt * p.v;
      qAt(p.e.q, Math.min(1, p.t), V);
      a.position.array.set([V.x, V.y, V.z], i * 3);
      a.aAlpha.array[i] = Math.sin(Math.PI * Math.min(1, p.t)) * 0.9;
    }
    a.position.needsUpdate = a.aAlpha.needsUpdate = a.aColor.needsUpdate = true;
  }
  function project(dist) {
    const { w, h } = st, upx = h / (2 * Math.tan(rad(FOV / 2)));
    for (const n of st.nodes) {
      const d = camera.position.distanceTo(V.set(n.x, n.y, n.z));
      V.project(camera);
      n.front = V.z < 1 && st.vis.has(n.id);
      n.sx = ((V.x + 1) * w) / 2; n.sy = ((1 - V.y) * h) / 2;
      n.pr = (n.r * 1.3 * upx) / d; n.s = st.base / d; n.t = clamp01((dist * 1.6 - d) / (dist * 1.2));
    }
    const focused = document.activeElement === canvas, near = st.hLast ? st.adj.get(st.hLast) : null, cands = [];
    for (const n of st.nodes) {
      if (!n.front) continue;
      const p = labelPriority(n, { hover: st.hLast, hl: st.hl, focus: st.focus, showRet: focused, near, fit: 1, compact: w < 600 });
      if (p >= 9) continue;
      const text = ell(n.title, n.tier === 1 ? 24 : 18), x = n.sx + n.pr + 6;
      cands.push({ n, p, text, box: [x, n.sy - 9, x + text.length * 7 + 16, n.sy + 9] });
    }
    cands.sort((a, b) => a.p - b.p || b.n.t - a.n.t);
    const out = placeLabels(cands, { cap: labelCap(w), reserved: [[w - (st.hudW || 0) - 24, h - (st.hudH || 0) - 24, w, h]] });
    out.forEach((c, i) => {
      const el = pool[i] ?? (pool[i] = labels.appendChild(Object.assign(document.createElement("span"), { className: "gl-label" })));
      if (el.textContent !== c.text) el.textContent = c.text;
      el.hidden = false;
      el.classList.toggle("b", c.n.tier <= 1);
      el.style.color = "#" + c.n.col.getHexString();
      el.style.opacity = String(c.p === 0 ? 1 : 0.55 + 0.45 * c.n.t);
      el.style.transform = `translate3d(${c.box[0].toFixed(1)}px,${(c.box[1]).toFixed(1)}px,0)`;
    });
    for (let i = out.length; i < pool.length; i++) pool[i].hidden = true;
    const f = st.byId.get(st.focus);
    ret.hidden = !(focused && f?.front);
    if (!ret.hidden) { const s = Math.max(14, f.pr * 2 + 12); Object.assign(ret.style, { width: `${s}px`, height: `${s}px`, transform: `translate3d(${f.sx - s / 2}px,${f.sy - s / 2}px,0)`, color: "#" + f.col.getHexString() }); }
  }
  function wake() { if (!st.raf && !document.hidden && st.w) { st.last = performance.now(); st.raf = requestAnimationFrame(frame); } }

  // ---------- input ----------
  function pick(x, y) {
    let best = null;
    for (const n of st.nodes) {
      if (!n.front) continue;
      const d = Math.hypot(n.sx - x, n.sy - y);
      if (d < n.pr + 6 && (!best || n.t > best.t)) best = n;
    }
    return best;
  }
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener("mousedown", (e) => e.preventDefault()); // a click opens the note; it should not steal focus
  canvas.addEventListener("pointerdown", (e) => {
    st.down = { x: e.clientX, y: e.clientY, yaw: st.cam.yaw, pitch: st.cam.pitch, drag: false };
    canvas.setPointerCapture?.(e.pointerId);
    markInput();
  });
  canvas.addEventListener("pointermove", (e) => {
    const d = st.down;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.drag && Math.hypot(dx, dy) > 4) { d.drag = true; st.tw = null; canvas.classList.add("orbiting"); setHot(null); }
      if (d.drag) { st.cam.yaw = d.yaw - dx * 0.006; st.cam.pitch = Math.min(1.4, Math.max(-1.1, d.pitch + dy * 0.006)); markInput(); wake(); }
      return;
    }
    setHot(pick(...local(e))?.id ?? null);
  });
  const endDrag = (e) => {
    const d = st.down;
    st.down = null;
    canvas.classList.remove("orbiting");
    if (!d || d.drag || e.type === "pointercancel") return;
    const n = pick(...local(e));
    if (!n) return;
    if (e.altKey && n.tier === 1) {
      setFilter(st.filter === n.br ? null : n.br);
      live.textContent = st.filter ? `Showing ${branchTitle(st.filter)} only` : "Showing every branch";
      return;
    }
    st.focus = n.id; shock(n); flyTo(n); paint();
    st.onOpen?.(n.id, { keyboard: false });
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => { if (!st.down) setHot(null); });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    st.tw = null;
    st.cam.zoom = clampZoom(st.cam.zoom * Math.exp(-e.deltaY * 0.0015));
    markInput(); wake();
  }, { passive: false });
  canvas.addEventListener("focus", () => { const n = st.byId.get(st.focus); if (n) announce(n); wake(); });
  canvas.addEventListener("blur", wake);
  canvas.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key, n = st.byId.get(st.focus), orbit = rad(15);
    markInput();
    if (k.startsWith("Arrow") && e.shiftKey) {
      const b = tw0();
      if (k === "ArrowLeft" || k === "ArrowRight") flyCam({ yaw: b.yaw + (k === "ArrowRight" ? orbit : -orbit) });
      else flyCam({ pitch: Math.min(1.4, Math.max(-1.1, b.pitch + (k === "ArrowDown" ? orbit : -orbit))) });
    } else if (k.startsWith("Arrow")) {
      const next = step(st.nav, st.focus, k);
      if (next) { st.focus = next; announce(st.byId.get(next)); paint(); }
      wake();
    } else if (k === "Enter" && n) { shock(n); flyTo(n); st.onOpen?.(n.id, { keyboard: true }); }
    else if ((k === "c" || k === "C") && n) st.onPack?.(n.id);
    else if ((k === "f" || k === "F") && n) {
      const b = n.br && n.br !== "inbox" ? n.br : null;
      if (!b && !st.filter) return;
      setFilter(b && st.filter !== b ? b : null);
      live.textContent = st.filter ? `Showing ${branchTitle(st.filter)} only` : "Showing every branch";
    } else if (k === " " && n) flyTo(n);
    else if (k === "+" || k === "=") { st.tw = null; st.cam.zoom = clampZoom(st.cam.zoom * 1.15); wake(); }
    else if (k === "-" || k === "_") { st.tw = null; st.cam.zoom = clampZoom(st.cam.zoom / 1.15); wake(); }
    else if (k === "Escape" && st.filter) { setFilter(null); live.textContent = "Showing every branch"; }
    else if (k === "0" || k === "Escape") reset();
    else return;
    e.preventDefault();
  });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    st.w = w; st.h = h;
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    px.value = (h * dpr) / (2 * Math.tan(rad(FOV / 2)));
    st.base = Math.max(640, 380 / (Math.tan(rad(FOV / 2)) * camera.aspect));
    measureHud(); wake();
  }
  new ResizeObserver(resize).observe(container);
  new MutationObserver(() => { build(); setFilter(st.filter); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-accent", "data-theme"] });
  document.addEventListener("visibilitychange", wake);
  rm.addEventListener("change", () => { stopTour(); syncTourBtn(); wake(); });
  return st;
}
