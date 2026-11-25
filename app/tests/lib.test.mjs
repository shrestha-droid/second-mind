import { test } from "node:test";
import assert from "node:assert/strict";
import { wikilinkQuery, rankMatches, safeHref, renderMarkdown, breadcrumb, orreryLayout, slugify, resolveTarget, snippetHtml, wordCount } from "../lib.js";

test("wikilinkQuery", () => {
  assert.deepEqual(wikilinkQuery("see [[jar", 9), { start: 4, query: "jar" });
  assert.deepEqual(wikilinkQuery("[[", 2), { start: 0, query: "" });
  assert.equal(wikilinkQuery("see [[jar]] x", 13), null);
  assert.equal(wikilinkQuery("see [[ja\nr", 10), null);
  assert.equal(wikilinkQuery("no link", 7), null);
  assert.deepEqual(wikilinkQuery("a [[b]] [[c", 11), { start: 8, query: "c" });
});

test("rankMatches orders prefix > title substring > id substring", () => {
  const nodes = [
    { id: "shrestha/x/zebra", title: "Zebra" },
    { id: "shrestha/jar/y", title: "Other" },
    { id: "shrestha/x/b", title: "Big Jar" },
    { id: "shrestha/x/a", title: "Jarvis" },
  ];
  assert.deepEqual(rankMatches("jar", nodes).map((n) => n.title), ["Jarvis", "Big Jar", "Other"]);
  assert.deepEqual(rankMatches("JAR", nodes, 1).map((n) => n.title), ["Jarvis"]);
  assert.deepEqual(rankMatches("", nodes, 2).map((n) => n.title), ["Big Jar", "Jarvis"]);
});

test("safeHref", () => {
  for (const bad of ["JaVaScRiPt:alert(1)", " javascript:x", "data:text/html,x", "vbscript:x", "java\tscript:x", "\u0001javascript:x", "file:///etc/passwd", ""]) {
    assert.equal(safeHref(bad), null, JSON.stringify(bad));
  }
  for (const ok of ["https://a.b", "http://a.b", "mailto:a@b.c", "#/n/x", "notes/a.md", "./a", "/a"]) {
    assert.equal(safeHref(ok), ok);
  }
});

test("renderMarkdown escapes html", () => {
  const out = renderMarkdown("hi <script>x</script>\n\n<img src=x onerror=y>\n\n<b>inline</b> ok", () => null);
  assert.ok(!/<script/i.test(out), out);
  assert.ok(!/<img/i.test(out), out);
  assert.ok(!/<b>/i.test(out), out);
  assert.ok(out.includes("&lt;script&gt;x&lt;/script&gt;"), out);
  assert.ok(out.includes("&lt;img src=x onerror=y&gt;"), out);
});

test("renderMarkdown links and images", () => {
  const out = renderMarkdown("[a](javascript:alert(1)) [b](https://x.y \"t\") ![i](data:x) ![j](pic.png)", () => null);
  assert.ok(!out.includes("javascript:"), out);
  assert.ok(!out.includes("data:"), out);
  assert.ok(out.includes('<a href="https://x.y"'), out);
  assert.ok(out.includes("<img"), out);
  assert.ok(out.includes('src="pic.png"'), out);
});

test("renderMarkdown wikilinks", () => {
  const resolve = (t) => (t === "Jar" ? "shrestha/work/jar" : null);
  const out = renderMarkdown("[[Jar]] [[Jar|the jar]] [[Nope|<b>\"x\"]] `[[Jar]]`", resolve);
  assert.ok(out.includes('<a class="wikilink" href="#/n/shrestha/work/jar">Jar</a>'), out);
  assert.ok(out.includes('<a class="wikilink" href="#/n/shrestha/work/jar">the jar</a>'), out);
  assert.ok(out.includes('<a class="wikilink missing" data-target="Nope">&lt;b&gt;&quot;x&quot;</a>'), out);
  assert.ok(out.includes("<code>[[Jar]]</code>"), out);
  const evil = renderMarkdown('[[a"onmouseover="x]]', () => null);
  assert.ok(!evil.includes('"onmouseover'), evil);
});

test("breadcrumb", () => {
  const t = (id) => id.toUpperCase();
  assert.deepEqual(breadcrumb("shrestha/work/hq", t), [
    { id: "shrestha", title: "SHRESTHA" },
    { id: "shrestha/work", title: "SHRESTHA/WORK" },
    { id: "shrestha/work/hq", title: "SHRESTHA/WORK/HQ" },
  ]);
  assert.deepEqual(breadcrumb("shrestha", t), [{ id: "shrestha", title: "SHRESTHA" }]);
});

const deg = (rad) => (rad * 180) / Math.PI;
const polar = (p) => ({ r: Math.hypot(p.x, p.y), a: deg(Math.atan2(p.y, p.x)) });
const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

