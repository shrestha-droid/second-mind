// Pure frontend logic: no DOM, no network. Tested with `node --test app/tests/`.
import { Marked } from "./vendor/marked.esm.js";

export function wikilinkQuery(text, cursor) {
  const before = text.slice(0, cursor);
  const start = before.lastIndexOf("[[");
  if (start < 0) return null;
  const query = before.slice(start + 2);
  return query.includes("]]") || query.includes("\n") ? null : { start, query };
}

export function rankMatches(query, nodes, limit = 8) {
  const q = query.trim().toLowerCase();
  const byTitle = (a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1);
  if (!q) return [...nodes].sort(byTitle).slice(0, limit);
  const rank = (n) => {
    const t = n.title.toLowerCase();
    if (t.startsWith(q)) return 0;
    if (t.includes(q)) return 1;
    return n.id.toLowerCase().includes(q) ? 2 : 3;
  };
  return nodes
    .map((n) => [rank(n), n])
    .filter(([r]) => r < 3)
    .sort(([ra, a], [rb, b]) => ra - rb || byTitle(a, b))
    .slice(0, limit)
    .map(([, n]) => n);
}

export function safeHref(href) {
  // Browsers drop ASCII control chars and whitespace inside a scheme, so judge the stripped, lowered form.
  const flat = href.replace(/[\u0000- ]/g, "").toLowerCase();
  if (!flat) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(flat);
  return !scheme || ["http", "https", "mailto"].includes(scheme[1]) ? href : null;
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function renderMarkdown(md, resolve) {
  const wikilink = {
    name: "wikilink",
    level: "inline",
    start: (src) => src.indexOf("[["),
    tokenizer(src) {
      const m = /^\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/.exec(src);
      if (m) return { type: "wikilink", raw: m[0], target: m[1].trim(), alias: (m[2] ?? m[1]).trim() };
    },
    renderer: (t) => {
      const id = resolve(t.target);
      return id
        ? `<a class="wikilink" href="#/n/${esc(id)}">${esc(t.alias)}</a>`
        : `<a class="wikilink missing" data-target="${esc(t.target)}">${esc(t.alias)}</a>`;
    },
  };
  const marked = new Marked({ extensions: [wikilink], renderer: {
    // Raw HTML is shown as text: escaped, never dropped, never passed through.
    html: ({ text, block }) => (block ? `<p>${esc(text.trim())}</p>\n` : esc(text)),
    link(token) {
      const inner = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href);
      if (href === null) return inner;
      return `<a href="${esc(href)}"${token.title ? ` title="${esc(token.title)}"` : ""}>${inner}</a>`;
    },
    image({ href, title, text }) {
      const src = safeHref(href);
      if (src === null) return esc(text);
      return `<img src="${esc(src)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ""}>`;
    },
  } });
  return marked.parse(md, { async: false });
}

export function breadcrumb(id, titleOf) {
  const parts = id.split("/");
  return parts.map((_, i) => {
    const path = parts.slice(0, i + 1).join("/");
    return { id: path, title: titleOf(path) };
  });
}

// Bearings in degrees: 0 = +x, clockwise in SVG coords (y down).
const BEARING = { work: -54, college: 18, social: 90, competitions: 162, builds: 234 };
const rad = (d) => (d * Math.PI) / 180;
const polar = (r, deg) => ({ x: r * Math.cos(rad(deg)), y: r * Math.sin(rad(deg)) });
const bearingOf = (p) => (Math.atan2(p.y, p.x) * 180) / Math.PI;

