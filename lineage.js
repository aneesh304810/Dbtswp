/* global cytoscape, dagre, cytoscapeDagre */
(function () {
  'use strict';

  // ── Bootstrap ────────────────────────────────────────────────────────────
  const vscode = acquireVsCodeApi();
  if (typeof cytoscapeDagre === 'function') cytoscapeDagre(cytoscape);
  else if (typeof window.cytoscapeDagre === 'function') window.cytoscapeDagre(cytoscape);

  // ── Layer colours (match CSS legend) ────────────────────────────────────
  const LAYER = {
    raw:          { bg: '#3a4a63', border: '#6b87b3', label: 'Raw / Sources'  },
    staging:      { bg: '#2f5b3e', border: '#5db173', label: 'Staging'        },
    intermediate: { bg: '#4a4326', border: '#b39a4d', label: 'Intermediate'   },
    mart:         { bg: '#5b3a26', border: '#c2864a', label: 'Marts'          },
    unknown:      { bg: '#3a3a3a', border: '#7a7a7a', label: 'Other'          }
  };

  // ── State ────────────────────────────────────────────────────────────────
  let allNodes       = [];   // full graph data from manifest
  let allEdges       = [];
  let visibleNodeIds = new Set();
  let focusedNodeId  = null;
  let upDepth        = 2;
  let downDepth      = 2;
  let layerFilter    = { raw: true, staging: true, intermediate: true, mart: true, unknown: true };
  let searchQuery    = '';
  let searchResults  = [];
  let searchIdx      = -1;

  // ── Cytoscape init ───────────────────────────────────────────────────────
  const cy = cytoscape({
    container: document.getElementById('cy'),
    elements: [],
    wheelSensitivity: 0.25,
    minZoom: 0.05,
    maxZoom: 3,
    style: [
      {
        selector: 'node',
        style: {
          'background-color': 'data(bgColor)',
          'border-color': 'data(borderColor)',
          'border-width': 1.5,
          'label': 'data(label)',
          'font-family': 'var(--vscode-editor-font-family, monospace)',
          'font-size': 11,
          'color': '#e0e0e0',
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': 130,
          'width': 'label',
          'height': 34,
          'padding': 12,
          'shape': 'round-rectangle',
          'transition-property': 'opacity, border-width, border-color',
          'transition-duration': 180
        }
      },
      { selector: 'node[layer="raw"]',          style: { 'background-color': LAYER.raw.bg,          'border-color': LAYER.raw.border } },
      { selector: 'node[layer="staging"]',       style: { 'background-color': LAYER.staging.bg,      'border-color': LAYER.staging.border } },
      { selector: 'node[layer="intermediate"]',  style: { 'background-color': LAYER.intermediate.bg, 'border-color': LAYER.intermediate.border } },
      { selector: 'node[layer="mart"]',          style: { 'background-color': LAYER.mart.bg,         'border-color': LAYER.mart.border } },
      { selector: 'node[layer="unknown"]',       style: { 'background-color': LAYER.unknown.bg,      'border-color': LAYER.unknown.border } },
      {
        selector: 'edge',
        style: {
          'curve-style': 'bezier',
          'width': 1.2,
          'line-color': '#6e6e6e',
          'target-arrow-color': '#6e6e6e',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.9,
          'opacity': 0.85,
          'transition-property': 'opacity',
          'transition-duration': 180
        }
      },
      { selector: '.upstream',    style: { 'border-width': 3, 'border-color': '#4ec9b0' } },
      { selector: '.downstream',  style: { 'border-width': 3, 'border-color': '#dcdcaa' } },
      { selector: '.focus',       style: { 'border-width': 4, 'border-color': '#f48771' } },
      { selector: '.dimmed',      style: { 'opacity': 0.15 } },
      // Expand indicator on nodes that have hidden neighbours
      {
        selector: '.has-hidden',
        style: {
          'border-style': 'dashed',
          'border-width': 2
        }
      }
    ]
  });

  // ── Build legend swatches ────────────────────────────────────────────────
  Object.entries(LAYER).forEach(([key, val]) => {
    const dot = document.querySelector('.legend-dot[data-layer="' + key + '"]');
    if (dot) dot.style.background = val.bg;
  });

  // ── Layer toggle checkboxes ──────────────────────────────────────────────
  document.querySelectorAll('.layer-toggle input').forEach(cb => {
    cb.addEventListener('change', function () {
      layerFilter[this.dataset.layer] = this.checked;
      if (focusedNodeId) {
        applyDepthView(focusedNodeId);
      } else {
        refreshVisible();
      }
    });
  });

  // ── Depth sliders ────────────────────────────────────────────────────────
  const upSlider   = document.getElementById('upDepth');
  const downSlider = document.getElementById('downDepth');
  const upVal      = document.getElementById('upDepthVal');
  const downVal    = document.getElementById('downDepthVal');

  upSlider.addEventListener('input', function () {
    upDepth = parseInt(this.value, 10);
    upVal.textContent = upDepth;
    if (focusedNodeId) applyDepthView(focusedNodeId);
  });
  downSlider.addEventListener('input', function () {
    downDepth = parseInt(this.value, 10);
    downVal.textContent = downDepth;
    if (focusedNodeId) applyDepthView(focusedNodeId);
  });

  // ── Mode buttons ─────────────────────────────────────────────────────────
  document.querySelectorAll('.dpi-mode-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.dpi-mode-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const mode = this.dataset.mode;
      if (mode === 'all') {
        focusedNodeId = null;
        refreshVisible();
        updateBreadcrumbs();
      } else if (mode === 'focus' && focusedNodeId) {
        applyDepthView(focusedNodeId);
      } else if (mode === 'impact' && focusedNodeId) {
        applyImpactView(focusedNodeId);
      }
    });
  });

  // ── Search ───────────────────────────────────────────────────────────────
  const searchInput    = document.getElementById('searchInput');
  const searchDropdown = document.getElementById('searchDropdown');

  searchInput.addEventListener('input', function () {
    searchQuery = this.value.trim().toLowerCase();
    if (!searchQuery) { closeDropdown(); return; }
    const q = searchQuery;
    searchResults = allNodes.filter(n =>
      n.data.label.toLowerCase().includes(q) ||
      (n.data.id && n.data.id.toLowerCase().includes(q))
    ).slice(0, 8);
    renderDropdown();
  });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown')  { searchIdx = Math.min(searchIdx + 1, searchResults.length - 1); highlightDropdownItem(); e.preventDefault(); }
    if (e.key === 'ArrowUp')    { searchIdx = Math.max(searchIdx - 1, 0);                        highlightDropdownItem(); e.preventDefault(); }
    if (e.key === 'Enter')      { if (searchIdx >= 0 && searchResults[searchIdx]) selectResult(searchResults[searchIdx]); }
    if (e.key === 'Escape')     { closeDropdown(); searchInput.blur(); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.dpi-search-wrap')) closeDropdown();
  });

  function renderDropdown() {
    if (!searchResults.length) { closeDropdown(); return; }
    searchIdx = -1;
    searchDropdown.innerHTML = searchResults.map((n, i) => {
      const layer = n.data.layer || 'unknown';
      const c = LAYER[layer] ? LAYER[layer].border : '#888';
      return '<div class="dpi-search-result" data-i="' + i + '">' +
        '<span class="res-layer-pip" style="background:' + c + '"></span>' +
        '<span class="res-name">' + esc(n.data.label) + '</span>' +
        '<span class="res-layer">' + layer + '</span>' +
        '</div>';
    }).join('');
    searchDropdown.classList.add('open');
    searchDropdown.querySelectorAll('.dpi-search-result').forEach(el => {
      el.addEventListener('click', function () { selectResult(searchResults[parseInt(this.dataset.i, 10)]); });
    });
  }
  function highlightDropdownItem() {
    searchDropdown.querySelectorAll('.dpi-search-result').forEach((el, i) => {
      el.classList.toggle('active', i === searchIdx);
    });
  }
  function selectResult(node) {
    searchInput.value = node.data.label;
    closeDropdown();
    focusNode(node.data.id);
  }
  function closeDropdown() {
    searchDropdown.classList.remove('open');
    searchDropdown.innerHTML = '';
    searchResults = [];
    searchIdx = -1;
  }

  // ── Toolbar buttons ───────────────────────────────────────────────────────
  document.getElementById('fitBtn').addEventListener('click', function () {
    cy.fit(cy.elements(':visible'), 30);
  });
  document.getElementById('resetBtn').addEventListener('click', function () {
    focusedNodeId = null;
    cy.elements().removeClass('upstream downstream focus dimmed has-hidden');
    refreshVisible();
    closeDetail();
    updateBreadcrumbs();
  });
  document.querySelector('.dpi-zoom-btn[data-action="in"]').addEventListener('click',  () => cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: { x: cy.width()/2, y: cy.height()/2 } }));
  document.querySelector('.dpi-zoom-btn[data-action="out"]').addEventListener('click', () => cy.zoom({ level: cy.zoom() / 1.25, renderedPosition: { x: cy.width()/2, y: cy.height()/2 } }));
  document.querySelector('.dpi-zoom-btn[data-action="fit"]').addEventListener('click', () => cy.fit(cy.elements(':visible'), 30));

  // ── Breadcrumb ────────────────────────────────────────────────────────────
  function updateBreadcrumbs(nodeLabel) {
    const bc = document.getElementById('breadcrumbs');
    if (!nodeLabel) {
      bc.innerHTML = '<span class="crumb current">All models</span>';
    } else {
      bc.innerHTML =
        '<span class="crumb" id="bcAll">All</span>' +
        '<span class="crumb-sep">›</span>' +
        '<span class="crumb current">' + esc(nodeLabel) + '</span>';
      document.getElementById('bcAll').addEventListener('click', function () {
        focusedNodeId = null;
        cy.elements().removeClass('upstream downstream focus dimmed has-hidden');
        refreshVisible();
        closeDetail();
        updateBreadcrumbs();
        setActiveMode('all');
      });
    }
  }

  // ── Node click ────────────────────────────────────────────────────────────
  cy.on('tap', 'node', function (evt) {
    const id = evt.target.id();
    focusNode(id);
    vscode.postMessage({ command: 'nodeClicked', nodeId: id });
  });
  cy.on('tap', function (evt) {
    if (evt.target === cy) {
      cy.elements().removeClass('upstream downstream focus dimmed');
      markHasHidden();
      closeDetail();
    }
  });

  // ── Core: focus on a node ─────────────────────────────────────────────────
  function focusNode(nodeId) {
    focusedNodeId = nodeId;
    setActiveMode('focus');
    applyDepthView(nodeId);
    // open detail panel
    const nodeData = findNodeData(nodeId);
    if (nodeData) {
      openDetail(nodeData);
      updateBreadcrumbs(nodeData.data.label);
    }
  }

  // ── Depth view: show focus node + N hops up + M hops down ────────────────
  function applyDepthView(nodeId) {
    const node = cy.getElementById(nodeId);
    if (!node || node.empty()) return;

    // Collect reachable nodes within depth limits
    const include = new Set([nodeId]);

    // Upstream (predecessors)
    let frontier = [node];
    for (let d = 0; d < upDepth; d++) {
      const next = [];
      frontier.forEach(n => {
        n.incomers('node').forEach(p => {
          if (!include.has(p.id())) { include.add(p.id()); next.push(p); }
        });
      });
      frontier = next;
      if (!frontier.length) break;
    }
    // Downstream (successors)
    frontier = [node];
    for (let d = 0; d < downDepth; d++) {
      const next = [];
      frontier.forEach(n => {
        n.outgoers('node').forEach(s => {
          if (!include.has(s.id())) { include.add(s.id()); next.push(s); }
        });
      });
      frontier = next;
      if (!frontier.length) break;
    }

    // Apply layer filter
    const filtered = new Set([...include].filter(id => {
      const n = cy.getElementById(id);
      const layer = n.data('layer') || 'unknown';
      return layerFilter[layer] !== false;
    }));

    // Show/hide nodes
    cy.nodes().forEach(n => {
      if (filtered.has(n.id())) {
        n.style('display', 'element');
      } else {
        n.style('display', 'none');
      }
    });
    cy.edges().forEach(e => {
      const show = filtered.has(e.source().id()) && filtered.has(e.target().id());
      e.style('display', show ? 'element' : 'none');
    });

    // Apply highlight classes
    cy.elements().removeClass('upstream downstream focus dimmed has-hidden');
    const allPreds = new Set(node.predecessors('node').map(n => n.id()));
    const allSuccs = new Set(node.successors('node').map(n => n.id()));

    cy.nodes().forEach(n => {
      if (!filtered.has(n.id())) return;
      const id = n.id();
      if (id === nodeId)          n.addClass('focus');
      else if (allPreds.has(id))  n.addClass('upstream');
      else if (allSuccs.has(id))  n.addClass('downstream');
    });

    markHasHidden();
    reLayout();
    updateCounter();
    setStatus('Focus: ' + nodeId + ' · ' + (filtered.size - 1) + ' visible neighbours');
  }

  // ── Impact view: all upstream + downstream with dimming ──────────────────
  function applyImpactView(nodeId) {
    const node = cy.getElementById(nodeId);
    if (!node || node.empty()) return;

    cy.nodes().forEach(n => n.style('display', 'element'));
    cy.edges().forEach(e => e.style('display', 'element'));
    cy.elements().removeClass('upstream downstream focus dimmed has-hidden');

    const preds = new Set(node.predecessors('node').map(n => n.id()));
    const succs = new Set(node.successors('node').map(n => n.id()));

    cy.nodes().forEach(n => {
      const id = n.id();
      if (id === nodeId)        n.addClass('focus');
      else if (preds.has(id))   n.addClass('upstream');
      else if (succs.has(id))   n.addClass('downstream');
      else                      n.addClass('dimmed');
    });
    cy.edges().forEach(e => {
      const s = e.source().id(), t = e.target().id();
      const on = (s === nodeId || t === nodeId) ||
        (preds.has(s) && (preds.has(t) || t === nodeId)) ||
        (succs.has(t) && (succs.has(s) || s === nodeId));
      if (!on) e.addClass('dimmed');
    });

    cy.fit(cy.nodes(':not(.dimmed)'), 40);
    updateCounter();
    setStatus('Impact: ' + preds.size + ' upstream · ' + succs.size + ' downstream');
  }

  // ── Show all (respecting layer filter) ───────────────────────────────────
  function refreshVisible() {
    cy.nodes().forEach(n => {
      const layer = n.data('layer') || 'unknown';
      n.style('display', layerFilter[layer] !== false ? 'element' : 'none');
    });
    cy.edges().forEach(e => {
      const show = e.source().style('display') !== 'none' && e.target().style('display') !== 'none';
      e.style('display', show ? 'element' : 'none');
    });
    cy.elements().removeClass('upstream downstream focus dimmed has-hidden');
    markHasHidden();
    reLayout();
    updateCounter();
    setStatus(cy.nodes(':visible').length + ' models · ' + cy.edges(':visible').length + ' edges');
  }

  // ── Has-hidden: nodes with invisible neighbours get dashed border ─────────
  function markHasHidden() {
    cy.nodes().forEach(n => {
      if (n.style('display') === 'none') return;
      const hiddenNeighbours = n.neighborhood('node').filter(nb => nb.style('display') === 'none');
      if (hiddenNeighbours.length > 0) n.addClass('has-hidden');
      else n.removeClass('has-hidden');
    });
  }

  // ── Layout ───────────────────────────────────────────────────────────────
  function reLayout() {
    const visible = cy.nodes(':visible');
    if (!visible.length) return;
    cy.layout({
      name: 'dagre',
      rankDir: 'LR',
      nodeSep: 28,
      rankSep: 80,
      edgeSep: 10,
      animate: visible.length < 80,
      animationDuration: 250,
      fit: true,
      padding: 36
    }).run();
  }

  // ── Detail panel ──────────────────────────────────────────────────────────
  const detailPanel = document.getElementById('detailPanel');

  function openDetail(nodeData) {
    const d = nodeData.data;
    const layer = d.layer || 'unknown';
    const color = LAYER[layer] ? LAYER[layer].border : '#888';

    document.getElementById('detailEyebrow').textContent = (layer + ' · ' + (d.resourceType || 'model')).toUpperCase();
    document.getElementById('detailName').textContent = d.label || d.id;
    document.getElementById('detailFqn').textContent = d.fqn || d.id;

    // Overview tab
    const preds = cy.getElementById(d.id).predecessors('node');
    const succs  = cy.getElementById(d.id).successors('node');
    document.getElementById('detailMeta').innerHTML = [
      ['Layer',       '<span class="dpi-badge" style="background:' + color + '22;color:' + color + '">' + layer + '</span>'],
      ['Upstream',    preds.length || '0'],
      ['Downstream',  succs.length || '0'],
      ['Columns',     d.columnCount || Object.keys(d.transformations || {}).length || '—'],
      ['Type',        d.resourceType || 'model'],
    ].map(([k, v]) =>
      '<div class="dpi-meta-row"><span class="dpi-meta-key">' + k + '</span><span class="dpi-meta-val">' + v + '</span></div>'
    ).join('');

    // Columns tab
    const transforms = d.transformations || {};
    const cols = Object.entries(transforms);
    if (cols.length) {
      document.getElementById('detailCols').innerHTML = cols.map(([name, tx]) => {
        const kind = tx.kind || 'unknown';
        const expr = tx.expression ? tx.expression.slice(0, 100) : '';
        return '<div class="dpi-col-item" data-col="' + esc(name) + '">' +
          '<span class="dpi-col-expand">▸</span>' +
          '<span class="dpi-col-name">' + esc(name) + '</span>' +
          '<span class="dpi-col-kind">' + kind + '</span>' +
          '</div>' +
          (expr ? '<div class="dpi-col-detail" data-col-detail="' + esc(name) + '">' +
            '<code>' + esc(expr) + '</code>' +
            (tx.sourceColumn ? '<br><span style="opacity:.7">from <code>' + esc(tx.sourceColumn) + '</code></span>' : '') +
          '</div>' : '');
      }).join('');
    } else {
      document.getElementById('detailCols').innerHTML = '<div style="padding:12px;color:var(--vscode-descriptionForeground);font-size:12px">No column transformations parsed. Run dbt compile and refresh.</div>';
    }

    // Impact tab
    document.getElementById('detailImpact').innerHTML =
      '<div class="dpi-impact-grid">' +
        '<div class="dpi-impact-card"><div class="dpi-impact-num" style="color:#4ec9b0">' + preds.length + '</div><div class="dpi-impact-label">Upstream</div></div>' +
        '<div class="dpi-impact-card"><div class="dpi-impact-num" style="color:#dcdcaa">' + succs.length + '</div><div class="dpi-impact-label">Downstream</div></div>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--vscode-descriptionForeground);line-height:1.6">' +
        (succs.length > 0 ? succs.length + ' model(s) depend on this. Changing it may break downstream consumers.' : 'No downstream dependents — this is a leaf model.') +
      '</div>';

    detailPanel.classList.add('open');
    // activate overview tab
    activateTab('overview');

    // Wire column expand
    detailPanel.querySelectorAll('.dpi-col-item').forEach(el => {
      el.addEventListener('click', function () {
        const col = this.dataset.col;
        const detail = detailPanel.querySelector('[data-col-detail="' + col + '"]');
        const wasOpen = this.classList.contains('expanded');
        detailPanel.querySelectorAll('.dpi-col-item').forEach(i => i.classList.remove('expanded'));
        detailPanel.querySelectorAll('.dpi-col-detail').forEach(d => d.classList.remove('open'));
        if (!wasOpen && detail) { this.classList.add('expanded'); detail.classList.add('open'); }
      });
    });

    // Wire action buttons
    document.getElementById('detailOpenBtn').onclick = function () {
      vscode.postMessage({ command: 'openLineageNode', nodeId: d.id, filePath: d.filePath, resourceType: d.resourceType, name: d.label });
    };
    document.getElementById('detailGraphBtn').onclick = function () {
      focusNode(d.id);
    };
  }

  function closeDetail() {
    detailPanel.classList.remove('open');
  }
  document.getElementById('detailClose').addEventListener('click', closeDetail);

  // Tab switching
  document.querySelectorAll('.dpi-detail-tab').forEach(tab => {
    tab.addEventListener('click', function () { activateTab(this.dataset.tab); });
  });
  function activateTab(name) {
    document.querySelectorAll('.dpi-detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.dpi-tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
  }

  // ── Message handler ───────────────────────────────────────────────────────
  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (!msg || typeof msg.command !== 'string') return;
    switch (msg.command) {
      case 'render':     onRender(msg.payload);  break;
      case 'highlight':  onHighlight(msg.payload); break;
      case 'focusNode':  if (msg.payload && msg.payload.nodeId) focusNode(msg.payload.nodeId); break;
      case 'focusColumn':
        if (msg.payload && msg.payload.columnName) {
          setStatus('Column search: ' + msg.payload.columnName);
          searchInput.value = msg.payload.columnName;
          searchInput.dispatchEvent(new Event('input'));
        }
        break;
    }
  });

  function onRender(payload) {
    if (!payload || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
      setStatus('Invalid lineage payload.'); return;
    }
    allNodes = payload.nodes;
    allEdges = payload.edges;

    cy.elements().remove();
    cy.add(allNodes);
    cy.add(allEdges);

    // Update layer counts in rail
    const counts = {};
    allNodes.forEach(n => {
      const l = n.data.layer || 'unknown';
      counts[l] = (counts[l] || 0) + 1;
    });
    document.querySelectorAll('.layer-count').forEach(el => {
      const l = el.dataset.layer;
      el.textContent = counts[l] || 0;
    });

    // Default: focus on first mart or first node
    const mart = allNodes.find(n => n.data.layer === 'mart');
    const first = allNodes[0];
    if (payload.focusNodeId) {
      focusNode(payload.focusNodeId);
    } else if (allNodes.length > 30) {
      // Large project: start in focus mode on first mart
      const target = mart || first;
      if (target) focusNode(target.data.id);
    } else {
      // Small project: show everything
      refreshVisible();
      updateBreadcrumbs();
    }

    updateCounter();
  }

  function onHighlight(payload) {
    if (!payload) return;
    cy.elements().removeClass('upstream downstream focus dimmed');
    const preds = new Set(payload.upstream || []);
    const succs  = new Set(payload.downstream || []);
    const focus  = payload.focus;
    cy.nodes().forEach(n => {
      const id = n.id();
      if (id === focus)       n.addClass('focus');
      else if (preds.has(id)) n.addClass('upstream');
      else if (succs.has(id)) n.addClass('downstream');
      else                    n.addClass('dimmed');
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function findNodeData(id) {
    return allNodes.find(n => n.data.id === id) || null;
  }
  function updateCounter() {
    const vis = cy.nodes(':visible').length;
    const tot = allNodes.length;
    const el = document.getElementById('nodeCounter');
    if (el) el.innerHTML = 'Showing <strong>' + vis + '</strong> / <strong>' + tot + '</strong>';
  }
  function setStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
  }
  function setActiveMode(mode) {
    document.querySelectorAll('.dpi-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  }
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  vscode.postMessage({ command: 'ready' });
})();
