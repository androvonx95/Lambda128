/**
 * Conversation History — Sidebar tree view for browsing past conversations.
 */
import * as vscode from 'vscode';
import type { ConversationRepository } from '@lambda128/storage';
import type { Conversation } from '@lambda128/shared';

export class ConversationHistoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private convRepo: ConversationRepository) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const all = root ? this.convRepo.listByWorkspace(root) : [];
    return all.map((c: Conversation) => {
      const date = new Date(c.createdAt).toLocaleDateString();
      const item = new vscode.TreeItem(
        `${c.title || 'Untitled'} — ${date}`,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = `${new Date(c.updatedAt).toLocaleTimeString()}`;
      item.tooltip = `Workspace: ${c.workspacePath}\nCreated: ${new Date(c.createdAt).toLocaleString()}`;
      item.command = {
        command: 'lambda128.history.loadConversation',
        title: 'Load Conversation',
        arguments: [c.id],
      };
      item.contextValue = 'conversation';
      if (c.archived) item.iconPath = new vscode.ThemeIcon('archive');
      else item.iconPath = new vscode.ThemeIcon('comment-discussion');
      return item;
    });
  }
}

export function registerHistoryCommands(
  context: vscode.ExtensionContext,
  convRepo: ConversationRepository,
  onLoad: (id: string) => Promise<void>,
  onDelete: (id: string) => void
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('lambda128.history.loadConversation', async (id: string) => {
      await onLoad(id);
    }),
    vscode.commands.registerCommand('lambda128.history.deleteConversation', (item: vscode.TreeItem) => {
      // Extract ID from tree item's command arguments
      const cmd = item.command;
      if (cmd?.arguments?.[0]) {
        onDelete(cmd.arguments[0]);
      }
    }),
    vscode.commands.registerCommand('lambda128.history.refresh', () => {
      // Handled by TreeDataProvider refresh
    }),
    vscode.commands.registerCommand('lambda128.history.newConversation', () => {
      vscode.commands.executeCommand('lambda128.openChat');
    })
  );
}