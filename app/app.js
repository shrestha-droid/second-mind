// Second Mind app shell: tree, editor, links, search, packs. Talks only to the local JSON API.
import { wikilinkQuery, rankMatches, renderMarkdown, breadcrumb, slugify, resolveTarget, snippetHtml, wordCount } from "./lib.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const TOKEN = $('meta[name="sm-token"]').content;
const TYPES = ["person", "project", "area", "task", "chat", "note"];
const ROOTS = new Set(["shrestha", "inbox"]);
const SVG = "http://www.w3.org/2000/svg";

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const S = {
  view: "note", id: null, note: null, base: null, dirty: false, timer: 0, saving: null, again: false, conflict: null,
  nodes: [], byId: new Map(), ids: new Set(), tree: null,
  budget: 1500, include: new Set(), exclude: new Set(), pack: null, reading: false, down: false,
};

// ---------- small DOM helpers (text always goes in as text nodes) ----------

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  e.append(...kids.flat(Infinity).filter((c) => c != null && c !== false));
  return e;
}
function icon(id, cls = "ic") {
  const s = document.createElementNS(SVG, "svg"), u = document.createElementNS(SVG, "use");
  s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true"); u.setAttribute("href", `#${id}`);
  s.append(u);
  return s;
}
// replaceChildren with nested arrays and null/false skipped
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((c) => c != null && c !== false));
const fmt = (n) => n.toLocaleString("en-US");
const parentOf = (id) => id.slice(0, Math.max(0, id.lastIndexOf("/"))) || "shrestha";
const leaf = (id) => id.slice(id.lastIndexOf("/") + 1);
const hashFor = (view, id) => (view === "split" ? `#/split/${id}` : `#/n/${id}`);
const titleOf = (id) => S.byId.get(id)?.title ?? (id === "inbox" ? "Inbox" : leaf(id));
function branchOf(id) {
  const p = id.split("/");
  if (p[0] === "inbox") return "inbox";
  return p.length === 1 ? "root" : p[1];
}

let toastT = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("on"), 2600);
}

// ---------- API ----------

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.headers["X-SM-Token"] = TOKEN;
    opt.body = JSON.stringify(body);
  }
  let r;
  try {
    r = await fetch(path, opt);
  } catch {
    setDown(true);
    throw Object.assign(new Error("server not running"), { status: 0 });
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(data?.error || `HTTP ${r.status}`), { status: r.status, data });
  return data;
}
const errText = (e) => (e.status === 0 ? "The server is not running." : e.data?.error || e.message);

let downT = 0;
function setDown(down) {
  if (down === S.down) return;
  S.down = down;
  $("#banner-down").hidden = !down;
  clearInterval(downT);
  if (!down) return;
  downT = setInterval(async () => {
    try { if (!(await fetch("/api/tree")).ok) return; } catch { return; }
    setDown(false);
    refreshData().catch(() => {});
    if (S.dirty) save();
  }, 3000);
}

async function refreshData() {
  const [tree, graph] = await Promise.all([api("GET", "/api/tree"), api("GET", "/api/graph")]);
  S.tree = tree;
  S.nodes = graph.nodes;
  S.byId = new Map(graph.nodes.map((n) => [n.id, n]));
  S.ids = new Set([...S.byId.keys(), "inbox"]);
  renderTree();
}

// ---------- routing ----------

function parseHash() {
  let h = location.hash.slice(1);
  try { h = decodeURIComponent(h); } catch {}
  if (h === "/graph") return { view: "graph", id: null };
  const m = /^\/(split|n)\/(.+)$/.exec(h);
  return m ? { view: m[1] === "split" ? "split" : "note", id: m[2] } : { view: "note", id: "shrestha" };
}

async function route() {
  const { view, id } = parseHash();
  showView(view, false);
  if (id && id !== S.id) await loadNote(id);
  else if (!S.id) await loadNote("shrestha"); // the graph view still needs a current note for crumbs and the pack
}

/** Open a note. Graph clicks (Task 10) can pass "split" to keep the graph in view. */
export function openNote(id, view = S.view === "split" ? "split" : "note", replace = false) {
  const hash = hashFor(view, id);
  if (location.hash !== hash) history[replace ? "replaceState" : "pushState"](null, "", hash);
  return route();
}

