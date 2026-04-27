import * as vscode from 'vscode';
import { LineageService } from './lineageService';
import { LineageGraph, LineageLayer, LineageNode } from './types';

interface CyNodeData {
  id: string;
  label: string;
  layer: LineageLayer;
  resourceType: string;
  columnCount: number;
}

interface CyEdgeData {
  id: string;
  source: string;
  target: string;
  hasColumnLineage: boolean;
}

interface MessageFromWebview {
  command: 'nodeClicked' | 'ready' | 'highlightImpact';
  nodeId?: string;
}

interface MessageToWebview {
  command: 'render' | 'focusColumn' | 'highlight' | 'focusNode';
  payload: unknown;
}

export class LineageWebviewPanel {
  public static currentPanel: LineageWebviewPanel | undefined;
  private static readonly viewType = 'dataPipelineIntelligence.lineageGraph';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, service: LineageService): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
    if (LineageWebviewPanel.currentPanel) {
      LineageWebviewPanel.currentPanel.panel.reveal(column);
      LineageWebviewPanel.currentPanel.refresh(service);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LineageWebviewPanel.viewType,
      'Data Lineage',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.joinPath(extensionUri, 'node_modules', 'cytoscape', 'dist'),
          vscode.Uri.joinPath(extensionUri, 'node_modules', 'cytoscape-dagre'),
          vscode.Uri.joinPath(extensionUri, 'node_modules', 'dagre', 'dist')
        ]
      }
    );
    LineageWebviewPanel.currentPanel = new LineageWebviewPanel(panel, extensionUri, service);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly service: LineageService
  ) {
    this.panel = panel;
    this.panel.webview.html = this.buildHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: MessageFromWebview) => this.handleMessage(msg),
      null,
      this.disposables
    );
  }

  public refresh(service: LineageService): void {
    const data = this.toCytoscapeData(service.getGraph());
    // If the user has a dbt model file open, start focused on it
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    let focusNodeId: string | undefined;
    if (activeFile) {
      const projectRoot = service.getProjectRoot();
      const path = require('path') as typeof import('path');
      const norm = path.normalize(activeFile).toLowerCase();
      const match = service.getGraph().nodes.find((n) => {
        if (!n.filePath) { return false; }
        const abs = path.isAbsolute(n.filePath) ? n.filePath : path.join(projectRoot ?? '', n.filePath);
        return path.normalize(abs).toLowerCase() === norm;
      });
      focusNodeId = match?.id;
    }
    void this.panel.webview.postMessage({ command: 'render', payload: { ...data, focusNodeId } } satisfies MessageToWebview);
  }

  public focusColumn(columnName: string): void {
    void this.panel.webview.postMessage({
      command: 'focusColumn',
      payload: { columnName }
    } satisfies MessageToWebview);
  }

  /** Focus the graph on a specific node by id; highlights upstream + downstream
   * and centers/zooms on it. Used when the user picks a node from the tree. */
  public focusNode(nodeId: string): void {
    void this.panel.webview.postMessage({
      command: 'focusNode',
      payload: { nodeId }
    } satisfies MessageToWebview);
  }

  private async handleMessage(msg: MessageFromWebview): Promise<void> {
    if (msg.command === 'ready') {
      this.refresh(this.service);
      return;
    }
    if (msg.command === 'nodeClicked' && typeof msg.nodeId === 'string') {
      const node = this.service.getNodeById(msg.nodeId);
      if (node) {
        await this.showColumnPanel(node);
      }
    }
    if (msg.command === 'highlightImpact' && typeof msg.nodeId === 'string') {
      const upstream = Array.from(this.service.upstreamOf(msg.nodeId));
      const downstream = Array.from(this.service.downstreamOf(msg.nodeId));
      void this.panel.webview.postMessage({
        command: 'highlight',
        payload: { upstream, downstream, focus: msg.nodeId }
      } satisfies MessageToWebview);
    }
  }

  private async showColumnPanel(node: LineageNode): Promise<void> {
    const md = renderColumnPanelMarkdown(node);
    const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  }

  private toCytoscapeData(graph: LineageGraph): { nodes: { data: CyNodeData }[]; edges: { data: CyEdgeData }[] } {
    return {
      nodes: graph.nodes.map((n) => ({
        data: {
          id: n.id,
          label: n.name,
          layer: n.layer,
          resourceType: n.resourceType,
          columnCount: n.columns.length,
          fqn: n.fqn ?? n.id,
          filePath: n.filePath ?? '',
          transformations: n.transformations ?? {}
        }
      })),
      edges: graph.edges.map((e, i) => ({
        data: {
          id: `e${i}`,
          source: e.source,
          target: e.target,
          hasColumnLineage: !!e.columnPairs && e.columnPairs.length > 0
        }
      }))
    };
  }

  private buildHtml(): string {
    const webview = this.panel.webview;
    const nonce = generateNonce();

    const cytoscapeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js')
    );
    const dagreUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'dagre', 'dist', 'dagre.min.js')
    );
    const cytoscapeDagreUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'cytoscape-dagre', 'cytoscape-dagre.js')
    );
    const lineageUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'lineage.js')
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'lineage.css')
    );

    // Strict CSP: only this webview's resources, plus inline styles via nonce.
    const csp =
      `default-src 'none'; ` +
      `img-src ${webview.cspSource} https: data:; ` +
      `script-src 'nonce-${nonce}' ${webview.cspSource}; ` +
      `style-src ${webview.cspSource} 'nonce-${nonce}'; ` +
      `font-src ${webview.cspSource};`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${stylesUri}" nonce="${nonce}" />
  <title>Data Lineage</title>