function vault() {
  const mk = (id) => {
    const parts = id.split("/");
    return { id, parent: parts.length > 1 ? parts.slice(0, -1).join("/") : null, links: [] };
  };
  const ids = ["shrestha"];
  for (const b of ["work", "college", "social", "competitions", "builds"]) ids.push(`shrestha/${b}`);
  for (let i = 0; i < 6; i++) ids.push(`shrestha/builds/p${i}`);
  ids.push("shrestha/work/hq", "shrestha/work/hq/deep", "shrestha/work/hq/deep/deeper", "shrestha/work/hq/deep2");
  ids.push("inbox/a", "inbox/b", "inbox/c");
  return ids.map(mk);
}

test("orreryLayout", () => {
  const nodes = vault();
  const m = orreryLayout(nodes);
  assert.deepEqual(m.get("shrestha"), { x: 0, y: 0, depth: 0, branch: null });
  const w = m.get("shrestha/work");
  assert.ok(Math.abs(polar(w).r - 150) < 1e-9);
  assert.ok(angDiff(polar(w).a, -54) < 1e-9);
  assert.equal(w.depth, 1);
  assert.equal(w.branch, "work");
  for (const [b, bearing] of [["college", 18], ["social", 90], ["competitions", 162], ["builds", 234]]) {
    const p = polar(m.get(`shrestha/${b}`));
    assert.ok(Math.abs(p.r - 150) < 1e-9 && angDiff(p.a, bearing) < 1e-9, b);
  }
  const builds = [...m].filter(([id]) => /^shrestha\/builds\/[^/]+$/.test(id));
  assert.equal(builds.length, 6);
  const radii = new Set();
  for (const [, v] of builds) {
    const p = polar(v);
    assert.ok(angDiff(p.a, 234) <= 28 + 1e-9, `angle ${p.a}`);
    assert.ok(p.r >= 255 - 1e-9 && p.r <= 330 + 1e-9, `r ${p.r}`);
    assert.equal(v.depth, 2);
    assert.equal(v.branch, "builds");
    radii.add(Math.round(p.r));
  }
  assert.ok(radii.size > 1, "radii alternate when > 4 in a sector");
  // depth 3+: 38-58 px beyond parent along its bearing
  for (const [id, parent] of [["shrestha/work/hq/deep", "shrestha/work/hq"], ["shrestha/work/hq/deep/deeper", "shrestha/work/hq/deep"], ["shrestha/work/hq/deep2", "shrestha/work/hq"]]) {
    const c = m.get(id), p = m.get(parent);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    assert.ok(d >= 38 - 1e-9 && d <= 58 + 1e-9, `${id} d=${d}`);
    assert.ok(angDiff(polar(c).a, polar(p).a) < 1e-9, id);
  }
  // inbox
  const inbox = [...m].filter(([id]) => id.startsWith("inbox/"));
  assert.equal(inbox.length, 3);
  const angles = [];
  for (const [, v] of inbox) {
    const p = polar(v);
    assert.ok(Math.abs(p.r - 72) < 1e-9);
    assert.ok(p.a >= -120 - 1e-9 && p.a <= -60 + 1e-9);
    assert.equal(v.branch, "inbox");
    assert.equal(v.depth, 1);
    angles.push(p.a);
  }
  assert.ok(new Set(angles.map((a) => a.toFixed(6))).size === 3);
  // deterministic on shuffled input
  const shuffled = [...nodes].reverse().sort((a, b) => (a.id.length % 5) - (b.id.length % 5));
  assert.deepEqual([...orreryLayout(shuffled)], [...m]);
});

test("slugify mirrors the server", () => {
  assert.equal(slugify("Branch HQ"), "branch-hq");
  assert.equal(slugify("  --Hello, World!-- "), "hello-world");
  assert.equal(slugify("!!!"), "untitled");
  assert.equal(slugify("a".repeat(63) + " b"), "a".repeat(63));
});

test("resolveTarget", () => {
  const ids = new Set(["shrestha", "shrestha/builds/jarvis", "shrestha/work/x/dup", "shrestha/college/dup"]);
  assert.equal(resolveTarget("shrestha/builds/jarvis", ids), "shrestha/builds/jarvis");
  assert.equal(resolveTarget("builds/jarvis|J", ids), "shrestha/builds/jarvis");
  assert.equal(resolveTarget("Jarvis#Plan", ids), "shrestha/builds/jarvis");
  assert.equal(resolveTarget("dup", ids), null);
  assert.equal(resolveTarget("nope", ids), null);
  assert.equal(resolveTarget(" |x", ids), null);
});

test("snippetHtml escapes all but mark", () => {
  const out = snippetHtml('a <mark>b</mark> <script>x</script> <mark onclick="y">c</mark> & "q"');
  assert.equal(out, 'a <mark>b</mark> &lt;script&gt;x&lt;/script&gt; &lt;mark onclick=&quot;y&quot;&gt;c</mark> &amp; &quot;q&quot;');
});

test("wordCount", () => {
  assert.equal(wordCount(""), 0);
  assert.equal(wordCount("  one two\nthree "), 3);
});
