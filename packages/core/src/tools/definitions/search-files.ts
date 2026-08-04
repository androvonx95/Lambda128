import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Tool, ToolResult, ToolExecutionContext, ValidationResult } from '@lambda128/shared';
import { TOOL_IDS } from '@lambda128/shared';
import type { FileCache } from '../../cache/file-cache.js';

const execAsync = promisify(exec);

export class SearchFilesTool implements Tool {
  readonly id = TOOL_IDS.SEARCH_FILES;
  readonly name = 'Search Files';
  readonly description = 'Search files using regex. Returns matching lines with context.';
  readonly category = 'READ' as const;
  readonly requiresApproval = 'configurable' as const;
  readonly parameters = {
    type: 'object' as const,
    properties: {
      path: { type: 'string' as const, description: 'Directory to search (relative to workspace).' },
      regex: { type: 'string' as const, description: 'Regex pattern.' },
      file_pattern: { type: 'string' as const, description: 'Optional glob filter (e.g. *.ts).' },
    },
    required: ['path', 'regex'],
  };

  private fileCache?: FileCache;
  setFileCache(c: FileCache) { this.fileCache = c; }

  validate(p: Record<string, unknown>): ValidationResult {
    if (!p.regex || typeof p.regex !== 'string') return { valid: false, errors: ['regex required'] };
    return { valid: true };
  }

  async execute(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const dir = (params.path as string) || '.';
    const regex = params.regex as string;
    const filePattern = params.file_pattern as string | undefined;
    const fullDir = path.resolve(ctx.workspaceRoot, dir);
    if (!fullDir.startsWith(ctx.workspaceRoot)) return { toolId: this.id, status: 'error', output: '', error: 'Path traversal', durationMs: 0 };

    const cacheKey = `search:${fullDir}:${regex}:${filePattern ?? '*'}`;
    if (this.fileCache?.has(cacheKey)) {
      const c = this.fileCache.get<ToolResult>(cacheKey)!;
      return { ...c, metadata: { ...c.metadata, cached: true } };
    }

    try {
      const glob = filePattern ? ` --glob '${filePattern.replace(/'/g, "\\'")}'` : '';
      const escaped = regex.replace(/'/g, "\\'");
      const { stdout, stderr } = await execAsync(`rg -n --no-heading --color never -e '${escaped}'${glob} '${fullDir}' 2>/dev/null || true`, { timeout: 10_000 });
      const output = stdout.trim() || 'No matches found.';
      const result: ToolResult = { toolId: this.id, status: 'success', output, durationMs: 0, metadata: { matchCount: stdout.trim().split('\n').filter(Boolean).length } };
      this.fileCache?.set(cacheKey, result, 15_000);
      return result;
    } catch (err: any) {
      return { toolId: this.id, status: 'error', output: '', error: err.message, durationMs: 0 };
    }
  }
}