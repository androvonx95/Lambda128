import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SecretStorageManager } from './secret-storage.js';
import { EmbeddingEngine } from '@lambda128/repository';

export interface SettingsState {
  providers: Record<string, { apiKey: string; model: string; enabled: boolean }>;
  defaultProvider: string;
  toolPermissions: Record<string, 'auto' | 'ask' | 'deny'>;
  embeddingMode: 'off' | 'local' | 'cloud';
  embeddingLocalModel: string;
  embeddingCloudModel: string;
}

export interface EmbeddingEstimate {
  totalFiles: number;
  estimatedChunks: number;
  ramMB: number;
  indexingTimeSeconds: number;
  cloudCostDollars: number;
  cloudTimeSeconds: number;
}

const DEFAULT_PERMS: Record<string, 'auto' | 'ask' | 'deny'> = {
  read_file: 'auto', search_files: 'auto', glob: 'auto',
  list_directory: 'auto', git_status: 'auto', git_diff: 'auto',
  write_file: 'ask', edit_file: 'ask', create_file: 'ask',
  delete_file: 'ask', rename_file: 'ask', run_terminal: 'ask',
};

export class SettingsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lambda128.settings';
  private _view?: vscode.WebviewView;
  private _onSettingsChanged = new vscode.EventEmitter<SettingsState>();
  public readonly onSettingsChanged = this._onSettingsChanged.event;
  private workspaceRoot: string;
  private secretStorage: SecretStorageManager;
  private embeddingEngine: EmbeddingEngine;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private getEmbeddingEstimate: () => EmbeddingEstimate,
    embeddingEngine: EmbeddingEngine
  ) {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.secretStorage = new SecretStorageManager(_context);
    this.embeddingEngine = embeddingEngine;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'settings:load':
          await this.sendCurrentSettings(webviewView.webview);
          break;
        case 'settings:save':
          await this.handleSave(msg.payload);
          this._onSettingsChanged.fire(msg.payload);
          break;
        case 'settings:getEstimate':
          webviewView.webview.postMessage({
            type: 'settings:estimate',
            payload: this.getEmbeddingEstimate(),
          });
          break;
        case 'settings:reindex':
          await this.handleReindex(webviewView.webview);
          break;
      }
    });
  }

  private async handleSave(payload: SettingsState): Promise<void> {
    const config = vscode.workspace.getConfiguration('lambda128');

    // Store API keys in SecretStorage (secure), not plaintext config
    for (const [id, p] of Object.entries(payload.providers)) {
      if (p.apiKey) {
        await this.secretStorage.storeApiKey(id, p.apiKey);
      } else {
        await this.secretStorage.deleteApiKey(id);
      }
      await config.update(`${id}Model`, p.model, true);
    }
    await config.update('defaultProvider', payload.defaultProvider, true);
    await config.update('toolPermissions', payload.toolPermissions, true);
    await config.update('embeddingMode', payload.embeddingMode, true);

    // Wire embedding engine: toggle actually works now
    if (payload.embeddingMode !== this.embeddingEngine.getMode()) {
      const openaiKey = payload.providers.openai?.apiKey;
      await this.embeddingEngine.setMode(payload.embeddingMode, openaiKey);

      if (payload.embeddingMode !== 'off' && this.workspaceRoot) {
        // Start background indexing
        this.embeddingEngine.indexWorkspace(this.workspaceRoot, (pct: number) => {
          this._view?.webview.postMessage({
            type: 'settings:indexProgress',
            payload: { pct, mode: payload.embeddingMode },
          });
        }).then((count: number) => {
          this._view?.webview.postMessage({
            type: 'settings:indexComplete',
            payload: { chunks: count, mode: payload.embeddingMode },
          });
        }).catch((err: Error) => {
          this._view?.webview.postMessage({
            type: 'settings:indexError',
            payload: { message: err.message },
          });
        });
      }
    }

    if (this._view) {
      this._view.webview.postMessage({ type: 'settings:saved', payload: {} });
    }
  }

  private async handleReindex(webview: vscode.Webview): Promise<void> {
    if (!this.workspaceRoot || this.embeddingEngine.getMode() === 'off') return;
    webview.postMessage({ type: 'settings:indexProgress', payload: { pct: 0, mode: this.embeddingEngine.getMode() } });
    try {
      const count = await this.embeddingEngine.indexWorkspace(this.workspaceRoot, (pct: number) => {
        webview.postMessage({ type: 'settings:indexProgress', payload: { pct, mode: this.embeddingEngine.getMode() } });
      });
      webview.postMessage({ type: 'settings:indexComplete', payload: { chunks: count, mode: this.embeddingEngine.getMode() } });
    } catch (err: any) {
      webview.postMessage({ type: 'settings:indexError', payload: { message: err.message } });
    }
  }

  private async sendCurrentSettings(webview: vscode.Webview): Promise<void> {
    const config = vscode.workspace.getConfiguration('lambda128');
    const savedPerms = config.get<Record<string, string>>('toolPermissions') || {};
    const toolPerms: Record<string, 'auto' | 'ask' | 'deny'> = { ...DEFAULT_PERMS };
    for (const [k, v] of Object.entries(savedPerms)) {
      if (v === 'auto' || v === 'ask' || v === 'deny') {
        toolPerms[k] = v;
      }
    }

    // Load API keys from SecretStorage (secure), not plaintext config
    const keys = await this.secretStorage.getAllApiKeys();

    const state: SettingsState = {
      providers: {
        openai: {
          apiKey: keys.openai || '',
          model: config.get<string>('openaiModel') || 'gpt-4o',
          enabled: !!keys.openai,
        },
        anthropic: {
          apiKey: keys.anthropic || '',
          model: config.get<string>('anthropicModel') || 'claude-sonnet-4-20250514',
          enabled: !!keys.anthropic,
        },
        gemini: {
          apiKey: keys.gemini || '',
          model: config.get<string>('geminiModel') || 'gemini-2.5-flash',
          enabled: !!keys.gemini,
        },
        openrouter: {
          apiKey: keys.openrouter || '',
          model: config.get<string>('openrouterModel') || 'openai/gpt-4o',
          enabled: !!keys.openrouter,
        },
      },
      defaultProvider: config.get<string>('defaultProvider') || 'anthropic',
      toolPermissions: toolPerms,
      embeddingMode: (config.get<string>('embeddingMode') as any) || 'off',
      embeddingLocalModel: config.get<string>('embeddingLocalModel') || 'all-MiniLM-L6-v2',
      embeddingCloudModel: config.get<string>('embeddingCloudModel') || 'text-embedding-3-small',
    };
    webview.postMessage({ type: 'settings:state', payload: state });
    webview.postMessage({ type: 'settings:estimate', payload: this.getEmbeddingEstimate() });
  }

  postSettings(state: SettingsState): void {
    this._view?.webview.postMessage({ type: 'settings:state', payload: state });
  }

  static calculateEstimate(fileCount: number): EmbeddingEstimate {
    const chunksPerFile = 5;
    const estimatedChunks = fileCount * chunksPerFile;
    const ramMB = Math.round(estimatedChunks * 0.0015);
    const indexingTimeSeconds = Math.round(estimatedChunks * 0.002);
    const cloudCostDollars = Math.round(estimatedChunks * 0.0001 * 100) / 100;
    const cloudTimeSeconds = Math.round(estimatedChunks * 0.02);
    return { totalFiles: fileCount, estimatedChunks, ramMB, indexingTimeSeconds, cloudCostDollars, cloudTimeSeconds };
  }

  private getHtml(): string {
    try {
      return readFileSync(join(__dirname, 'settings.html'), 'utf-8');
    } catch {
      return '<html><body><h2>Settings</h2><p>Settings panel HTML not found. Rebuild the extension.</p></body></html>';
    }
  }
}
