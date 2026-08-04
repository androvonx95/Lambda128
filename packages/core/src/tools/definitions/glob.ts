import fs from 'node:fs';
import path from 'node:path';
import type { Tool, ToolResult, ToolExecutionContext, ValidationResult } from '@lambda128/shared';
import { TOOL_IDS } from '@lambda128/shared';

export class GlobTool implements Tool {
  readonly id = TOOL_IDS.GLOB;
  readonly name = 'Glob';
  readonly description = 'Find files matching a glob pattern.';
  readonly category = 'READ' as const;
  readonly requiresApproval = 'configurable' as const;
  readonly parameters = {
    type: 'object' as const,
    properties: {
      pattern: { type: 'string' as const, description: 'Glob pattern (e.g. **/*.ts).' },
      path: { type: 'string' as const, description: 'Base directory (relative to workspace).' },
    },
    required: ['pattern'],
  };
  validate(p: Record<string, unknown>): ValidationResult {
    if (!p.pattern || typeof p.pattern !== 'string') return { valid: false, errors: ['pattern required'] };
    return { valid: true };
  }
  async execute(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const pattern = params.pattern as string;
    const base = path.resolve(ctx.workspaceRoot, (params.path as string) || '.');
    if (!base.startsWith(ctx.workspaceRoot)) return { toolId: this.id, status: 'error', output: '', error: 'Path traversal', durationMs: 0 };

    try {
      const results = this.walkGlob(base, pattern);
      return { toolId: this.id, status: 'success', output: results.join('\n') || 'No matches.', durationMs: 0, metadata: { count: results.length } };
    } catch (err: any) {
      return { toolId: this.id, status: 'error', output: '', error: err.message, durationMs: 0 };
    }
  }
  private walkGlob(dir: string, pattern: string, results: string[] = [], max = 500): string[] {
    if (results.length >= max) return results;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { this.walkGlob(fp, pattern, results, max); continue; }
      if (this.matchGlob(e.name, pattern)) results.push(fp);
    }
    return results;
  }
  private matchGlob(name: string, pattern: string): boolean {
    const re = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${re}$`).test(name);
  }
}