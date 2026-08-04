/**
 * Agent Progress — Status bar indicator + progress tracking for agent sessions.
 */
import * as vscode from 'vscode';
import type { AgentProgress } from '@lambda128/shared';

export class AgentProgressManager {
  private statusBarItem: vscode.StatusBarItem;
  private tokenCountItem: vscode.StatusBarItem;
  private modelItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'lambda128.openChat';
    this.statusBarItem.show();

    this.tokenCountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    this.tokenCountItem.show();

    this.modelItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.modelItem.show();

    this.setIdle();
  }

  setIdle(): void {
    this.statusBarItem.text = '$(hubot) AI Ready';
    this.statusBarItem.tooltip = 'Click to open AI Chat';
    this.statusBarItem.backgroundColor = undefined;
  }

  setRunning(progress: AgentProgress): void {
    const step = progress.currentStep || 0;
    const total = progress.totalSteps || 1;
    const action = progress.currentAction || 'Working...';
    this.statusBarItem.text = `$(sync~spin) AI: Step ${step}/${total}`;
    this.statusBarItem.tooltip = `Agent: ${action}`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  setPlanning(): void {
    this.statusBarItem.text = '$(thinking) AI: Planning...';
    this.statusBarItem.tooltip = 'Agent is planning the task';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  setError(): void {
    this.statusBarItem.text = '$(error) AI Error';
    this.statusBarItem.tooltip = 'Agent encountered an error';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  updateTokens(used: number, limit: number): void {
    const pct = Math.round((used / limit) * 100);
    this.tokenCountItem.text = `$(pulse) ${pct}% tokens`;
    this.tokenCountItem.tooltip = `${used.toLocaleString()} / ${limit.toLocaleString()} tokens used`;
    if (pct > 80) {
      this.tokenCountItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (pct > 60) {
      this.tokenCountItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.tokenCountItem.backgroundColor = undefined;
    }
  }

  updateModel(model: string): void {
    this.modelItem.text = `$(symbol-method) ${model}`;
    this.modelItem.tooltip = `Current model: ${model}`;
  }

  dispose(): void {
    this.statusBarItem.dispose();
    this.tokenCountItem.dispose();
    this.modelItem.dispose();
  }
}