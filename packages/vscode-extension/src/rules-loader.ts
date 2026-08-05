/**
 * .lambda128rules — Custom Instructions Loader
 *
 * Reads a .lambda128rules file from the workspace root and injects
 * its contents into the system prompt as agent instructions.
 * Similar to Cursor Rules / .cursorrules.
 *
 * Format: Markdown (human-readable instructions for the AI)
 *
 * Example .lambda128rules:
 *   - Always use TypeScript strict mode
 *   - Prefer functional components over class components
 *   - Use 2-space indentation
 *   - Add JSDoc comments for all public APIs
 *   - Never use `any` type
 */
import * as vscode from 'vscode';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Maximum size of the rules file to read (100KB) */
const MAX_RULES_SIZE = 100 * 1024;

/** The filename to look for */
const RULES_FILENAME = '.lambda128rules';

export interface RulesContext {
  /** The raw rules content, or null if no rules file exists */
  content: string | null;
  /** Path to the rules file, or null */
  filePath: string | null;
  /** Size in bytes, or 0 */
  sizeBytes: number;
  /** Whether the rules were loaded successfully */
  loaded: boolean;
  /** Error message if loading failed */
  error?: string;
}

/**
 * Load custom instructions from a .lambda128rules file.
 * Searches in the workspace root first, then falls back to home directory.
 */
export function loadRules(workspaceRoot: string): RulesContext {
  // Priority 1: Workspace root .lambda128rules
  const workspaceRules = join(workspaceRoot, RULES_FILENAME);

  if (existsSync(workspaceRules)) {
    try {
      const stat = require('fs').statSync(workspaceRules);
      if (stat.size > MAX_RULES_SIZE) {
        return {
          content: null,
          filePath: workspaceRules,
          sizeBytes: stat.size,
          loaded: false,
          error: `Rules file exceeds maximum size of ${MAX_RULES_SIZE} bytes (got ${stat.size})`,
        };
      }

      const content = readFileSync(workspaceRules, 'utf-8').trim();
      if (!content) {
        return {
          content: null,
          filePath: workspaceRules,
          sizeBytes: stat.size,
          loaded: true,
          error: 'Rules file is empty',
        };
      }

      return {
        content,
        filePath: workspaceRules,
        sizeBytes: stat.size,
        loaded: true,
      };
    } catch (err: any) {
      return {
        content: null,
        filePath: workspaceRules,
        sizeBytes: 0,
        loaded: false,
        error: `Failed to read rules file: ${err.message}`,
      };
    }
  }

  // No rules file found
  return {
    content: null,
    filePath: null,
    sizeBytes: 0,
    loaded: false,
  };
}

/**
 * Format the rules content as a prompt section for the system prompt.
 */
export function formatRulesForPrompt(rules: RulesContext): string {
  if (!rules.loaded || !rules.content) return '';

  return `
<custom_instructions>
The user has provided the following custom instructions via .lambda128rules.
These override any conflicting defaults. Follow them strictly.

${rules.content}
</custom_instructions>`.trim();
}

/**
 * Watch for changes to the .lambda128rules file.
 * Returns a disposable that should be added to extension subscriptions.
 */
export function watchRules(
  workspaceRoot: string,
  onChange: (rules: RulesContext) => void,
): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.workspace.workspaceFolders?.[0] || workspaceRoot,
      RULES_FILENAME,
    ),
  );

  const handler = () => {
    const rules = loadRules(workspaceRoot);
    onChange(rules);
  };

  watcher.onDidCreate(handler);
  watcher.onDidChange(handler);
  watcher.onDidDelete(() => {
    onChange({
      content: null,
      filePath: null,
      sizeBytes: 0,
      loaded: false,
    });
  });

  return watcher;
}

/**
 * Get a simple status bar text for the rules.
 */
export function getRulesStatusText(rules: RulesContext): string {
  if (!rules.loaded || !rules.content) return '$(book) No rules';
  const lineCount = rules.content.split('\n').length;
  return `$(book) Rules: ${lineCount} line${lineCount === 1 ? '' : 's'}`;
}