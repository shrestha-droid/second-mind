// Read-only demo: answers the app's /api calls from data.json (built by demo/build.py).
// Saves stay in memory for this tab; create, move and trash are refused.
(() => {
  const realFetch = window.fetch.bind(window);
  const data = realFetch("data.json").then((r) => r.json());
  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const esc = (s) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);

  function search(d, q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    for (const n of Object.values(d.notes)) {
      const title = String(n.meta.title || n.id), text = `${title} ${n.meta.summary || ""} ${n.body}`;
      const low = text.toLowerCase();
      if (!terms.every((t) => low.includes(t))) continue;
      const at = Math.max(0, low.indexOf(terms[0]) - 40);
      let snip = esc(text.slice(at, at + 120).replace(/\s+/g, " "));
      for (const t of terms) snip = snip.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`);
      out.push({ id: n.id, title, snippet: (at ? "…" : "") + snip + "…" });
    }
    return out.slice(0, 20);
  }

  window.fetch = async (input, opt = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const path = url.pathname.replace(/^.*\/api\//, "/api/");
    if (!path.startsWith("/api/")) return realFetch(input, opt);
    const d = await data, method = (opt.method || "GET").toUpperCase(), q = url.searchParams;
    if (method === "GET") {
      if (path === "/api/tree") return json(200, d.tree);
      if (path === "/api/graph") return json(200, d.graph);
      if (path === "/api/note") return d.notes[q.get("id")] ? json(200, d.notes[q.get("id")]) : json(404, { error: "not found" });
      if (path === "/api/search") return json(200, search(d, q.get("q") || ""));
      if (path === "/api/pack") {
        // ponytail: packs are precomputed per preset budget; include/exclude need the local server
        const p = d.packs[q.get("id")];
        return p ? json(200, p[q.get("budget")] || p["1500"]) : json(404, { error: "not found" });
      }
    }
    if (method === "PUT" && path === "/api/note") {
      const b = JSON.parse(opt.body), n = d.notes[b.id];
      if (!n) return json(404, { error: "not found" });
      Object.assign(n, { meta: b.meta, body: b.body, mtime_ns: String(BigInt(n.mtime_ns) + 1n) });
      return json(200, n);
    }
    return json(403, { error: "This demo is read-only. Run Second Mind locally to create, move or delete notes." });
  };
})();
