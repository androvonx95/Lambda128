/**
 * Repo Map Panel — Collapsible webview showing project structure with symbols.
 */
import * as vscode from 'vscode';
import { buildRepoMap, formatRepoMapForLLM } from '@lambda128/repository';
import type { RepoMap } from '@lambda128/repository';

export class RepoMapPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lambda128.repoMap';
  private _view?: vscode.WebviewView;
  private repoMap: RepoMap | null = null;

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
</style></head><body>
  <div class="header">
    <h3>🗂️ Repository Map</h3>
    <button onclick="refresh()">🔄</button>
  </div>
  <div class="stats" id="stats">Loading...</div>
  <div id="entries"></div>
<script>
  const vscode = acquireVsCodeApi();
  vscode.postMessage({type:'repoMap:refresh'});

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'repoMap:update') {
      const p = msg.payload;
      document.getElementById('stats').textContent =
        p.totalFiles + ' files | ' + Object.entries(p.languageStats).map(([l,c]) => l+'('+c+')').join(', ');
      let html = '';
      for (const entry of p.entries) {
        const icon = entry.type === 'directory' ? '📁' : '📄';
        const cls = entry.type === 'directory' ? 'dir' : 'file';
        const syms = entry.symbols?.length ? ' [' + entry.symbols.slice(0,3).join(', ') + ']' : '';
        const score = entry.relevanceScore > 0.5 ? ' ★' : '';
        html += '<div class="entry ' + cls + '" onclick="openFile(\'' + entry.path + '\')">' +
          '<span class="icon">' + icon + '</span>' +
          '<span class="path">' + entry.path + '</span>' +
          '<span class="symbols">' + syms + '</span>' +
          '<span class="score">' + score + '</span></div>';
      }
      document.getElementById('entries').innerHTML = html;
    }
  });

  function refresh() { vscode.postMessage({type:'repoMap:refresh'}); }
  function openFile(path) { vscode.postMessage({type:'repoMap:openFile',payload:{path}}); }
</script></body></html>`;
  }
}