export function showView(view, push = true) {
  if (!["note", "graph", "split"].includes(view)) return;
  S.view = view;
  document.body.dataset.view = view;
  $("#graph-pane").hidden = view === "note";
  $("#note-pane").hidden = view === "graph";
  for (const b of $$(".views button")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  if (!push) return;
  const hash = view === "graph" ? "#/graph" : hashFor(view, S.id || "shrestha");
  if (location.hash !== hash) history.pushState(null, "", hash);
}

export function addToPack(id) {
  S.include.add(id);
  S.exclude.delete(id);
  refreshPack();
  toast(`Added “${titleOf(id)}” to the pack`);
}

// ---------- note load / save ----------

let loadSeq = 0;
async function loadNote(id) {
  if (S.note && S.dirty && id !== S.note.id) {
    await save();
    if (S.dirty) {
      toast("This note is not saved yet, so it stays open.");
      history.replaceState(null, "", hashFor(S.view, S.note.id));
      return;
    }
  }
  const seq = ++loadSeq;
  S.id = id;
  try {
    const n = await api("GET", `/api/note?id=${encodeURIComponent(id)}`);
    if (seq === loadSeq) setNote(n);
  } catch (e) {
    if (seq !== loadSeq || e.status === 0) return;
    toast(`No note at ${id}.`);
    if (id !== "shrestha") { S.id = null; openNote("shrestha", S.view === "split" ? "split" : "note", true); }
  }
}

function setNote(n) {
  clearTimeout(S.timer);
  Object.assign(S, { note: n, id: n.id, base: n.mtime_ns, dirty: false, again: false });
  hideConflict();
  const m = n.meta;
  $("#f-title").value = m.title ?? "";
  const sel = $("#f-type"), types = !m.type || TYPES.includes(m.type) ? TYPES : [...TYPES, String(m.type)];
  sel.replaceChildren(...types.map((t) => h("option", { value: t }, t)));
  sel.value = m.type || "note";
  $("#f-summary").value = typeof m.summary === "string" ? m.summary : "";
  $("#f-pinned").checked = m.pinned === true;
  $("#f-updated").textContent = m.updated ?? "never";
  const body = $("#editor-body");
  body.value = n.body;
  body.scrollTop = 0;
  $("#preview").scrollTop = 0;
  $("#note-pane").dataset.branch = branchOf(n.id);
  document.title = `${m.title || n.id} · Second Mind`;
  const fm = $("#fm");
  fm.style.animation = "none"; void fm.offsetWidth; fm.style.animation = "";
  words(); renderPreview(); renderCrumbs(); renderLinks(); setSaveState("");
  revealInTree(n.id);
  S.include.clear(); S.exclude.clear();
  refreshPack();
}

function setSaveState(text, bad = false) {
  const el = $("#save-state");
  el.textContent = text;
  el.classList.toggle("bad", bad);
}

const collectMeta = () => ({
  ...S.note.meta,
  title: $("#f-title").value,
  type: $("#f-type").value,
  summary: $("#f-summary").value,
  pinned: $("#f-pinned").checked,
});

function edited() {
  if (!S.note) return;
  S.dirty = true;
  if (!S.conflict) setSaveState("Edited");
  clearTimeout(S.timer);
  S.timer = setTimeout(save, 800);
}

function save() {
  clearTimeout(S.timer);
  if (!S.note || !S.dirty || S.conflict) return Promise.resolve();
  if (S.saving) { S.again = true; return S.saving; }
  const before = S.note, id = before.id;
  const payload = { id, meta: collectMeta(), body: $("#editor-body").value, base_mtime_ns: S.base };
  S.dirty = false;
  setSaveState("Saving…");
  S.saving = (async () => {
    let ok = false;
    try {
      const n = await api("PUT", "/api/note", payload);
      ok = true;
      if (S.note?.id !== id) return;
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const relinked = n.meta.title !== before.meta.title || !same(n.outlinks, before.outlinks) || !same(n.missing, before.missing);
      S.note = n;
      S.base = n.mtime_ns;
      $("#f-updated").textContent = n.meta.updated ?? "";
      renderLinks();
      setSaveState(S.dirty ? "Edited" : "Saved");
      if (relinked) refreshData().then(() => { renderCrumbs(); renderPreview(); }).catch(() => {});
      schedulePack();
    } catch (e) {
      S.dirty = true;
      if (e.status === 409) showConflict(e.data.current);
      else if (e.status === 0) setSaveState("Offline, kept here", true);
      else { setSaveState("Not saved", true); toast(errText(e)); }
    } finally {
      S.saving = null;
      const again = S.again;
      S.again = false;
      if (ok && again && S.dirty) await save();
    }
  })();
  return S.saving;
}

function showConflict(current) {
  S.conflict = current;
  $("#banner-conflict").hidden = false;
  setSaveState("Conflict", true);
}
function hideConflict() {
  S.conflict = null;
  $("#banner-conflict").hidden = true;
}

// Someone edited the file outside the app: reload quietly if we have nothing unsaved, else ask.
async function checkDisk() {
  if (!S.note || S.saving || S.conflict || document.hidden) return;
  try {
    const n = await api("GET", `/api/note?id=${encodeURIComponent(S.note.id)}`);
    if (n.id !== S.note?.id || n.mtime_ns === S.base || S.saving || S.conflict) return;
    if (S.dirty) showConflict(n); else setNote(n);
  } catch {}
}

// ---------- editor ----------

function words() {
  const n = wordCount($("#f-summary").value), el = $("#f-words");
  el.textContent = n > 100 ? `${n}/100 · too long` : `${n}/100`;
  el.classList.toggle("over", n > 100);
  el.title = n > 100 ? "Packs carry the summary. Keep it under 100 words." : "Words in the summary";
}

function renderPreview() {
  const p = $("#preview"), body = $("#editor-body").value;
  if (!body.trim()) {
    p.replaceChildren(h("p", { class: "placeholder" }, "Write here. ", h("code", {}, "[["), " links a note."));
    return;
  }
  p.innerHTML = renderMarkdown(body, (t) => resolveTarget(t, S.ids)); // renderMarkdown escapes all raw HTML
  for (const a of $$("a.wikilink", p)) {
    if (a.classList.contains("missing")) {
      Object.assign(a, { tabIndex: 0, title: "No such note. Click to create it" });
      a.setAttribute("role", "button");
    } else {
      const id = a.getAttribute("href").slice(4);
      if (a.textContent === id) a.textContent = titleOf(id);
    }
  }
  for (const a of $$('a[href^="http"]', p)) Object.assign(a, { target: "_blank", rel: "noopener noreferrer" });
}

let previewRaf = 0;
function onBodyInput() {
  edited();
  cancelAnimationFrame(previewRaf);
  previewRaf = requestAnimationFrame(renderPreview);
  acUpdate();
}

function setReading(on) {
  S.reading = on;
  $("#editor").classList.toggle("reading", on);
  $("#read-btn").setAttribute("aria-pressed", String(on));
  if (!on && S.view !== "graph") $("#editor-body").focus();
}

let syncLock = false;
function syncScroll(from, to) {
  if (syncLock) return;
  const max = from.scrollHeight - from.clientHeight;
  syncLock = true;
  to.scrollTop = (max > 0 ? from.scrollTop / max : 0) * (to.scrollHeight - to.clientHeight);
  requestAnimationFrame(() => { syncLock = false; });
}

// ---------- [[ autocomplete ----------

const ac = $("#ac");
let acItems = [], acIdx = 0, acQ = null;

function caretXY(ta, pos) {
  const cs = getComputedStyle(ta), m = document.createElement("div");
  for (const p of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingLeft", "paddingRight", "tabSize", "overflowWrap", "wordBreak"]) m.style[p] = cs[p];
  Object.assign(m.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", top: "0", left: "-9999px", boxSizing: "border-box", border: "0", width: `${ta.clientWidth}px` });
  m.textContent = ta.value.slice(0, pos);
  const s = document.createElement("span");
  s.textContent = "​";
  m.append(s);
  document.body.append(m);
  const r = ta.getBoundingClientRect();
  const out = { x: r.left + s.offsetLeft - ta.scrollLeft, y: r.top + s.offsetTop - ta.scrollTop, lh: s.offsetHeight };
  m.remove();
  return out;
}

function acUpdate() {
  const ta = $("#editor-body");
  const q = ta.selectionStart === ta.selectionEnd ? wikilinkQuery(ta.value, ta.selectionStart) : null;
  if (!q || q.query.length > 64) return acClose();
  acQ = q;
  acItems = rankMatches(q.query, S.nodes, 8);
  if (!acItems.length) return acClose();
  acIdx = 0;
  ac.replaceChildren(...acItems.map((n, i) => h("li", {
    id: `ac-${i}`, class: "opt", role: "option", "aria-selected": String(i === 0), "data-branch": branchOf(n.id),
    onmousedown: (e) => { e.preventDefault(); acPick(i); },
  }, h("span", { class: "dot" }), h("span", { class: "t plain" }, n.title), h("span", { class: "p" }, n.id))));
  ac.hidden = false;
  const { x, y, lh } = caretXY(ta, q.start);
  const below = y + lh + 4, hgt = ac.offsetHeight;
  ac.style.left = `${Math.max(8, Math.min(x - 8, innerWidth - ac.offsetWidth - 8))}px`;
  ac.style.top = `${below + hgt > innerHeight - 8 ? y - hgt - 4 : below}px`;
  ta.setAttribute("aria-expanded", "true");
  ta.setAttribute("aria-activedescendant", "ac-0");
}
function acClose() {
  if (ac.hidden) return;
  ac.hidden = true;
  acQ = null;
  const ta = $("#editor-body");
  ta.setAttribute("aria-expanded", "false");
  ta.removeAttribute("aria-activedescendant");
}
function acMove(d) {
  acIdx = (acIdx + d + acItems.length) % acItems.length;
  $$(".opt", ac).forEach((o, i) => o.setAttribute("aria-selected", String(i === acIdx)));
  $(`#ac-${acIdx}`).scrollIntoView({ block: "nearest" });
  $("#editor-body").setAttribute("aria-activedescendant", `ac-${acIdx}`);
}
function acPick(i) {
  const n = acItems[i], ta = $("#editor-body");
  if (!n || !acQ) return;
  let end = ta.selectionStart;
  if (ta.value.slice(end, end + 2) === "]]") end += 2;
  const text = `[[${n.id}]]`;
  ta.focus();
  ta.setSelectionRange(acQ.start, end);
  // insertText keeps native undo; fall back where it is unsupported
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, acQ.start, end, "end");
    onBodyInput();
  }
  acClose();
}

// ---------- crumbs, tree, links ----------

function renderCrumbs() {
  const id = S.note?.id || S.id;
  if (!id) return;
  const all = breadcrumb(id, titleOf);
  $("#crumbs").replaceChildren(...all.map((c, i) => h("li", {}, h("a", {
    href: hashFor("note", c.id), "data-branch": branchOf(c.id), "aria-current": i === all.length - 1 ? "page" : null,
  }, c.title))));
}

const collapsed = new Set(store.get("sm-collapsed", []));

function revealInTree(id) {
  let changed = false;
  for (let p = id; p.includes("/"); ) {
    p = p.slice(0, p.lastIndexOf("/"));
    changed = collapsed.delete(p) || changed;
  }
  if (changed) store.set("sm-collapsed", [...collapsed]);
  renderTree();
}

function toggleNode(id) {
  if (!collapsed.delete(id)) collapsed.add(id);
  store.set("sm-collapsed", [...collapsed]);
  renderTree();
}

function treeRow(n, depth, has, open, inbox = false) {
  const branch = branchOf(n.id), active = n.id === S.id;
  const count = inbox ? countAll(n) : 0;
  return h("div", {
    class: `row${n.stale ? " stale" : ""}${active ? " active" : ""}`, style: `--depth:${depth}`,
    "data-branch": branch, "data-id": n.id,
  },
    has ? h("button", { type: "button", class: "tw", tabindex: "-1", "aria-expanded": String(open), "aria-label": `${open ? "Collapse" : "Expand"} ${n.title}`, onclick: () => toggleNode(n.id) }, icon("i-chev"))
      : h("span", { class: "tw-sp" }),
    h("a", { class: "row-link", href: hashFor("note", n.id), "aria-current": active ? "page" : null, "aria-keyshortcuts": "Shift+F10" },
      inbox ? icon("i-diamond", "ic diamond") : depth === 1 && branch !== "inbox" ? h("span", { class: "dot" }) : null,
      h("span", { class: "t" }, n.title),
      n.stale ? h("span", { class: "tag", title: "Not updated for over 30 days" }, "30d+") : null,
      inbox && count ? h("span", { class: "badge", "aria-label": `${count} to file` }, String(count)) : null),
    h("button", { type: "button", class: "more", tabindex: "-1", "aria-haspopup": "menu", "aria-label": `Actions for ${n.title}`, onclick: (e) => openMenu(n.id, e.currentTarget) }, icon("i-more")));
}
const countAll = (n) => n.children.reduce((s, c) => s + 1 + countAll(c), 0);

function renderTree() {
  if (!S.tree) return;
  const nav = $("#tree"), q = $("#filter").value.trim().toLowerCase();
  const focusId = document.activeElement?.closest?.("#tree .row")?.dataset.id;
  const match = (n) => !q || n.title.toLowerCase().includes(q) || n.id.includes(q);
  const keep = (n) => {
    const kids = n.children.map(keep).filter(Boolean);
    return match(n) || kids.length ? { ...n, children: kids } : null;
  };
  const build = (n, depth, inbox = false) => {
    const has = n.children.length > 0, open = Boolean(q) || !collapsed.has(n.id);
    const li = h("li", {}, treeRow(n, depth, has, open, inbox));
    if (has && open) li.append(h("ul", {}, n.children.map((c) => build(c, depth + 1))));
    return li;
  };
  const root = keep(S.tree.root), inbox = keep(S.tree.inbox);
  const parts = [];
  if (inbox) {
    parts.push(h("ul", { class: "inbox-block", "aria-label": "Inbox" }, build(inbox, 0, true),
      !q && !inbox.children.length ? h("li", { class: "tree-empty" }, "Nothing to file.") : null));
  }
  if (root) parts.push(h("ul", { "aria-label": "Notes" }, build(root, 0)));
  if (!parts.length) parts.push(h("p", { class: "empty" }, "No notes match. Try fewer words."));
  nav.replaceChildren(...parts);
  if (focusId) $(`.row[data-id="${CSS.escape(focusId)}"] .row-link`, nav)?.focus();
}

function treeKeys(e) {
  const link = e.target.closest(".row-link");
  if (!link) return;
  const row = link.parentElement, id = row.dataset.id, tw = $(".tw", row);
  const links = $$(".row-link", $("#tree")), i = links.indexOf(link);
  const go = (j) => { e.preventDefault(); links[Math.max(0, Math.min(links.length - 1, j))]?.focus(); };
  if (e.key === "ArrowDown") go(i + 1);
  else if (e.key === "ArrowUp") go(i - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(links.length - 1);
  else if (e.key === "ArrowRight" && tw?.getAttribute("aria-expanded") === "false") { e.preventDefault(); toggleNode(id); }
  else if (e.key === "ArrowLeft") {
    e.preventDefault();
    if (tw?.getAttribute("aria-expanded") === "true") toggleNode(id);
    else if (id.includes("/")) $(`.row[data-id="${CSS.escape(parentOf(id))}"] .row-link`)?.focus();
  } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); openMenu(id, link); }
}

