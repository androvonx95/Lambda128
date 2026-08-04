import fs from 'node:fs';
import path from 'node:path';
import type { Tool, ToolResult, ToolExecutionContext, ValidationResult } from '@lambda128/shared';
import { TOOL_IDS } from '@lambda128/shared';

export class ListDirectoryTool implements Tool {
  readonly id = TOOL_IDS.LIST_DIRECTORY;
  readonly name = 'List Directory';
  readonly description = 'List directory contents.';
  readonly category = 'READ' as const;
  readonly requiresApproval = 'configurable' as const;
  readonly parameters = {
    type: 'object' as const,
    properties: { path: { type: 'string' as const, description: 'Directory path relative to workspace.' } },
    required: ['path'],
  };
  validate(p: Record<string, unknown>): ValidationResult {
    if (!p.path || typeof p.path !== 'string') return { valid: false, errors: ['path required'] };
    return { valid: true };
  }
  async execute(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const dir = path.resolve(ctx.workspaceRoot, params.path as string);
    if (!dir.startsWith(ctx.workspaceRoot)) return { toolId: this.id, status: 'error', output: '', error: 'Path traversal', durationMs: 0 };
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const lines = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}${e.isDirectory() ? '/' : ''}`);
      return { toolId: this.id, status: 'success', output: lines.join('\n') || '(empty)', durationMs: 0, metadata: { count: entries.length } };
    } catch (err: any) {
      return { toolId: this.id, status: 'error', output: '', error: err.message, durationMs: 0 };
    }
  }
}