</head>
<body>
<div class="dpi-layout">

  <!-- ── Top bar ── -->
  <header class="dpi-topbar">
    <div class="dpi-title">Data Lineage</div>

    <div class="dpi-search-wrap">
      <svg class="dpi-search-icon" viewBox="0 0 16 16" fill="none">
        <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.4"/>
        <line x1="9.9" y1="9.9" x2="13" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      <input id="searchInput" type="text" placeholder="Search models, sources, columns…" autocomplete="off" />
      <div id="searchDropdown" class="dpi-search-dropdown"></div>
    </div>

    <div class="dpi-mode-group">
      <button class="dpi-mode-btn active" data-mode="focus">Focus</button>
      <button class="dpi-mode-btn" data-mode="all">All</button>
      <button class="dpi-mode-btn" data-mode="impact">Impact</button>
    </div>

    <div class="dpi-topbar-right">
      <span class="dpi-counter" id="nodeCounter">Loading…</span>
      <button class="dpi-btn" id="fitBtn">Fit</button>
      <button class="dpi-btn" id="resetBtn">Reset</button>
    </div>
  </header>

  <!-- ── Left filter rail ── -->
  <aside class="dpi-rail">

    <div>
      <div class="rail-section-label">Layers</div>
      ${Object.entries({ raw: 'Raw / Sources', staging: 'Staging', intermediate: 'Intermediate', mart: 'Marts (Gold)', unknown: 'Other' }).map(([k, label]) => `
      <label class="layer-toggle">
        <input type="checkbox" data-layer="${k}" checked />
        <span class="layer-check"></span>
        <span class="layer-swatch" data-layer="${k}"></span>
        ${label}
        <span class="layer-count" data-layer="${k}">—</span>
      </label>`).join('')}
    </div>

    <div>
      <div class="rail-section-label">Upstream hops</div>
      <div class="slider-row">
        <span>hops</span><span class="slider-val" id="upDepthVal">2</span>
      </div>
      <input id="upDepth" class="dpi-slider" type="range" min="0" max="6" value="2" />
    </div>

    <div>
      <div class="rail-section-label">Downstream hops</div>
      <div class="slider-row">
        <span>hops</span><span class="slider-val" id="downDepthVal">2</span>
      </div>
      <input id="downDepth" class="dpi-slider" type="range" min="0" max="6" value="2" />
    </div>

    <div>
      <div class="rail-section-label">Legend</div>
      <div class="legend-item"><span class="legend-dot" data-layer="raw"></span> Raw / Sources</div>
      <div class="legend-item"><span class="legend-dot" data-layer="staging"></span> Staging</div>
      <div class="legend-item"><span class="legend-dot" data-layer="intermediate"></span> Intermediate</div>
      <div class="legend-item"><span class="legend-dot" data-layer="mart"></span> Marts</div>
      <div style="margin-top:8px;font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.6">
        <div>Dashed border = hidden neighbours</div>
        <div style="color:#4ec9b0">Teal border = upstream</div>
        <div style="color:#dcdcaa">Yellow border = downstream</div>
        <div style="color:#f48771">Red border = focused</div>
      </div>
    </div>

  </aside>

  <!-- ── Graph canvas ── -->
  <div class="dpi-canvas">
    <div class="dpi-breadcrumbs" id="breadcrumbs">
      <span class="crumb current">All models</span>
    </div>

    <div id="cy" role="img" aria-label="Lineage graph"></div>

    <!-- Detail slide-in panel -->
    <div class="dpi-detail" id="detailPanel">
      <div class="dpi-detail-header">
        <button class="dpi-detail-close" id="detailClose" title="Close">✕</button>
        <div class="dpi-detail-eyebrow" id="detailEyebrow">Model</div>
        <div class="dpi-detail-name" id="detailName">—</div>
        <div class="dpi-detail-fqn" id="detailFqn">—</div>
      </div>
      <div class="dpi-detail-tabs">
        <button class="dpi-detail-tab active" data-tab="overview">Overview</button>
        <button class="dpi-detail-tab" data-tab="columns">Columns</button>
        <button class="dpi-detail-tab" data-tab="impact">Impact</button>
      </div>
      <div class="dpi-detail-body">
        <div class="dpi-tab-pane active" data-pane="overview">
          <div id="detailMeta"></div>
        </div>
        <div class="dpi-tab-pane" data-pane="columns">
          <div id="detailCols"></div>
        </div>
        <div class="dpi-tab-pane" data-pane="impact">
          <div id="detailImpact"></div>
        </div>
      </div>
      <div class="dpi-detail-actions">
        <button class="dpi-action-btn" id="detailOpenBtn">Open SQL</button>
        <button class="dpi-action-btn primary" id="detailGraphBtn">Focus Graph</button>
      </div>
    </div>

    <!-- Zoom controls -->
    <div class="dpi-zoom">
      <button class="dpi-zoom-btn" data-action="in"  title="Zoom in">+</button>
      <button class="dpi-zoom-btn" data-action="fit" title="Fit">⊙</button>
      <button class="dpi-zoom-btn" data-action="out" title="Zoom out">−</button>
    </div>
  </div>

  <!-- ── Status bar ── -->
  <footer class="dpi-status" id="status">Loading…</footer>

