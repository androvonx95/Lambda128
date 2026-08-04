import fs from 'node:fs';
import path from 'node:path';
import type { Tool, ToolResult, ToolExecutionContext, ValidationResult } from '@lambda128/shared';
import { TOOL_IDS } from '@lambda128/shared';

export class DeleteFileTool implements Tool {
  readonly id = TOOL_IDS.DELETE_FILE;
  readonly name = 'Delete File';
  readonly description = 'Delete a file. Requires confirmation.';
  readonly category = 'DESTROY' as const;
  readonly requiresApproval = true;
  readonly parameters = {
    type: 'object' as const,
    properties: { path: { type: 'string' as const, description: 'File path relative to workspace.' } },
    required: ['path'],
  };
  validate(p: Record<string, unknown>): ValidationResult {
    if (!p.path || typeof p.path !== 'string') return { valid: false, errors: ['path required'] };
    return { valid: true };
  }
  async execute(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const fp = path.resolve(ctx.workspaceRoot, params.path as string);
    if (!fp.startsWith(ctx.workspaceRoot)) return { toolId: this.id, status: 'error', output: '', error: 'Path traversal', durationMs: 0 };
    try {
      if (!fs.existsSync(fp)) return { toolId: this.id, status: 'error', output: '', error: 'File not found', durationMs: 0 };
      const backup = fs.readFileSync(fp, 'utf-8');
      fs.unlinkSync(fp);
      return { toolId: this.id, status: 'success', output: `Deleted: ${params.path}`, durationMs: 0, metadata: { originalContent: backup } };
    } catch (err: any) { return { toolId: this.id, status: 'error', output: '', error: err.message, durationMs: 0 }; }
  }
}

export class RenameFileTool implements Tool {
  readonly id = TOOL_IDS.RENAME_FILE;
  readonly name = 'Rename File';
  readonly description = 'Rename or move a file.';
  readonly category = 'WRITE' as const;
  readonly requiresApproval = true;
  readonly parameters = {
    type: 'object' as const,
    properties: {
      old_path: { type: 'string' as const, description: 'Current path.' },
      new_path: { type: 'string' as const, description: 'New path.' },
    },
    required: ['old_path', 'new_path'],
  };
  validate(p: Record<string, unknown>): ValidationResult {
    if (!p.old_path || typeof p.old_path !== 'string') return { valid: false, errors: ['old_path required'] };
    if (!p.new_path || typeof p.new_path !== 'string') return { valid: false, errors: ['new_path required'] };
    return { valid: true };
  }
  async execute(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const old = path.resolve(ctx.workspaceRoot, params.old_path as string);
    const nw = path.resolve(ctx.workspaceRoot, params.new_path as string);
    if (!old.startsWith(ctx.workspaceRoot) || !nw.startsWith(ctx.workspaceRoot)) return { toolId: this.id, status: 'error', output: '', error: 'Path traversal', durationMs: 0 };
    try {
      fs.mkdirSync(path.dirname(nw), { recursive: true });
      fs.renameSync(old, nw);
      return { toolId: this.id, status: 'success', output: `Renamed: ${params.old_path} → ${params.new_path}`, durationMs: 0 };
    } catch (err: any) { return { toolId: this.id, status: 'error', output: '', error: err.message, durationMs: 0 }; }
  }
}