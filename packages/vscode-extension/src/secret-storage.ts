/**
 * Secret Storage — Secure API key management using VS Code's SecretStorage API.
 * Backed by OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret).
 * Replaces plaintext storage in VS Code settings.json.
 */
import * as vscode from 'vscode';

const KEY_PREFIX = 'lambda128.api-key.';

export class SecretStorageManager {
  private secrets: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
  }

  async storeApiKey(provider: string, key: string): Promise<void> {
    await this.secrets.store(`${KEY_PREFIX}${provider}`, key);
  }

  async getApiKey(provider: string): Promise<string | undefined> {
    return this.secrets.get(`${KEY_PREFIX}${provider}`);
  }

  async deleteApiKey(provider: string): Promise<void> {
    await this.secrets.delete(`${KEY_PREFIX}${provider}`);
  }

  async getAllApiKeys(): Promise<Record<string, string>> {
    const keys: Record<string, string> = {};
    for (const provider of ['openai', 'anthropic', 'gemini', 'openrouter']) {
      const key = await this.getApiKey(provider);
      if (key) keys[provider] = key;
    }
    return keys;
  }

  /**
   * Migrate keys from old plaintext VS Code config to SecretStorage.
   * Run once on extension activation.
   */
  static async migrateFromConfig(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('lambda128');
    const manager = new SecretStorageManager(context);

    for (const provider of ['openai', 'anthropic', 'gemini', 'openrouter']) {
      const oldKey = config.get<string>(`${provider}ApiKey`);
      if (oldKey) {
        // Check if already migrated
        const existing = await manager.getApiKey(provider);
        if (!existing) {
          await manager.storeApiKey(provider, oldKey);
        }
        // Clear from plaintext config
        await config.update(`${provider}ApiKey`, undefined, true);
      }
    }
  }
}