function renderLinks() {
  const n = S.note, panel = $("#panel-links");
  if (!n) return;
  const sec = (label, items, row, empty) => h("section", { class: "lsec" },
    h("h3", { class: "eyebrow" }, label, h("span", { class: "count" }, String(items.length))),
    items.length ? h("ul", {}, items.map(row)) : h("p", { class: "empty" }, empty));
  const link = (r) => h("li", {}, h("a", { class: "lrow", href: hashFor("note", r.id), "data-branch": branchOf(r.id) },
    h("span", { class: "dot" }), h("span", { class: "t" }, r.title), h("span", { class: "p" }, r.id)));
  const miss = (t) => h("li", {}, h("button", { type: "button", class: "lrow missing", onclick: () => askCreate({ title: leaf(t), parent: n.id }) },
    h("span", { class: "dot" }), h("span", { class: "t" }, t), h("span", { class: "p" }, "Create note")));
  fill(panel,
    sec("Backlinks", n.backlinks, link, "Nothing links here yet."),
    sec("Outgoing", n.outlinks, link, "No links out. Type [[ in the body."),
    n.missing.length ? sec("Missing", n.missing, miss, "") : null,
  );
  $("#links-n").textContent = String(n.backlinks.length + n.outlinks.length);
}

// ---------- sidebar search ----------

