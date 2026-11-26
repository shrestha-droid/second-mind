// Draw layers for the 3D holo graph (app-direction.md §Graph, "v2 look"). graph.js owns state, camera and input;
// this file only paints. Canvas 2D, glow from pre-rendered sprites, never shadowBlur or CSS filter.

export const TAU = Math.PI * 2;
export const R_WORLD = 260, CAM_D = 680, FOCAL = 520;
export const HUE = { work: "#E3B34C", college: "#58B8D6", social: "#E685A6", competitions: "#A98FF5", builds: "#5BC993", inbox: "#94A3B8" };
export const HOLO = "#38BDF8", RETICLE = "#E0F2FE", CLEAR = "#05080F", INK = "#F1F5F9";

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;

// FNV-1a of the string seeds a Mulberry32 stream: same string, same numbers, every load.
export function seeded(str) {
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

/**
 * Perspective projector for one camera {yaw, pitch, zoom, fit, cx, cy, dist}: yaw about y, pitch about x,
 * camera `dist` (default CAM_D) in front of the origin looking down +z. Writes {sx, sy, s, depth} into o.
 */
export function projector(cam) {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const f = FOCAL * (cam.zoom ?? 1) * (cam.fit ?? 1), ox = cam.cx ?? 0, oy = cam.cy ?? 0, dist = cam.dist ?? CAM_D;
  return (x, y, z, o = {}) => {
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    const s = f / (dist + z2);
    o.sx = ox + x1 * s;
    o.sy = oy + y2 * s;
    o.s = s;
    o.depth = Math.min(1, Math.max(0, (R_WORLD - z2) / (2 * R_WORLD)));
    return o;
  };
}

// ---------- colour and sprites ----------

export const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
export const desat = (h) => { const c = rgb(h), l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; return toHex(c.map((v) => lerp(v, l, 0.5))); };
const rgbaCache = new Map();
export function rgba(h, a) {
  const key = h + a;
  let c = rgbaCache.get(key);
  if (!c) rgbaCache.set(key, (c = `rgba(${rgb(h).join(",")},${a})`));
  return c;
}
const BG = rgb(CLEAR);
const fogCache = new Map();
// Back half fades toward the clear colour; the ramp-in over t 0.4-0.5 keeps nodes from popping at the halfway line.
export function fog(h, t) {
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
/** A size×size radial glow in hue, made once and stamped with drawImage. */
export function sprite(h, size = 64, mid = 0.45) {
  const key = h + size;
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d"), r = size / 2, grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, rgba(h, 1));
  grad.addColorStop(0.3, rgba(h, mid));
  grad.addColorStop(1, rgba(h, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  sprites.set(key, c);
  return c;
}
export function stamp(ctx, h, x, y, R, a) {
  if (a <= 0.003 || R <= 0) return;
  ctx.globalAlpha = a;
  ctx.drawImage(sprite(h), x - R, y - R, R * 2, R * 2);
}

// ---------- back layers: vignette, starfield, nebulae, floor grid, wireframe globe ----------

export function makeScene() {
  const r = seeded("stars"), stars = [];
  for (let i = 0; i < 220; i++) {
    const R = 900 + 500 * r(), az = r() * TAU, el = Math.asin(r() * 2 - 1);
    stars.push({
      x: Math.cos(el) * Math.cos(az) * R, y: Math.sin(el) * R, z: Math.cos(el) * Math.sin(az) * R,
      size: 0.5 + 0.7 * r(), a: 0.2 + 0.45 * r(), tw: r() < 0.12 ? { w: TAU / (3 + 4 * r()), ph: r() * TAU } : null,
    });
  }
  const ring = (rr, y, seg) => { const a = new Float32Array((seg + 1) * 3); for (let i = 0; i <= seg; i++) { const t = (i / seg) * TAU; a.set([rr * Math.cos(t), y, rr * Math.sin(t)], i * 3); } return a; };
  const grid = [];
  for (let rr = 100; rr <= 500; rr += 100) grid.push(ring(rr, 330, 64));
  for (let k = 0; k < 24; k++) {
    const t = (k / 24) * TAU, c = Math.cos(t), s = Math.sin(t), a = new Float32Array(15);
    for (let i = 0; i < 5; i++) a.set([(100 + 100 * i) * c, 330, (100 + 100 * i) * s], i * 3); // split so depth fades along it
    grid.push(a);
  }
  const G = 300, lat = [], mer = [];
  for (const d of [-60, -30, 0, 30, 60]) {
    const e = (d * Math.PI) / 180;
    lat.push({ pts: ring(G * Math.cos(e), -G * Math.sin(e), 48), eq: d === 0 });
  }
  // ponytail: 12 meridians; the budget's third cut is 8 if frames run short.
  for (let k = 0; k < 12; k++) {
    const t = (k / 12) * TAU, a = new Float32Array(49 * 3);
    for (let i = 0; i <= 48; i++) { const e = -Math.PI / 2 + (i / 48) * Math.PI; a.set([G * Math.cos(e) * Math.cos(t), G * Math.sin(e), G * Math.cos(e) * Math.sin(t)], i * 3); }
    mer.push(a);
  }
  return { stars, grid, lat, mer, vig: null, vigKey: "" };
}

// Strokes polylines split into alpha buckets by depth, one path per bucket.
const tmpA = {}, tmpB = {};
function bucketed(ctx, lines, P, n, bucketOf) {
  const paths = Array.from({ length: n }, () => new Path2D());
  for (const pts of lines) {
    let prev = -1;
    P(pts[0], pts[1], pts[2], tmpA);
    for (let i = 3; i < pts.length; i += 3) {
      P(pts[i], pts[i + 1], pts[i + 2], tmpB);
      const b = bucketOf((tmpA.depth + tmpB.depth) / 2);
      if (b !== prev) paths[b].moveTo(tmpA.sx, tmpA.sy);
      paths[b].lineTo(tmpB.sx, tmpB.sy);
      prev = b;
      tmpA.sx = tmpB.sx; tmpA.sy = tmpB.sy; tmpA.depth = tmpB.depth;
    }
  }
  return paths;
}
const depthAlpha = (t) => 0.22 + 0.78 * t ** 1.4;

/** V: {w, h, m, cam, P, now, rmo, k (entrance), branchDirs:[{hue,x,y,z}]} */
export function drawBack(ctx, scene, V) {
  const { w, h, P, now, rmo, k } = V;
  // vignette (the doc's 0.55·max(w,h) read as 0.55 of the centre-to-corner distance, so it shows at every size)
  const hd = Math.hypot(w, h) / 2, vk = `${w}x${h}`;
  if (scene.vigKey !== vk) {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0.55 * hd, w / 2, h / 2, hd);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.25)");
    scene.vig = g;
    scene.vigKey = vk;
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = scene.vig;
  ctx.fillRect(0, 0, w, h);

  // stars: a shell seen from outside at a slower yaw and pitch, so they drift behind the graph
  const cam = V.cam, SP = projector({ ...cam, yaw: cam.yaw * 0.35, pitch: cam.pitch * 0.35, zoom: 1, dist: 1500 });
  ctx.fillStyle = "#CBD5E1";
  const q = {}, sec = now / 1000;
  for (const s of scene.stars) {
    SP(s.x, s.y, s.z, q);
    if (q.sx < -2 || q.sy < -2 || q.sx > w + 2 || q.sy > h + 2) continue;
    ctx.globalAlpha = s.a * k * (s.tw && !rmo ? 0.55 + 0.45 * Math.sin(s.tw.w * sec + s.tw.ph) : 1);
    ctx.fillRect(q.sx - s.size / 2, q.sy - s.size / 2, s.size, s.size);
  }

  // nebulae, one per branch, additive
  ctx.globalCompositeOperation = "lighter";
  const R = 0.35 * V.m;
  for (const b of V.branchDirs) {
    P(b.x * 200, b.y * 200, b.z * 200, q);
    ctx.globalAlpha = 0.075 * k;
    ctx.drawImage(sprite(b.hue, 256, 0.35), q.sx - R, q.sy - R, R * 2, R * 2);
  }
  ctx.globalCompositeOperation = "source-over";

  // floor grid, four depth buckets
  ctx.strokeStyle = HOLO;
  ctx.lineWidth = 1;
  const gp = bucketed(ctx, scene.grid, P, 4, (t) => Math.min(3, Math.floor(t * 4)));
  gp.forEach((p, i) => { ctx.globalAlpha = 0.1 * depthAlpha((i + 0.5) / 4) * k; ctx.stroke(p); });

  // wireframe globe: back half, front half, and the equator a little brighter
  const half = (t) => (t >= 0.5 ? 1 : 0);
  const [mb, mf] = bucketed(ctx, [...scene.mer, ...scene.lat.filter((l) => !l.eq).map((l) => l.pts)], P, 2, half);
  const [eb, ef] = bucketed(ctx, scene.lat.filter((l) => l.eq).map((l) => l.pts), P, 2, half);
  ctx.globalAlpha = 0.055 * k; ctx.stroke(mb);
  ctx.globalAlpha = 0.08 * k; ctx.stroke(eb);
  ctx.globalAlpha = 0.12 * k; ctx.stroke(mf);
  ctx.globalAlpha = 0.18 * k; ctx.stroke(ef);
}

// ---------- nodes ----------

/** The centre as a reactor: pulsing glow, white core, three counter-turning arc rings. */
export function drawCore(ctx, n, now, rmo, a) {
  const { sx, sy, s } = n, sec = rmo ? 0 : now / 1000;
  ctx.globalCompositeOperation = "lighter";
  stamp(ctx, HOLO, sx, sy, 40 * s, (rmo ? 0.27 : 0.27 - 0.05 * Math.cos((TAU * now) / 3200)) * a);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = a;
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath(); ctx.arc(sx, sy, n.r, 0, TAU); ctx.fill();
  ctx.strokeStyle = HOLO;
  const A = 0.35 * sec;
  ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7 * a;
  ctx.beginPath(); ctx.arc(sx, sy, 16 * s, A, A + (300 * Math.PI) / 180); ctx.stroke();
  const B = -0.22 * sec, b = (110 * Math.PI) / 180;
  ctx.lineWidth = 1; ctx.globalAlpha = 0.4 * a;
  ctx.beginPath(); ctx.arc(sx, sy, 22 * s, B, B + b); ctx.stroke();
  ctx.beginPath(); ctx.arc(sx, sy, 22 * s, B + Math.PI, B + Math.PI + b); ctx.stroke();
  ctx.globalAlpha = 0.3 * a;
  ctx.setLineDash([2, 3]);
  const C = 0.08 * sec;
  ctx.beginPath(); ctx.arc(sx, sy, 29 * s, C, C + TAU); ctx.stroke();
  ctx.setLineDash([]);
}

/** A branch: four-point flare and an orbit ring carrying one bright arc. The core is drawn by the caller. */
export function drawBranchDeco(ctx, n, hue, now, rmo, a) {
  const { sx, sy, s } = n;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5 * a;
  for (const [dx, dy] of [[26 * s, 0], [0, 18 * s]]) {
    const g = ctx.createLinearGradient(sx - dx, sy - dy, sx + dx, sy + dy);
    g.addColorStop(0, rgba(hue, 0));
    g.addColorStop(0.5, rgba(hue, 1));
    g.addColorStop(1, rgba(hue, 0));
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.moveTo(sx - dx, sy - dy); ctx.lineTo(sx + dx, sy + dy); ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = hue;
  ctx.globalAlpha = 0.65 * a;
  ctx.beginPath(); ctx.arc(sx, sy, 14 * s, 0, TAU); ctx.stroke();
  const t = rmo ? -Math.PI / 4 : (0.5 * now) / 1000;
  ctx.globalAlpha = 0.9 * a;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(sx, sy, 14 * s, t, t + Math.PI / 3); ctx.stroke();
  ctx.lineWidth = 1;
}

// ---------- labels ----------

/** Geometry of a branch tag: leader 45° up and outward 14px, then a run as wide as its text (28px at least). */
export function tagBox(n, cx, nameW, notesW, w = Infinity) {
  const d0 = 14 * n.s + 1, k = Math.SQRT1_2, run = Math.max(28, Math.max(nameW, notesW) + 6), out = d0 * k + 14 * k + run;
  let side = n.sx >= cx ? 1 : -1;
  // Outward from the centre, unless that runs off the tank and the other side fits.
  if (side > 0 ? n.sx + out > w - 8 && n.sx - out >= 8 : n.sx - out < 8 && n.sx + out <= w - 8) side = -side;
  const x0 = n.sx + side * d0 * k, y0 = n.sy - d0 * k, ex = x0 + side * 14 * k, ey = y0 - 14 * k;
  const x2 = ex + side * run;
  return { side, x0, y0, ex, ey, x2, box: [Math.min(ex, x2) - 2, ey - 15, Math.max(ex, x2) + 2, ey + 13] };
}

export function drawTag(ctx, g, name, notes, hue, a, F) {
  const { side, x0, y0, ex, ey, x2 } = g;
  ctx.globalAlpha = 0.7 * a;
  ctx.strokeStyle = hue;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.lineTo(x2, ey); ctx.stroke();
  ctx.fillStyle = hue;
  ctx.beginPath(); ctx.arc(ex, ey, 2, 0, TAU); ctx.fill();
  const tx = side > 0 ? ex + 3 : ex - 3;
  ctx.textAlign = side > 0 ? "left" : "right";
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 11px ${F.mono}`;
  ctx.letterSpacing = "0.88px";
  halo(ctx, name, tx, ey - 4, a);
  ctx.globalAlpha = 0.95 * a;
  ctx.fillStyle = hue;
  ctx.fillText(name, tx, ey - 4);
  if (notes) {
    ctx.font = `400 9.5px ${F.mono}`;
    ctx.letterSpacing = "0.76px";
    halo(ctx, notes, tx, ey + 11, a);
    ctx.globalAlpha = 0.55 * a;
    ctx.fillStyle = hue;
    ctx.fillText(notes, tx, ey + 11);
  }
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
}

export function halo(ctx, text, x, y, a) {
  ctx.globalAlpha = 0.9 * a;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = CLEAR;
  ctx.strokeText(text, x, y);
}

// ---------- target lock, callout, shockwave, pulses ----------

/** Corner brackets at r+d, a dashed ring at r+12 (turning unless still), alpha k. */
export function drawLock(ctx, x, y, r, d, k, turn) {
  ctx.globalAlpha = k;
  ctx.strokeStyle = RETICLE;
  ctx.lineWidth = 1.25;
  const D = r + d, L = 5;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(x + sx * D, y + sy * (D - L));
    ctx.lineTo(x + sx * D, y + sy * D);
    ctx.lineTo(x + sx * (D - L), y + sy * D);
  }
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.7 * k;
  ctx.setLineDash([3, 5]);
  ctx.beginPath(); ctx.arc(x, y, r + 12, turn, turn + TAU); ctx.stroke();
  ctx.setLineDash([]);
}

function fitText(ctx, s, max) {
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}

/** The holo callout beside a locked node. info: {title, meta, when, stale (0-2)}. */
const CW = 184, CH = 64;
/** Where the callout for n goes in a w×h tank: leader points and panel box [x0, y0, x1, y1]. */
export function calloutBox(n, w, h) {
  const W = CW, H = CH, c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6), r0 = n.r + 12;
  const reach = r0 * c + 40 * c + 24 + W;
  const side = n.sx + reach > w - 8 && n.sx - reach >= 8 ? -1 : 1;
  const x0 = n.sx + side * r0 * c, y0 = n.sy - r0 * s, x1 = x0 + side * 40 * c, y1 = y0 - 40 * s, x2 = x1 + side * 24;
  const px = side > 0 ? x2 : x2 - W, py = Math.max(8, Math.min(h - H - 8, y1 - H / 2));
  return { x0, y0, x1, y1, x2, px, py, box: [px, py, px + W, py + H] };
}

export function drawCallout(ctx, n, hue, info, k, w, h, F) {
  if (k <= 0.01) return;
  const W = CW, H = CH, { x0, y0, x1, y1, x2, px, py } = calloutBox(n, w, h);
  ctx.globalAlpha = 0.6 * k;
  ctx.strokeStyle = RETICLE;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y1); ctx.stroke();
  const X = Math.round(px) + 0.5, Y = Math.round(py) + 0.5;
  ctx.beginPath();
  ctx.moveTo(X, Y); ctx.lineTo(X + W - 8, Y); ctx.lineTo(X + W, Y + 8); ctx.lineTo(X + W, Y + H); ctx.lineTo(X, Y + H); ctx.closePath();
  ctx.globalAlpha = 0.82 * k;
  ctx.fillStyle = CLEAR;
  ctx.fill();
  ctx.globalAlpha = 0.5 * k;
  ctx.strokeStyle = HOLO;
  ctx.stroke();
  ctx.globalAlpha = k;
  ctx.fillStyle = hue;
  ctx.fillRect(X - 0.5, Y - 0.5, 2, H + 1);
  const tx = X + 11.5;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `400 12.5px ${F.sans}`;
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#F8FAFC";
  ctx.fillText(fitText(ctx, info.title, W - 24), tx, Y + 21);
  ctx.font = `400 9.5px ${F.mono}`;
  ctx.letterSpacing = "0.76px";
  ctx.globalAlpha = 0.65 * k;
  ctx.fillStyle = RETICLE;
  ctx.fillText(fitText(ctx, info.meta, W - 24), tx, Y + 38);
  let wx = tx;
  if (info.stale) {
    ctx.strokeStyle = HUE.inbox;
    ctx.lineWidth = 1;
    if (info.stale === 2) ctx.setLineDash([1.5, 1.5]);
    ctx.beginPath(); ctx.arc(tx + 3.5, Y + 50, 3, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = HUE.inbox;
    wx += 12;
  }
  ctx.fillText(info.when, wx, Y + 53.5);
  ctx.letterSpacing = "0px";
}

/** Click shockwave: two rings 80ms apart, r to r+60 over 500ms; under reduced motion a 150ms flash. */
export function drawShock(ctx, n, hue, age, rmo) {
  if (rmo) {
    const k = 1 - age / 150;
    if (k <= 0) return false;
    ctx.globalCompositeOperation = "lighter";
    stamp(ctx, hue, n.sx, n.sy, n.r + 14, 0.5 * k);
    ctx.globalCompositeOperation = "source-over";
    return true;
  }
  let live = false;
  ctx.strokeStyle = hue;
  ctx.lineWidth = 1.5;
  for (const lag of [0, 80]) {
    const t = (age - lag) / 500;
    if (t < 0 || t >= 1) { live ||= t < 0; continue; }
    live = true;
    ctx.globalAlpha = 0.6 * (1 - t);
    ctx.beginPath(); ctx.arc(n.sx, n.sy, n.r + 60 * easeOutCubic(t), 0, TAU); ctx.stroke();
  }
  return live;
}

/** The entrance scan line at y: 2px holo with a 60px glow below it. */
export function drawScan(ctx, w, y) {
  const g = ctx.createLinearGradient(0, y, 0, y + 60);
  g.addColorStop(0, rgba(HOLO, 0.08));
  g.addColorStop(1, rgba(HOLO, 0));
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, y, w, 60);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = HOLO;
  ctx.fillRect(0, y - 1, w, 2);
}

/** HUD data panel at (x, y): donut of branch sizes, one row per branch, stale meter. Real counts only. */
export function drawData(ctx, x, y, D, k, F) {
  const cx = x + 22, cy = y + 22, R = 20.5, gap = (2 * Math.PI) / 180;
  const sum = D.rows.reduce((t, r) => t + r.count, 0);
  ctx.lineWidth = 3;
  ctx.lineCap = "butt";
  if (sum > 0) {
    const live = D.rows.filter((r) => r.count > 0), span = TAU - gap * live.length;
    let a0 = -Math.PI / 2 + gap / 2;
    for (const r of live) {
      const a1 = a0 + (span * r.count) / sum;
      ctx.globalAlpha = k * (r.dim ? 0.3 : 0.9);
      ctx.strokeStyle = r.hue;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
      a0 = a1 + gap;
    }
  } else {
    ctx.globalAlpha = 0.15 * k;
    ctx.strokeStyle = HOLO;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.font = `500 11px ${F.mono}`;
  ctx.letterSpacing = "0px";
  ctx.fillStyle = RETICLE;
  ctx.globalAlpha = 0.85 * k;
  ctx.fillText(String(D.total), cx, cy + 4);
  ctx.font = `400 9.5px ${F.mono}`;
  ctx.letterSpacing = "0.76px";
  const rx = x + 58;
  D.rows.forEach((r, i) => {
    const by = y + 9 + i * 13;
    ctx.globalAlpha = k * (r.dim ? 0.3 : 0.9);
    ctx.fillStyle = r.hue;
    ctx.fillRect(rx, by - 6, 6, 6);
    ctx.globalAlpha = k * (r.dim ? 0.3 : 0.65);
    ctx.fillStyle = RETICLE;
    ctx.textAlign = "left";
    // A long branch name ends in … before it reaches the count column.
    const count = String(r.count), room = 120 - ctx.measureText(count).width - 8;
    let name = r.name;
    while (name.length > 2 && ctx.measureText(name).width > room) name = name.slice(0, -2) + "…";
    ctx.fillText(name, rx + 12, by);
    ctx.textAlign = "right";
    ctx.fillText(count, rx + 132, by);
  });
  const my = y + 9 + D.rows.length * 13 + 6;
  ctx.globalAlpha = 0.15 * k;
  ctx.fillStyle = HOLO;
  ctx.fillRect(x, my, 80, 3);
  ctx.globalAlpha = 0.9 * k;
  ctx.fillStyle = "#94A3B8";
  ctx.fillRect(x, my, 80 * D.staleShare, 3);
  ctx.globalAlpha = 0.65 * k;
  ctx.fillStyle = RETICLE;
  ctx.textAlign = "left";
  ctx.fillText(`STALE ${Math.round(D.staleShare * 100)}%`, x + 90, my + 4);
  ctx.letterSpacing = "0px";
}
