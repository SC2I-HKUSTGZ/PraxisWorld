/* PraxisWorld — Reference Knowledge Base
   Interactive D3 visualization: Obsidian-style force graph + collapsible
   survey tree, built from graph-data.json (generated from the latest Overleaf). */
(function () {
  "use strict";

  const svg = d3.select("#viz");
  const svgEl = svg.node();
  const panel = document.getElementById("panel");
  const pBody = document.getElementById("p-body");
  const pTag = document.getElementById("p-tag");
  const EMBEDDED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

  let DATA, NODES, LINKS, NEIGH = new Map();
  let sim, zoom, viewport, gGraph, gTree, gLink, gNode, gLabel;
  let mode = "graph";
  let selectedId = null, hoverId = null, activeSection = null, searchSet = null;
  let curScale = 0.85;
  let W = 0, H = 0, didInitialFit = false, fitTimer = null;

  const ROOT_COLOR = "#202124";
  const colorOf = (n) =>
    n.type === "root" ? ROOT_COLOR : (DATA.section_colors[n.section] || "#7B8794");

  function radius(n) {
    if (n.type === "root") return 17;
    if (n.type === "section") return 11;
    if (n.type === "subsection") return 7;
    return 4 + Math.min(n.cite_count || 0, 7) * 0.75; // reference
  }

  // ---------------------------------------------------------------- load
  fetch("graph-data.json")
    .then((r) => r.json())
    .then(init)
    .catch((e) => {
      document.getElementById("loading").textContent =
        "Failed to load graph-data.json (" + e + ")";
    });

  function init(data) {
    DATA = data;
    NODES = data.nodes.map((d) => Object.assign({}, d));
    const byId = new Map(NODES.map((n) => [n.id, n]));
    LINKS = data.links.map((l) => ({
      source: byId.get(l.source), target: byId.get(l.target), type: l.type,
    }));
    NODES.forEach((n) => NEIGH.set(n.id, new Set([n.id])));
    LINKS.forEach((l) => {
      NEIGH.get(l.source.id).add(l.target.id);
      NEIGH.get(l.target.id).add(l.source.id);
    });

    // Stat chips are optional (the embedded view omits them).
    const setStat = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setStat("stat-refs", data.meta.n_references_cited);
    setStat("stat-secs", data.meta.n_sections);
    setStat("stat-links", LINKS.filter((l) => l.type === "cite").length);

    buildLegend();
    setupSvg();
    buildGraph();
    buildTree();
    showGraph();
    const ld = document.getElementById("loading"); if (ld) ld.style.display = "none";

    // controls
    document.getElementById("view-graph").onclick = () => switchMode("graph");
    document.getElementById("view-tree").onclick = () => switchMode("tree");
    document.getElementById("reset").onclick = resetView;
    document.getElementById("p-close").onclick = closePanel;
    document.getElementById("search").addEventListener("input", (e) =>
      applySearch(e.target.value.trim().toLowerCase()));
    svg.on("click", (e) => { if (e.target === svgEl) { deselect(); } });
    window.addEventListener("resize", onResize);
  }

  // ---------------------------------------------------------------- legend
  function buildLegend() {
    const lg = d3.select("#legend");
    DATA.section_short.forEach((name, i) => {
      const chip = lg.append("span").attr("class", "chip").attr("data-sec", i);
      chip.append("span").attr("class", "dot").style("background", DATA.section_colors[i]);
      chip.append("span").text(name);
      chip.on("click", () => toggleSection(i));
    });
  }
  function toggleSection(i) {
    activeSection = activeSection === i ? null : i;
    d3.selectAll("#legend .chip").classed("dim", function () {
      return activeSection !== null && +this.dataset.sec !== activeSection;
    });
    refreshFilter();
  }

  // ---------------------------------------------------------------- svg/zoom
  function setupSvg() {
    measure();
    viewport = svg.append("g").attr("class", "viewport");
    gGraph = viewport.append("g").attr("class", "graph");
    gTree = viewport.append("g").attr("class", "tree").style("display", "none");
    gLink = gGraph.append("g").attr("class", "links");
    gNode = gGraph.append("g").attr("class", "nodes");
    gLabel = gGraph.append("g").attr("class", "labels");

    zoom = d3.zoom().scaleExtent([0.2, 4])
      .filter((e) => {
        // Embedded in the project page: let normal wheel scroll the page; require
        // Ctrl/Cmd to zoom. Standalone: wheel zooms directly.
        if (e.type === "wheel") return EMBEDDED ? (e.ctrlKey || e.metaKey) : true;
        return !e.button;
      })
      .on("zoom", (e) => {
        viewport.attr("transform", e.transform);
        curScale = e.transform.k;
        updateLabels();
      });
    svg.call(zoom).on("dblclick.zoom", null);

    // Fit once the element actually has a non-zero size (handles late layout /
    // headless preview sizing), and re-fit on genuine size changes.
    const ro = new ResizeObserver(() => {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(() => {
        measure();
        if (!W || !H) return;
        if (!didInitialFit) { didInitialFit = true; resetView(false); }
        else resetView(false);
      }, 80);
    });
    ro.observe(svgEl);
  }
  function measure() {
    const r = svgEl.getBoundingClientRect();
    W = r.width; H = r.height;
  }
  function onResize() {
    measure();
    resetView(false);
  }
  function resetView(animate = true) {
    measure();
    if (mode === "tree") fitTree(animate ? 450 : 0);
    else fitGraph(animate ? 450 : 0);
  }
  function applyFit(minX, minY, maxX, maxY, dur, maxScale) {
    if (!W || !H || !isFinite(minX) || maxX <= minX) return;
    const pad = 56;
    const bw = maxX - minX, bh = maxY - minY;
    const scale = Math.max(0.2, Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh, maxScale));
    const tx = W / 2 - scale * (minX + bw / 2);
    const ty = H / 2 - scale * (minY + bh / 2);
    const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
    (dur ? svg.transition().duration(dur) : svg).call(zoom.transform, t);
  }
  function fitGraph(dur) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    NODES.forEach((n) => {
      const r = radius(n);
      minX = Math.min(minX, n.x - r); maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r); maxY = Math.max(maxY, n.y + r);
    });
    applyFit(minX, minY, maxX, maxY, dur, 1.3);
  }
  function fitTree(dur) {
    // Indented outline tree: anchor near the top-left at 1:1; user pans to scroll.
    if (!troot || !W || !H) return;
    const t = d3.zoomIdentity.translate(52, 38).scale(1);
    (dur ? svg.transition().duration(dur) : svg).call(zoom.transform, t);
  }

  // ---------------------------------------------------------------- graph
  function buildGraph() {
    gLink.selectAll("line").data(LINKS).join("line")
      .attr("class", (d) => "link " + d.type);

    const node = gNode.selectAll("g.node").data(NODES, (d) => d.id).join("g")
      .attr("class", (d) => "node " + d.type)
      .call(drag())
      .on("mouseenter", (e, d) => setHover(d.id))
      .on("mouseleave", () => setHover(null))
      .on("click", (e, d) => { e.stopPropagation(); selectNode(d); });
    node.append("circle")
      .attr("r", radius)
      .attr("fill", colorOf)
      .append("title").text((d) => d.fullTitle || d.label);

    gLabel.selectAll("text.label").data(NODES, (d) => d.id).join("text")
      .attr("class", (d) => "label " + d.type)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => -(radius(d) + 4))
      .text((d) => d.label);

    if (NODES.find((n) => n.id === "root")) {
      const root = NODES.find((n) => n.id === "root");
      root.fx = 0; root.fy = 0;
    }

    sim = d3.forceSimulation(NODES)
      .force("link", d3.forceLink(LINKS).id((d) => d.id)
        .distance((l) => l.type === "tree" ? (l.source.type === "root" ? 130 : 66) : 34)
        .strength((l) => l.type === "tree" ? 0.55 : 0.22))
      .force("charge", d3.forceManyBody()
        .strength((d) => d.type === "root" ? -1100 : d.type === "section" ? -420
          : d.type === "subsection" ? -190 : -52).distanceMax(460))
      .force("collide", d3.forceCollide().radius((d) => radius(d) + 3.5))
      .force("x", d3.forceX(0).strength(0.045))
      .force("y", d3.forceY(0).strength(0.06))
      .on("tick", ticked);

    // Fully settle once for a calm, stable entrance, then freeze; drag/resize reheat.
    sim.alpha(1);
    for (let i = 0; i < 320; i++) sim.tick();
    sim.stop();
    ticked();
  }

  function ticked() {
    gLink.selectAll("line")
      .attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
    gNode.selectAll("g.node").attr("transform", (d) => `translate(${d.x},${d.y})`);
    gLabel.selectAll("text.label").attr("transform", (d) => `translate(${d.x},${d.y})`);
  }

  function drag() {
    return d3.drag()
      .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => {
        if (!e.active) sim.alphaTarget(0);
        if (d.type !== "root") { d.fx = null; d.fy = null; }
      });
  }

  // ---------------------------------------------------------------- highlight / labels
  function setHover(id) {
    hoverId = id;
    applyHighlight();
  }
  function activeHighlightSet() {
    const focus = hoverId || selectedId;
    return focus ? NEIGH.get(focus) : null;
  }
  function applyHighlight() {
    const hl = activeHighlightSet();
    gNode.selectAll("g.node").classed("faded", (d) =>
      (hl && !hl.has(d.id)) || (activeSection !== null && !sectionMatch(d)) ||
      (searchSet && !searchSet.has(d.id)))
      .classed("sel", (d) => d.id === selectedId);
    gLink.selectAll("line")
      .classed("hl", (d) => hl && hl.has(d.source.id) && hl.has(d.target.id))
      .style("display", (d) => {
        if (activeSection !== null && !(sectionMatch(d.source) && sectionMatch(d.target))) return "none";
        return null;
      });
    updateLabels();
  }
  function sectionMatch(d) {
    return activeSection === null || d.section === activeSection || d.type === "root";
  }
  function updateLabels() {
    const hl = activeHighlightSet();
    gLabel.selectAll("text.label").style("display", (d) => {
      if (activeSection !== null && !sectionMatch(d)) return "none";
      if (searchSet && !searchSet.has(d.id)) return "none";
      if (d.type !== "reference") return null;                 // sections/subs/root always
      if (hl && hl.has(d.id)) return null;                     // ego network
      if (searchSet && searchSet.has(d.id)) return null;       // search matches
      if (curScale > 1.7) return null;                         // zoomed in
      return "none";
    }).classed("faded", (d) => hl && !hl.has(d.id) && d.type !== "reference");
  }
  function refreshFilter() { applyHighlight(); }

  // ---------------------------------------------------------------- selection / panel
  function selectNode(d) {
    selectedId = d.id;
    applyHighlight();
    renderPanel(d);
  }
  function deselect() {
    selectedId = null; applyHighlight(); closePanel();
  }
  function closePanel() {
    panel.classList.remove("open");
    if (selectedId) { selectedId = null; applyHighlight(); }
  }

  function renderPanel(d) {
    const sec = d.section >= 0 ? d.section : null;
    const col = d.type === "root" ? "#1a73e8" : (DATA.section_colors[d.section] || "#7B8794");
    pTag.style.background = col;
    panel.classList.add("open");

    if (d.type === "reference") {
      const r = DATA.references[d.key] || {};
      pTag.textContent = (r.type || "reference");
      let html = `<h2 class="ptitle">${esc(r.title || d.key)}</h2>`;
      html += `<div class="meta-row"><span class="k">Year</span> · ${esc(r.year || "n.d.")} &nbsp;|&nbsp; <span class="k">Venue</span> · ${esc(r.venue || "")}</div>`;
      if (r.authors && r.authors.length)
        html += `<div class="authors-full">${esc(r.authors.join(", "))}</div>`;
      html += `<div class="meta-row"><span class="k">Citation key</span> · <code>${esc(d.key)}</code> &nbsp;|&nbsp; cited <b>${r.cite_count || 0}×</b></div>`;
      if (r.url) html += `<div class="meta-row"><a href="${esc(r.url)}" target="_blank" rel="noopener">Open source ↗</a></div>`;
      if (r.cited_in && r.cited_in.length) {
        html += `<h3>Cited in</h3><div class="cited-list">`;
        r.cited_in.forEach((c) => {
          const cc = DATA.section_colors[c.section_idx];
          const label = c.subsection ? `${DATA.section_short[c.section_idx]} › ${c.subsection}` : DATA.section_short[c.section_idx];
          html += `<a href="#" data-go="sec:${c.section_idx}"><span class="swatch" style="background:${cc}"></span>${esc(label)}</a>`;
        });
        html += `</div>`;
      }
      if (r.bibtex) {
        html += `<h3>BibTeX</h3><pre id="bib">${esc(r.bibtex)}</pre><button class="copy" id="copybib">Copy BibTeX</button>`;
      }
      pBody.innerHTML = html;
      wirePanel();
    } else if (d.type === "section") {
      pTag.textContent = "Section";
      const sObj = DATA.sections[d.section];
      let html = `<h2 class="ptitle">${esc(d.fullTitle || d.label)}</h2>`;
      html += `<div class="meta-row"><b>${d.nrefs}</b> references cited in this section</div>`;
      if (sObj && sObj.subsections && sObj.subsections.length) {
        html += `<h3>Subsections</h3><div class="sublist">`;
        sObj.subsections.forEach((s) =>
          html += `<div style="border-color:${col}">${esc(s.title)} <span class="k">(${s.cites.length})</span></div>`);
        html += `</div>`;
      }
      pBody.innerHTML = html;
    } else if (d.type === "subsection") {
      pTag.textContent = "Subsection";
      pBody.innerHTML = `<h2 class="ptitle">${esc(d.label)}</h2>
        <div class="meta-row">Part of <b>${esc(DATA.section_short[d.section])}</b></div>
        <div class="meta-row"><b>${d.nrefs}</b> references cited here</div>`;
    } else {
      pTag.textContent = "Survey";
      pBody.innerHTML = `<h2 class="ptitle">${esc(DATA.meta.title)}</h2>
        <div class="authors-full">${esc(DATA.meta.subtitle)}</div>
        <div class="meta-row"><b>${DATA.meta.n_references_cited}</b> references · <b>${DATA.meta.n_sections}</b> sections · ${DATA.meta.n_bib_entries} bib entries</div>
        <h3>Sections</h3><div class="sublist">` +
        DATA.section_short.slice(0, DATA.meta.n_sections).map((s, i) =>
          `<div style="border-color:${DATA.section_colors[i]}">${i + 1}. ${esc(s)}</div>`).join("") +
        `</div>`;
    }
  }
  function wirePanel() {
    const cb = document.getElementById("copybib");
    if (cb) cb.onclick = async () => {
      try { await navigator.clipboard.writeText(document.getElementById("bib").textContent);
        cb.textContent = "Copied ✓"; setTimeout(() => cb.textContent = "Copy BibTeX", 1400);
      } catch { cb.textContent = "Copy failed"; }
    };
    pBody.querySelectorAll("[data-go]").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); focusById(a.dataset.go); }));
  }
  function focusById(id) {
    if (mode !== "graph") switchMode("graph");
    const n = NODES.find((x) => x.id === id);
    if (!n) return;
    selectNode(n);
    const t = d3.zoomIdentity.translate(W / 2 - n.x * 1.1, H / 2 - n.y * 1.1).scale(1.1);
    svg.transition().duration(550).call(zoom.transform, t);
  }

  // ---------------------------------------------------------------- search
  function applySearch(q) {
    if (!q) { searchSet = null; applyHighlight(); if (mode === "tree") renderTree(); return; }
    const hits = new Set();
    NODES.forEach((n) => {
      const r = n.key ? DATA.references[n.key] : null;
      const hay = [n.label, n.fullTitle, n.key, r && r.title, r && (r.authors || []).join(" "), r && r.venue]
        .filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) hits.add(n.id);
    });
    searchSet = hits;
    if (mode === "graph") applyHighlight();
    else renderTree();
  }

  // ---------------------------------------------------------------- mode switch
  function switchMode(m) {
    if (m === mode) return;
    mode = m;
    document.getElementById("view-graph").classList.toggle("active", m === "graph");
    document.getElementById("view-tree").classList.toggle("active", m === "tree");
    if (m === "graph") showGraph(); else showTree();
  }
  function showGraph() {
    gTree.style("display", "none"); gGraph.style("display", null);
    const h = document.getElementById("hint");
    if (h) h.textContent = EMBEDDED
      ? "Drag to pan · Ctrl/⌘+scroll to zoom · click a node for details"
      : "Drag to pan · scroll to zoom · click a node for details";
    resetView();
    applyHighlight();
  }
  function showTree() {
    gGraph.style("display", "none"); gTree.style("display", null);
    const h = document.getElementById("hint");
    if (h) h.textContent = "Click a row to expand · drag to pan · click a reference for details";
    renderTree();
    resetView();
  }

  // ---------------------------------------------------------------- tree
  let troot;
  function buildTree() {
    troot = d3.hierarchy(DATA.tree);
    troot.descendants().forEach((d) => {
      if (d.depth >= 1 && d.children) { d._children = d.children; d.children = null; }
    });
  }
  const ROW_H = 24, INDENT = 22;
  function renderTree() {
    gTree.selectAll("*").remove();
    // auto-expand to search matches
    if (searchSet) expandForSearch(troot);

    // Visible rows via depth-first walk (only currently-expanded children).
    const rows = [];
    (function walk(d) { rows.push(d); (d.children || []).forEach(walk); })(troot);
    rows.forEach((d, i) => { d.rx = d.depth * INDENT; d.ry = i * ROW_H; });

    const dimmed = (d) => searchSet && d.data.type === "reference" && !searchSet.has("ref:" + d.data.key);
    const dotColor = (d) => d.data.type === "root" ? ROOT_COLOR : (DATA.section_colors[d.data.section] ?? "#7B8794");
    const hasKids = (d) => !!(d.children || d._children);

    // Elbow connectors: a vertical guide under each expanded parent + a stub to each child.
    const lg = gTree.append("g").attr("class", "tlinks");
    rows.forEach((p) => {
      if (!p.children || !p.children.length) return;
      const vx = p.rx + 5;
      p.children.forEach((c) => {
        lg.append("path").attr("class", "tguide").attr("d", `M${vx},${p.ry + 9} V${c.ry} H${c.rx + 1}`);
      });
    });

    const tn = gTree.append("g").attr("class", "tnodes")
      .selectAll("g.trow").data(rows).join("g")
      .attr("class", (d) => "trow t-" + d.data.type)
      .attr("transform", (d) => `translate(${d.rx},${d.ry})`)
      .on("click", (e, d) => {
        e.stopPropagation();
        if (d.data.type === "reference") {
          const n = NODES.find((x) => x.id === "ref:" + d.data.key); if (n) selectNode(n); return;
        }
        if (d.children) { d._children = d.children; d.children = null; }
        else if (d._children) { d.children = d._children; d._children = null; }
        renderTree();
      });

    // Full-row hover/click hit area.
    tn.append("rect").attr("class", "trow-hit")
      .attr("x", -8).attr("y", -ROW_H / 2 + 1).attr("width", 380).attr("height", ROW_H - 2).attr("rx", 5);

    // Expand/collapse caret for internal nodes.
    tn.filter(hasKids).append("text").attr("class", "caret")
      .attr("x", -11).attr("dy", "0.32em").text((d) => d.children ? "▾" : "▸");

    // Colored section dot.
    tn.append("circle")
      .attr("cx", 5).attr("cy", 0)
      .attr("r", (d) => d.data.type === "root" ? 5 : d.data.type === "section" ? 4.6 : d.data.type === "subsection" ? 4 : 3.2)
      .attr("fill", dotColor)
      .attr("opacity", (d) => dimmed(d) ? 0.3 : 1);

    // Label.
    tn.append("text").attr("class", "tlabel")
      .attr("x", 15).attr("dy", "0.32em")
      .style("font-weight", (d) => d.data.type === "root" ? 700 : d.data.type === "section" ? 600 : d.data.type === "subsection" ? 500 : 400)
      .style("opacity", (d) => dimmed(d) ? 0.4 : 1)
      .text((d) => d.data.name + (d._children ? `  (${count(d._children)})` : ""));
  }
  function count(stash) {
    // total reference leaves under a stashed (collapsed) subtree
    return stash.reduce((a, c) => a + leaves(c), 0);
  }
  function leaves(d) {
    const kids = d.children || d._children;
    if (!kids) return d.data.type === "reference" ? 1 : 0;
    return kids.reduce((a, c) => a + leaves(c), 0);
  }
  function expandForSearch(node) {
    let has = false;
    const kids = node.children || node._children;
    if (kids) {
      kids.forEach((c) => { if (expandForSearch(c)) has = true; });
      if (has) { if (node._children) { node.children = node._children; node._children = null; } }
    }
    if (node.data.type === "reference" && searchSet && searchSet.has("ref:" + node.data.key)) return true;
    return has;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