let searchT = 0, searchSeq = 0;
async function runSearch() {
  const q = $("#filter").value.trim(), box = $("#search-results"), seq = ++searchSeq;
  if (q.length < 2) { box.hidden = true; box.replaceChildren(); return; }
  let hits;
  try { hits = await api("GET", `/api/search?q=${encodeURIComponent(q)}`); } catch { return; }
  if (seq !== searchSeq) return;
  const hit = (r) => {
    const s = h("span", { class: "s" });
    s.innerHTML = snippetHtml(r.snippet); // escaped; only <mark> survives
    return h("a", { class: "hit", href: hashFor("note", r.id) }, h("span", { class: "t" }, r.title), s);
  };
  box.replaceChildren(h("h2", { class: "eyebrow" }, "In note text"),
    ...(hits.length ? hits.slice(0, 20).map(hit) : [h("p", { class: "empty" }, "No notes match. Try fewer words.")]));
  box.hidden = false;
}

// ---------- context menu ----------

const menu = $("#menu");
let menuFrom = null;
function openMenu(id, from, x, y) {
  const root = ROOTS.has(id);
  const items = [
    ["New note here", () => askCreate({ parent: id })],
    ["Rename…", () => askRename(id)],
    ...(root ? [] : [["Move…", () => askMove(id)], null, ["Move to trash", () => askTrash(id), "danger"]]),
  ];
  menu.replaceChildren(...items.map((it) => (it
    ? h("button", { type: "button", role: "menuitem", tabindex: "-1", class: it[2] || null, onclick: () => { closeMenu(); it[1](); } }, it[0])
    : h("hr", { role: "separator" }))));
  menu.hidden = false;
  menuFrom = from;
  from?.setAttribute("aria-expanded", "true");
  const r = from?.getBoundingClientRect();
  const left = x ?? r.left, top = y ?? r.bottom + 2;
  menu.style.left = `${Math.min(left, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(top, innerHeight - menu.offsetHeight - 8)}px`;
  $("button", menu).focus();
}
function closeMenu(restore = true) {
  if (menu.hidden) return;
  menu.hidden = true;
  menuFrom?.setAttribute("aria-expanded", "false");
  if (restore) (menuFrom?.closest(".row")?.querySelector(".row-link") ?? menuFrom)?.focus();
  menuFrom = null;
}
menu.addEventListener("keydown", (e) => {
  const btns = $$("button", menu), i = btns.indexOf(document.activeElement);
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: btns.length - 1 }[e.key];
  if (to !== undefined) { e.preventDefault(); btns[(to + btns.length) % btns.length].focus(); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); }
  else if (e.key === "Tab") closeMenu(false);
});
document.addEventListener("mousedown", (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(false); });