export function orreryLayout(nodes) {
  const info = nodes.map((n) => {
    const parts = n.id.split("/");
    const inbox = parts[0] === "inbox";
    return { id: n.id, inbox, branch: n.id === "shrestha" ? null : inbox ? "inbox" : parts[1], depth: inbox ? 1 : parts.length - 1 };
  }).sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1));
  const out = new Map();
  const put = (n, p) => out.set(n.id, { x: p.x, y: p.y, depth: n.depth, branch: n.branch });

  const inbox = info.filter((n) => n.inbox);
  inbox.forEach((n, i) => put(n, polar(72, -120 + (60 * (i + 0.5)) / inbox.length)));

  const sectors = new Map(); // branch -> depth-2 nodes, already sorted by id
  const siblings = new Map(); // parent id -> depth 3+ children
  for (const n of info) {
    if (n.inbox) continue;
    if (n.depth === 0) put(n, { x: 0, y: 0 });
    // ponytail: an unknown branch name sits at the Inbox gap (-90 deg); add bearings if branches become configurable
    else if (n.depth === 1) put(n, polar(150, BEARING[n.branch] ?? -90));
    else if (n.depth === 2) (sectors.get(n.branch) ?? sectors.set(n.branch, []).get(n.branch)).push(n);
    else {
      const parent = n.id.slice(0, n.id.lastIndexOf("/"));
      (siblings.get(parent) ?? siblings.set(parent, []).get(parent)).push(n);
    }
  }
  for (const [branch, list] of sectors) {
    const centre = BEARING[branch] ?? -90;
    list.forEach((n, i) => {
      const r = list.length > 4 ? (i % 2 ? 330 : 255) : 290;
      put(n, polar(r, centre - 28 + (56 * (i + 0.5)) / list.length));
    });
  }
  // Depth 3+ go outward along the parent's own bearing, 38/48/58 px beyond it. Parents sort before children.
  // ponytail: more than 3 siblings repeat the distance and overlap; fan them out if real notes go that deep
  for (const n of info) {
    if (n.depth < 3 || n.inbox) continue;
    const parentId = n.id.slice(0, n.id.lastIndexOf("/"));
    const parent = out.get(parentId);
    if (!parent) continue; // orphan: parent note missing, nothing to hang it on
    const k = siblings.get(parentId).indexOf(n);
    const d = 38 + (k % 3) * 10;
    const b = bearingOf(parent);
    put(n, { x: parent.x + d * Math.cos(rad(b)), y: parent.y + d * Math.sin(rad(b)) });
  }
  return out;
}

// Mirrors sm/vault.py slugify: the server derives ids from titles the same way.
export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/^-+|-+$/g, "") || "untitled";
}

// Mirrors sm/links.py resolve, after stripping |alias and #heading.
export function resolveTarget(raw, ids) {
  const t = raw.split(/[|#]/, 1)[0].trim();
  if (!t) return null;
  if (ids.has(t)) return t;
  if (ids.has(`shrestha/${t}`)) return `shrestha/${t}`;
  const slug = slugify(t);
  let hit = null;
  for (const i of ids) {
    if (i.slice(i.lastIndexOf("/") + 1) !== slug) continue;
    if (hit) return null;
    hit = i;
  }
  return hit;
}

// Search snippets are raw note text with <mark> markers: escape all, then restore only the markers.
export function snippetHtml(s) {
  return esc(s).replace(/&lt;(\/?)mark&gt;/g, "<$1mark>");
}

export function wordCount(s) {
  return (s.match(/\S+/g) || []).length;
}

// The form edits title, type, summary (strings) and pinned (boolean). A key kept as a raw YAML block,
// or holding another type, was hand-edited: the form shows it read-only (null) and never writes it.
export function formField(meta, key, type) {
  if ((meta._raw_lines ?? []).some((l) => l.startsWith(`${key}:`))) return null;
  const v = meta[key];
  if (v === undefined) return type === "boolean" ? false : "";
  return typeof v === type ? v : null;
}

// Meta to save: the loaded meta, with only the fields the user touched taken from the form.
export function mergeMeta(original, form, touched) {
  const out = { ...original };
  for (const k of touched) {
    if (k in form && formField(original, k, typeof form[k]) !== null) out[k] = form[k];
  }
  return out;
}
