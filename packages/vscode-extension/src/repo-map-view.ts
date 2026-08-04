/**
 * Repo Map Panel — Collapsible webview showing project structure with semantic search.
 */
import * as vscode from 'vscode';
import { buildRepoMap, formatRepoMapForLLM, EmbeddingEngine } from '@lambda128/repository';
import type { RepoMap } from '@lambda128/repository';

export class RepoMapPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lambda128.repoMap';
  private _view?: vscode.WebviewView;
  private repoMap: RepoMap | null = null;
  private embeddingEngine: EmbeddingEngine;

  constructor(embeddingEngine: EmbeddingEngine) {
    this.embeddingEngine = embeddingEngine;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'repoMap:refresh':
          await this.refresh();
          break;
        case 'repoMap:openFile':
          if (msg.payload?.path) {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            const uri = vscode.Uri.file(`${root}/${msg.payload.path}`);
            vscode.window.showTextDocument(uri, { preview: true });
          }
          break;
        case 'semanticSearch':
          await this.semanticSearch(msg.payload?.query || '');
          break;
      }
    });
  }

  async refresh(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;

    const editor = vscode.window.activeTextEditor;
    const openPaths = editor ? [editor.document.uri.fsPath] : [];

    this.repoMap = buildRepoMap(root, openPaths, { maxDepth: 3, maxFiles: 200, includeSymbols: true });
    const summary = formatRepoMapForLLM(this.repoMap, 100);

    this._view?.webview.postMessage({
      type: 'repoMap:update',
      payload: {
        summary,
        totalFiles: this.repoMap.totalFiles,
        languageStats: this.repoMap.languageStats,
        embeddingsAvailable: this.embeddingEngine.getMode() !== 'off' && this.embeddingEngine.isIndexed(),
        entries: this.repoMap.entries.slice(0, 100).map(e => ({
          path: e.path,
          type: e.type,
          language: e.language,
          symbols: e.symbols?.map(s => `${s.kind}:${s.name}`) || [],
          relevanceScore: e.relevanceScore,
        })),
      },
    });
  }

  private async semanticSearch(query: string): Promise<void> {
    if (!query.trim()) return;

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;

    // Auto-index if not yet indexed
    if (!this.embeddingEngine.isIndexed()) {
      this._view?.webview.postMessage({ type: 'semanticSearch:progress', payload: { pct: 0, msg: 'Indexing workspace...' } });
      await this.embeddingEngine.indexWorkspace(root, (pct) => {
        this._view?.webview.postMessage({ type: 'semanticSearch:progress', payload: { pct, msg: `Indexing ${pct}%` } });
      });
      this._view?.webview.postMessage({ type: 'semanticSearch:progress', payload: { pct: 100, msg: 'Searching...' } });
    }

    const results = await this.embeddingEngine.search(query, 15);
    this._view?.webview.postMessage({
      type: 'semanticSearch:results',
      payload: {
        query,
        results: results.map(r => ({
          filePath: r.filePath,
          chunk: r.chunk.substring(0, 200),
          startLine: r.startLine,
          score: Math.round(r.score * 100) / 100,
        })),
      },
    });
  }

  getRepoMap(): RepoMap | null {
    return this.repoMap;
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--vscode-font-family);font-size:12px;padding:8px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}
  .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .header h3{font-size:13px}
  .stats{font-size:11px;opacity:.7;margin-bottom:8px}
  .search-box{display:flex;gap:4px;margin-bottom:8px}
  .search-box input{flex:1;padding:4px 6px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:3px;font-size:11px}
  .search-box input::placeholder{opacity:.5}
  .search-box button{padding:4px 6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:10px}
  .entry{padding:2px 4px;cursor:pointer;border-radius:3px;display:flex;align-items:center;gap:4px}
  .entry:hover{background:var(--vscode-list-hoverBackground)}
  .entry .icon{width:14px;text-align:center;flex-shrink:0}
  .entry .path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .entry .symbols{font-size:10px;opacity:.6;margin-left:auto;flex-shrink:0}
  .dir{color:var(--vscode-symbolIcon-folderForeground,#dcb67a)}
  .file{color:var(--vscode-symbolIcon-fileForeground,#7ec8e3)}
  button{padding:4px 8px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:11px}
  button:hover{background:var(--vscode-button-hoverBackground)}
  .score{font-size:9px;opacity:.5;margin-left:4px}
  .search-result{border-bottom:1px solid var(--vscode-panel-border);padding:6px 4px;cursor:pointer}
  .search-result:hover{background:var(--vscode-list-hoverBackground)}
  .search-result .sr-path{font-weight:600;font-size:11px;margin-bottom:2px}
  .search-result .sr-snippet{font-size:10px;opacity:.7;font-family:var(--vscode-editor-font-family);white-space:pre-wrap;max-height:40px;overflow:hidden}
  .search-result .sr-score{font-size:9px;opacity:.4;margin-top:2px}
  .progress{font-size:10px;opacity:.6;padding:8px 0;text-align:center}
  .tabs{display:flex;gap:2px;margin-bottom:6px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:4px}
  .tab{padding:3px 10px;cursor:pointer;border-radius:3px 3px 0 0;font-size:11px;opacity:.6}
  .tab.active{opacity:1;background:var(--vscode-tab-activeBackground);font-weight:600}
  .tab:hover{opacity:.8}
  .hidden{display:none}
</style></head><body>
  <div class="header">
    <h3>🗂️ Repository Map</h3>
    <button onclick="refresh()" title="Refresh">🔄</button>
  </div>
  <div class="tabs">
    <div class="tab active" id="tabFiles" onclick="switchTab('files')">Files</div>
    <div class="tab" id="tabSearch" onclick="switchTab('search')">🔍 Semantic</div>
  </div>
  <div class="stats" id="stats">Loading...</div>
  <div id="searchSection" class="hidden">
    <div class="search-box">
      <input type="text" id="searchInput" placeholder="Search code semantically... (e.g. 'error handling')" onkeydown="if(event.key==='Enter')search()"/>
      <button onclick="search()">Search</button>
    </div>
    <div id="searchProgress" class="progress hidden"></div>
    <div id="searchResults"></div>
  </div>
  <div id="entries"></div>
<script>
  const vscode = acquireVsCodeApi();
  let currentTab = 'files';
  vscode.postMessage({type:'repoMap:refresh'});

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'repoMap:update') {
      const p = msg.payload;
      document.getElementById('stats').textContent =
        p.totalFiles + ' files | ' + Object.entries(p.languageStats).map(([l,c]) => l+'('+c+')').join(', ') +
        (p.embeddingsAvailable ? ' | 🔍 ready' : ' | 🔍 index needed');
      let html = '';
      for (const entry of p.entries) {
        const icon = entry.type === 'directory' ? '📁' : '📄';
        const cls = entry.type === 'directory' ? 'dir' : 'file';
        const syms = entry.symbols?.length ? ' [' + entry.symbols.slice(0,3).join(', ') + ']' : '';
        const score = entry.relevanceScore > 0.5 ? ' ★' : '';
        html += '<div class="entry ' + cls + '" onclick="openFile(' + JSON.stringify(entry.path) + ')">' +
          '<span class="icon">' + icon + '</span>' +
          '<span class="path">' + entry.path + '</span>' +
          '<span class="symbols">' + syms + '</span>' +
          '<span class="score">' + score + '</span></div>';
      }
      document.getElementById('entries').innerHTML = html;
    }
    if (msg.type === 'semanticSearch:progress') {
      document.getElementById('searchProgress').classList.remove('hidden');
      document.getElementById('searchProgress').textContent = msg.payload.msg;
    }
    if (msg.type === 'semanticSearch:results') {
      document.getElementById('searchProgress').classList.add('hidden');
      let html = '<div style="font-size:11px;opacity:.7;margin-bottom:6px">Results for "' + msg.payload.query + '"</div>';
      for (const r of msg.payload.results) {
        html += '<div class="search-result" onclick="openFile(' + JSON.stringify(r.filePath) + ')">' +
          '<div class="sr-path">📄 ' + r.filePath + ' (line ' + r.startLine + ')</div>' +
          '<div class="sr-snippet">' + escapeHtml(r.chunk) + '</div>' +
          '<div class="sr-score">Relevance: ' + (r.score * 100).toFixed(0) + '%</div></div>';
      }
      document.getElementById('searchResults').innerHTML = html || '<div style="font-size:11px;opacity:.5;padding:8px">No results found. Try indexing first (Settings → Embeddings → Local/Cloud, then Save).</div>';
    }
  });

  function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tabFiles').classList.toggle('active', tab === 'files');
    document.getElementById('tabSearch').classList.toggle('active', tab === 'search');
    document.getElementById('entries').classList.toggle('hidden', tab !== 'files');
    document.getElementById('searchSection').classList.toggle('hidden', tab !== 'search');
    document.getElementById('stats').classList.toggle('hidden', tab === 'search');
  }
  function refresh() { vscode.postMessage({type:'repoMap:refresh'}); }
  function search() {
    const q = document.getElementById('searchInput').value;
    if (q.trim()) vscode.postMessage({type:'semanticSearch', payload:{query: q}});
  }
  function openFile(path) { vscode.postMessage({type:'repoMap:openFile',payload:{path}}); }
  function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
</script></body></html>`;
  }
}