// ---------- dialogs ----------

/** One small modal form. onSubmit returns an error string to keep it open. Resolves the values, or null on cancel. */
function ask({ title, msg, fields = [], ok, onSubmit }) {
  return new Promise((resolve) => {
    const d = $("#ask"), back = document.activeElement;
    let result = null;
    const err = h("p", { class: "err", role: "alert" });
    const field = (f, i) => {
      const common = { name: f.name, autofocus: i === 0 ? true : null };
      if (f.type === "check") return h("label", { class: "check" }, h("input", { ...common, type: "checkbox" }), f.label);
      const ctl = f.type === "select"
        ? h("select", common, f.options.map(([v, l]) => h("option", { value: v, selected: v === f.value ? true : null }, l)))
        : h("input", { ...common, type: "text", value: f.value ?? "", spellcheck: "false" });
      return h("label", { class: "field" }, h("span", {}, f.label), ctl);
    };
    const form = h("form", {}, h("h2", { id: "ask-h" }, title), msg ? h("p", { class: "msg" }, msg) : null,
      fields.map(field), err,
      h("div", { class: "acts" },
        h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Cancel"),
        h("button", { type: "submit", class: "btn btn-accent" }, ok)));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const vals = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        vals[f.name] = f.type === "check" ? el.checked : el.value;
      }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      const bad = await onSubmit?.(vals);
      btn.disabled = false;
      if (bad) { err.textContent = bad; return; }
      result = vals;
      d.close();
    });
    d.replaceChildren(form);
    d.setAttribute("aria-labelledby", "ask-h");
    d.addEventListener("close", () => {
      if (back?.isConnected) back.focus();
      resolve(result);
    }, { once: true });
    d.showModal();
    form.querySelector("input[autofocus]")?.select?.(); // rename: typing replaces the old title
  });
}

function parentChoices(without) {
  return [...S.ids]
    .filter((i) => !without || !(i === without || i.startsWith(`${without}/`)))
    .sort()
    .map((i) => [i, `${"  ".repeat(i.split("/").length - 1)}${titleOf(i)}`]);
}

async function flushIfOpen(id) {
  if (!S.note || !(S.note.id === id || S.note.id.startsWith(`${id}/`))) return true;
  await save();
  if (S.dirty) toast("Save or resolve this note first.");
  return !S.dirty;
}

async function askCreate({ parent = S.note?.id || "shrestha", title = "" } = {}) {
  let made = null;
  const v = await ask({
    title: "New note",
    fields: [
      { name: "title", label: "Title", value: title },
      { name: "parent", label: "Inside", type: "select", options: parentChoices(), value: parent },
      { name: "type", label: "Type", type: "select", options: TYPES.map((t) => [t, t]), value: "note" },
      { name: "folder", label: "Folder: it will hold other notes", type: "check" },
    ],
    ok: "Create",
    onSubmit: async (v) => {
      if (!v.title.trim()) return "Give it a title.";
      try { made = await api("POST", "/api/note", { parent: v.parent, title: v.title.trim(), type: v.type, folder: v.folder }); }
      catch (e) { return errText(e); }
    },
  });
  if (!v || !made) return;
  await refreshData();
  if (S.note) renderPreview(); // a missing link may now resolve
  await openNote(made.id, S.view === "split" ? "split" : "note");
  $("#editor-body").focus();
}

async function askRename(id) {
  if (!(await flushIfOpen(id))) return;
  const old = titleOf(id);
  await ask({
    title: "Rename",
    msg: ROOTS.has(id) ? "Changes the title. The id stays." : "Changes the title and the id. Links to it are rewritten.",
    fields: [{ name: "title", label: "Title", value: old }],
    ok: "Rename",
    onSubmit: async (v) => {
      const t = v.title.trim();
      if (!t) return "Give it a title.";
      if (t === old) return;
      try {
        let nid = id;
        if (!ROOTS.has(id) && slugify(t) !== leaf(id)) {
          nid = `${id.slice(0, id.lastIndexOf("/") + 1)}${slugify(t)}`;
          const r = await api("POST", "/api/move", { id, new_id: nid });
          if (r.partial) toast(`Renamed, but ${r.unrewritten.length} note(s) still link the old id.`);
        }
        const n = await api("GET", `/api/note?id=${encodeURIComponent(nid)}`);
        await api("PUT", "/api/note", { id: nid, meta: { ...n.meta, title: t }, body: n.body, base_mtime_ns: n.mtime_ns });
        await afterMove(id, nid);
      } catch (e) { return errText(e); }
    },
  });
}