</div>

  <script nonce="${nonce}" src="${cytoscapeUri}"></script>
  <script nonce="${nonce}" src="${dagreUri}"></script>
  <script nonce="${nonce}" src="${cytoscapeDagreUri}"></script>
  <script nonce="${nonce}" src="${lineageUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    LineageWebviewPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length > 0) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let n = '';
  for (let i = 0; i < 32; i += 1) {
    n += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return n;
}

function renderColumnPanelMarkdown(node: LineageNode): string {
  const lines: string[] = [
    `# ${node.name}`,
    '',
    `- **Layer:** ${node.layer}`,
    `- **Type:** ${node.resourceType}`,
    node.fqn ? `- **FQN:** ${node.fqn}` : '',
    node.filePath ? `- **File:** ${node.filePath}` : '',
    '',
    '## Columns'
  ].filter(Boolean);

  for (const col of node.columns) {
    lines.push('');
    lines.push(`### ${col.name}` + (col.dataType ? ` _${col.dataType}_` : ''));
    if (col.description) {
      lines.push('');
      lines.push(col.description);
    }
    const t = node.transformations[col.name];
    if (t) {
      lines.push('');
      lines.push(`**Source columns:** ${t.sourceColumns.length > 0 ? t.sourceColumns.map((s) => '`' + s + '`').join(', ') : '_none_'}`);
      lines.push('');
      lines.push(`**Transformation:** ${humanizeTransformation(t.kind, t.expression)}`);
      lines.push('');
      lines.push('```sql');
      lines.push(t.expression);
      lines.push('```');
    }
  }
  return lines.join('\n');
}

function humanizeTransformation(kind: string, expression: string): string {
  switch (kind) {
    case 'rename':
    case 'identity':
      return `Direct passthrough — value of \`${expression}\` carried through.`;
    case 'arithmetic':
      return `Arithmetic expression: \`${expression}\`.`;
    case 'cast':
      return `Type cast applied.`;
    case 'aggregate':
      return `Aggregate function — values are rolled up by GROUP BY.`;
    case 'case':
      return `CASE expression — conditional value selection.`;
    case 'concat':
      return `Concatenation of multiple inputs.`;
    case 'window':
      return `Window function — value computed over a partition.`;
    default:
      return `Custom expression — review SQL for full logic.`;
  }
}
