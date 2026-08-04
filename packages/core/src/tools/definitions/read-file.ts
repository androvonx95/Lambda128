import type { Tool, ToolResult, ToolExecutionContext, ValidationResult } from '@lambda128/shared';
import { TOOL_IDS } from '@lambda128/shared';
import fs from 'node:fs';
import path from 'node:path';
import type { FileCache } from '../../cache/file-cache.js';

export class ReadFileTool implements Tool {
  readonly id = TOOL_IDS.READ_FILE;
  readonly name = 'Read File';
  readonly description = 'Read the contents of a file at the specified path. Returns the file content with line numbers.';
  readonly category = 'READ' as const;
  readonly requiresApproval = 'configurable' as const;
  readonly parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string' as const,
        description: 'The path of the file to read, relative to the workspace root.',
      },
      start_line: {
        type: 'number' as const,
        description: 'Optional. The 1-based line number to start reading from (inclusive).',
      },
      end_line: {
        type: 'number' as const,
        description: 'Optional. The 1-based line number to stop reading at (inclusive).',
      },
    },
    required: ['path'],
  };

  private fileCache?: FileCache;

  setFileCache(cache: FileCache): void {
    this.fileCache = cache;
  }

  validate(params: Record<string, unknown>): ValidationResult {
    if (!params.path || typeof params.path !== 'string') {
      return { valid: false, errors: ['path is required and must be a string'] };
    }
    return { valid: true };
  }

  async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const filePath = params.path as string;
    const startLine = params.start_line as number | undefined;
    const endLine = params.end_line as number | undefined;

    // Resolve and validate path
    const fullPath = path.resolve(context.workspaceRoot, filePath);

    // Security: ensure path is within workspace
    if (!fullPath.startsWith(context.workspaceRoot)) {
      return {
        toolId: this.id,
        status: 'error',
        output: '',
        error: 'Path traversal detected: file is outside workspace',
        durationMs: 0,
      };
    }

    // Check cache for full-file reads (no line range)
    const cacheKey = `file:${fullPath}:${startLine ?? 'all'}:${endLine ?? 'all'}`;
    if (this.fileCache && this.fileCache.has(cacheKey)) {
      const cached = this.fileCache.get<ToolResult>(cacheKey);
      if (cached) {
        return { ...cached, durationMs: 0, metadata: { ...cached.metadata, cached: true } };
      }
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      let outputLines: string[];
      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(1, startLine || 1) - 1;
        const end = Math.min(lines.length, endLine || lines.length);
        outputLines = lines.slice(start, end);
      } else {
        outputLines = lines;
      }

      const numbered = outputLines
        .map((line, i) => {
          const lineNum = (startLine || 1) + i;
          return `${String(lineNum).padStart(4, ' ')} | ${line}`;
        })
        .join('\n');

      const result: ToolResult = {
        toolId: this.id,
        status: 'success',
        output: numbered,
        durationMs: 0,
        metadata: {
          path: filePath,
          totalLines: lines.length,
          displayedLines: outputLines.length,
        },
      };

      // Cache the result
      if (this.fileCache) {
        this.fileCache.set(cacheKey, result, 60_000);
      }

      return result;
    } catch (err: any) {
      return {
        toolId: this.id,
        status: 'error',
        output: '',
        error: `Failed to read file: ${err.message}`,
        durationMs: 0,
      };
    }
  }
}