async function askMove(id) {
  if (!(await flushIfOpen(id))) return;
  const from = parentOf(id);
  await ask({
    title: `Move “${titleOf(id)}”`,
    msg: "Notes inside it move too. Links to it are rewritten.",
    fields: [{ name: "parent", label: "Into", type: "select", options: parentChoices(id), value: from }],
    ok: "Move",
    onSubmit: async (v) => {
      if (v.parent === from) return;
      try {
        const nid = `${v.parent}/${leaf(id)}`;
        const r = await api("POST", "/api/move", { id, new_id: nid });
        if (r.partial) toast(`Moved, but ${r.unrewritten.length} note(s) still link the old id.`);
        await afterMove(id, nid);
      } catch (e) { return errText(e); }
    },
  });
}

async function askTrash(id) {
  await ask({
    title: `Move “${titleOf(id)}” to trash?`,
    msg: "It goes to vault/.trash with any notes inside it. Links to it will show as missing.",
    ok: "Move to trash",
    onSubmit: async () => {
      try { await api("POST", "/api/trash", { id }); await afterMove(id, null); }
      catch (e) { return errText(e); }
    },
  });
}

// After a move, rename or trash: other notes' links were rewritten, so reload what is open.
async function afterMove(oldId, newId) {
  await refreshData();
  const cur = S.note?.id;
  if (!cur) return;
  const inside = cur === oldId || cur.startsWith(`${oldId}/`);
  if (inside) {
    clearTimeout(S.timer);
    Object.assign(S, { dirty: false, id: null, note: null });
    await openNote(newId ? newId + cur.slice(oldId.length) : parentOf(oldId), S.view === "split" ? "split" : "note", true);
  } else {
    S.id = null;
    await loadNote(cur);
  }
}

// ---------- pack ----------

let packT = 0, packSeq = 0;
function schedulePack() { clearTimeout(packT); packT = setTimeout(refreshPack, 400); }

async function refreshPack() {
  if (!S.note) return;
  const seq = ++packSeq;
  const q = new URLSearchParams({ id: S.note.id, budget: String(S.budget), include: [...S.include].join(","), exclude: [...S.exclude].join(",") });
  let p;
  try { p = await api("GET", `/api/pack?${q}`); } catch { return; }
  if (seq !== packSeq) return;
  S.pack = p;
  renderPack();
}

function renderPack() {
  const p = S.pack, pct = p.tokens / S.budget;
  const bar = $("#fill-bar"), meter = $("#fill");
  bar.style.width = `${Math.min(100, pct * 100)}%`;
  bar.classList.toggle("hot", pct >= 0.9);
  meter.setAttribute("aria-valuemax", String(S.budget));
  meter.setAttribute("aria-valuenow", String(p.tokens));
  meter.setAttribute("aria-valuetext", `${fmt(p.tokens)} of ${fmt(S.budget)} tokens`);
  $("#pill-n").textContent = `≈${fmt(p.tokens)}`;
  $("#pill-b").textContent = fmt(S.budget);
  $("#pack-pill").classList.toggle("over", pct > 1);
  $("#pack-tokens").textContent = `≈${fmt(p.tokens)} tokens`;

  const lines = p.text.split("\n");
  const cost = (id) => {
    const l = lines.find((x) => x.startsWith(`- [[${id}]]`));
    return l ? `≈${Math.ceil(l.length / 4)}` : "";
  };
  const row = (id, on, out) => h("label", { class: `prow${out ? " out" : ""}`, "data-branch": branchOf(id) },
    h("input", { type: "checkbox", checked: on ? true : null, onchange: (e) => togglePack(id, e.target.checked) }),
    h("span", { class: "dot" }), h("span", { class: "t", title: id }, titleOf(id)), h("span", { class: "n mono muted" }, cost(id)));
  const bodyOut = p.text.includes("\n(body omitted)");
  fill($("#pack-list"),
    bodyOut ? h("p", { class: "pack-note" }, "This note's body is left out at this budget. Its summary goes in.") : null,
    h("h3", { class: "eyebrow" }, "Linked"),
    p.included.length ? p.included.map((id) => row(id, true)) : h("p", { class: "pack-note" }, "No linked notes fit. Raise the budget or link notes with [[."),
    p.omitted.length ? [h("h3", { class: "eyebrow" }, `Left out · ${p.omitted.length}`), p.omitted.map((id) => row(id, S.include.has(id), true))] : null,
    S.exclude.size ? [h("h3", { class: "eyebrow" }, "Excluded"), [...S.exclude].map((id) => row(id, false, true))] : null,
  );
}

function togglePack(id, on) {
  if (on) { S.include.add(id); S.exclude.delete(id); } else { S.include.delete(id); S.exclude.add(id); }
  refreshPack();
}

let copiedT = 0;
async function copyPack() {
  if (!S.pack) return;
  try {
    await navigator.clipboard.writeText(S.pack.text);
  } catch {
    const t = h("textarea", { style: "position:fixed;opacity:0" });
    t.value = S.pack.text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  const btn = $("#copy-pack");
  $("#copy-label").textContent = "Copied";
  btn.classList.add("copied");
  clearTimeout(copiedT);
  copiedT = setTimeout(() => { $("#copy-label").textContent = "Copy pack"; btn.classList.remove("copied"); }, 1400);
}

// ---------- inspector tabs, panes, theme ----------

function selectTab(which, focus = false) {
  for (const t of ["links", "pack"]) {
    const on = t === which;
    const tab = $(`#tab-${t}`);
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`#panel-${t}`).hidden = !on;
    if (on && focus) tab.focus();
  }
}

const shell = $("#shell");
function setPane(which, off) {
  shell.classList.toggle(`${which}-off`, off);
  (which === "side" ? $("#sidebar") : $("#inspector")).inert = off;
  store.set(`sm-${which}-off`, off);
}
const togglePane = (which) => setPane(which, !shell.classList.contains(`${which}-off`));

const LIMITS = { side: [200, 340, "--side-w"], insp: [260, 420, "--insp-w"] };
function setWidth(which, w) {
  const [lo, hi, v] = LIMITS[which];
  w = Math.round(Math.max(lo, Math.min(hi, w)));
  document.documentElement.style.setProperty(v, `${w}px`);
  $(`.resizer[data-pane="${which}"]`).setAttribute("aria-valuenow", String(w));
  return w;
}
for (const r of $$(".resizer")) {
  const which = r.dataset.pane;
  const width = () => (which === "side" ? $("#sidebar") : $("#inspector")).getBoundingClientRect().width;
  r.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    r.setPointerCapture(e.pointerId);
    shell.classList.add("dragging");
    const box = shell.getBoundingClientRect();
    const move = (ev) => setWidth(which, which === "side" ? ev.clientX - box.left : box.right - ev.clientX);
    r.addEventListener("pointermove", move);
    r.addEventListener("pointerup", () => {
      r.removeEventListener("pointermove", move);
      shell.classList.remove("dragging");
      store.set(`sm-${which}-w`, Math.round(width()));
    }, { once: true });
  });
  r.addEventListener("keydown", (e) => {
    const d = { ArrowLeft: -10, ArrowRight: 10 }[e.key];
    if (!d) return;
    e.preventDefault();
    store.set(`sm-${which}-w`, setWidth(which, width() + (which === "side" ? d : -d)));
  });
}

const prefersDark = matchMedia("(prefers-color-scheme: dark)");
const theme = () => document.documentElement.dataset.theme || (prefersDark.matches ? "dark" : "light");
function syncThemeButton() {
  const dark = theme() === "dark", b = $("#theme-btn");
  $("use", b).setAttribute("href", dark ? "#i-sun" : "#i-moon");
  b.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}

// ---------- quick switcher ----------

const qs = $("#qs"), qi = $("#qs-input"), ql = $("#qs-list");
let qItems = [], qIdx = 0, qSeq = 0, qT = 0;

function openQs() {
  closeMenu(false);
  if (qs.open) { qi.select(); return; }
  qi.value = "";
  drawQs();
  qs.showModal();
  qi.focus();
}

function drawQs(empty) {
  const v = qi.value.trim().toLowerCase();
  const titleNode = (t) => {
    const i = v && !v.startsWith("/") ? t.toLowerCase().indexOf(v) : -1;
    return i < 0 ? h("span", { class: "t plain" }, t) : h("span", { class: "t" }, t.slice(0, i), h("b", {}, t.slice(i, i + v.length)), t.slice(i + v.length));
  };
  const opt = (n, i) => {
    const snip = n.snippet != null ? h("span", { class: "s" }) : null;
    if (snip) snip.innerHTML = snippetHtml(n.snippet); // escaped; only <mark> survives
    return h("li", {
      id: `qs-${i}`, role: "option", class: `opt${snip ? " two" : ""}`, "aria-selected": String(i === qIdx), "data-branch": branchOf(n.id),
      onclick: (e) => pickQs(i, e), onmousemove: () => { if (qIdx !== i) moveQs(i - qIdx); },
    }, h("span", { class: "dot" }), snip ? h("span", { class: "body" }, titleNode(n.title), snip) : titleNode(n.title), h("span", { class: "p" }, n.id));
  };
  ql.replaceChildren(...(qItems.length ? qItems.map(opt) : [h("li", { class: "empty", role: "presentation" }, empty || "No notes match. Try fewer words.")]));
  if (qItems.length) qi.setAttribute("aria-activedescendant", `qs-${qIdx}`);
  else qi.removeAttribute("aria-activedescendant");
}

function updateQs() {
  const v = qi.value;
  qIdx = 0;
  clearTimeout(qT);
  if (!v.startsWith("/")) {
    qSeq++;
    qItems = rankMatches(v, S.nodes, 10);
    return drawQs();
  }
  const q = v.slice(1).trim(), seq = ++qSeq;
  if (q.length < 2) { qItems = []; return drawQs("Searching note text. Type two letters or more."); }
  qT = setTimeout(async () => {
    let hits;
    try { hits = await api("GET", `/api/search?q=${encodeURIComponent(q)}`); } catch { return; }
    if (seq !== qSeq) return;
    qItems = hits.slice(0, 10);
    drawQs();
  }, 200);
}

function moveQs(d) {
  if (!qItems.length) return;
  qIdx = (qIdx + d + qItems.length) % qItems.length;
  $$(".opt", ql).forEach((o, i) => o.setAttribute("aria-selected", String(i === qIdx)));
  $(`#qs-${qIdx}`).scrollIntoView({ block: "nearest" });
  qi.setAttribute("aria-activedescendant", `qs-${qIdx}`);
}

function pickQs(i, e) {
  const n = qItems[i];
  if (!n) return;
  qs.close();
  if (e.shiftKey) addToPack(n.id);
  else openNote(n.id, e.metaKey || e.ctrlKey ? "split" : S.view === "split" ? "split" : "note");
}

qi.addEventListener("input", updateQs);
qi.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveQs(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveQs(-1); }
  else if (e.key === "Enter") { e.preventDefault(); pickQs(qIdx, e); }
});
qs.addEventListener("click", (e) => { if (e.target === qs) qs.close(); }); // backdrop

// ---------- wiring ----------

const body = $("#editor-body"), preview = $("#preview");
body.addEventListener("input", onBodyInput);
body.addEventListener("click", acUpdate);
body.addEventListener("keyup", (e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) acUpdate(); });
body.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== body) acClose(); }, 0));
body.addEventListener("keydown", (e) => {
  if (ac.hidden) return;
  if (e.key === "ArrowDown") { e.preventDefault(); acMove(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); acMove(-1); }
  else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) { e.preventDefault(); acPick(acIdx); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); acClose(); }
});
body.addEventListener("scroll", () => { acClose(); syncScroll(body, preview); });
preview.addEventListener("scroll", () => syncScroll(preview, body));

const openMissing = (a) => askCreate({ title: leaf(a.dataset.target), parent: S.note?.id });
preview.addEventListener("click", (e) => {
  const a = e.target.closest("a.wikilink.missing");
  if (a) { e.preventDefault(); openMissing(a); }
});
preview.addEventListener("keydown", (e) => {
  const a = e.target.closest("a.wikilink.missing");
  if (a && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openMissing(a); }
});

$("#f-title").addEventListener("input", edited);
$("#f-type").addEventListener("change", edited);
$("#f-pinned").addEventListener("change", edited);
$("#f-summary").addEventListener("input", () => { words(); edited(); });
$("#read-btn").addEventListener("click", () => setReading(!S.reading));
$("#c-reload").addEventListener("click", () => { const c = S.conflict; hideConflict(); setNote(c); });
$("#c-keep").addEventListener("click", () => { S.base = S.conflict.mtime_ns; hideConflict(); S.dirty = true; save(); });

$("#filter").addEventListener("input", () => { renderTree(); clearTimeout(searchT); searchT = setTimeout(runSearch, 200); });
$("#filter").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && e.target.value) {
    e.preventDefault();
    e.target.value = "";
    renderTree();
    runSearch();
  } else if (e.key === "Enter" || e.key === "ArrowDown") {
    e.preventDefault();
    ($("#search-results:not([hidden]) .hit") ?? $("#tree .row-link"))?.focus();
  }
});
$("#tree").addEventListener("keydown", treeKeys);
$("#tree").addEventListener("contextmenu", (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  e.preventDefault();
  openMenu(row.dataset.id, $(".more", row), e.clientX, e.clientY);
});
$("#new-btn").addEventListener("click", () => askCreate());

for (const b of $$(".views button")) b.addEventListener("click", () => showView(b.dataset.view));
$("#k-btn").addEventListener("click", openQs);
$("#pack-pill").addEventListener("click", () => {
  if (shell.classList.contains("insp-off")) setPane("insp", false);
  selectTab("pack", true);
});
$("#theme-btn").addEventListener("click", () => {
  const next = theme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("sm-theme", next); } catch {}
  syncThemeButton();
});
prefersDark.addEventListener("change", syncThemeButton);

$("#tab-links").addEventListener("click", () => selectTab("links"));
$("#tab-pack").addEventListener("click", () => selectTab("pack"));
$(".tabs").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    selectTab($("#tab-links").getAttribute("aria-selected") === "true" ? "pack" : "links", true);
  }
});
for (const b of $$(".presets button")) {
  b.addEventListener("click", () => {
    S.budget = Number(b.dataset.budget);
    for (const o of $$(".presets button")) o.setAttribute("aria-pressed", String(o === b));
    refreshPack();
  });
}
$("#copy-pack").addEventListener("click", copyPack);

// In-app note links keep the current view (split stays split).
document.addEventListener("click", (e) => {
  const a = e.target.closest?.('a[href^="#/n/"]');
  if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  openNote(a.getAttribute("href").slice(4));
});

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (!mod) return;
  if (k === "k" && !e.shiftKey) { e.preventDefault(); openQs(); }
  else if (k === "e" && !e.shiftKey) { e.preventDefault(); setReading(!S.reading); }
  else if (!e.shiftKey && ["1", "2", "3"].includes(e.key)) { e.preventDefault(); showView(["graph", "split", "note"][Number(e.key) - 1]); }
  else if (e.code === "Backslash") { e.preventDefault(); togglePane(e.shiftKey ? "insp" : "side"); }
  else if (k === "c" && e.shiftKey) { e.preventDefault(); copyPack(); }
  else if (k === "s" && !e.shiftKey) { e.preventDefault(); save(); }
});

addEventListener("hashchange", route);
addEventListener("focus", checkDisk);
document.addEventListener("visibilitychange", checkDisk);
addEventListener("beforeunload", (e) => {
  if (!S.dirty && !S.saving) return;
  save();
  e.preventDefault();
  e.returnValue = "";
});

// ---------- start ----------

for (const which of ["side", "insp"]) {
  const w = store.get(`sm-${which}-w`, null);
  setWidth(which, typeof w === "number" ? w : which === "side" ? 240 : 300);
  if (store.get(`sm-${which}-off`, false)) setPane(which, true);
}
syncThemeButton();
selectTab("links");
try { await refreshData(); } catch {}
await route();
