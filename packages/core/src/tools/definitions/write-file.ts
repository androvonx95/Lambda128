import type { Tool, ToolResult, ToolExecutionContext, ValidationResult } from '@lambda128/shared';
import { TOOL_IDS, LIMITS } from '@lambda128/shared';
import fs from 'node:fs';
import path from 'node:path';

export class WriteFileTool implements Tool {
  readonly id = TOOL_IDS.WRITE_FILE;
  readonly name = 'Write File';
  readonly description = 'Create a new file or overwrite an existing file with the given content.';
  readonly category = 'WRITE' as const;
  readonly requiresApproval = true;
  readonly parameters = {
    type: 'object' as const,
    properties: {
      path: { type: 'string' as const, description: 'File path relative to workspace root.' },
      content: { type: 'string' as const, description: 'The full content to write to the file.' },
    },
    required: ['path', 'content'],
  };

  validate(params: Record<string, unknown>): ValidationResult {
    if (!params.path || typeof params.path !== 'string') return { valid: false, errors: ['path required'] };
    if (typeof params.content !== 'string') return { valid: false, errors: ['content required'] };
    return { valid: true };
  }

  async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const filePath = params.path as string;
    const content = params.content as string;
    const fullPath = path.resolve(context.workspaceRoot, filePath);

    if (!fullPath.startsWith(context.workspaceRoot)) {
      return { toolId: this.id, status: 'error', output: '', error: 'Path traversal detected', durationMs: 0 };
    }

    if (content.length > LIMITS.MAX_FILE_SIZE_BYTES) {
      return { toolId: this.id, status: 'error', output: '', error: `Content exceeds max size of ${LIMITS.MAX_FILE_SIZE_BYTES} bytes`, durationMs: 0 };
    }

    try {
      const existed = fs.existsSync(fullPath);
      const originalContent = existed ? fs.readFileSync(fullPath, 'utf-8') : '';
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');

      const diff = existed
        ? this.generateDiff(filePath, originalContent, content)
        : `New file: ${filePath}\n${content.split('\n').map((l, i) => `+${l}`).join('\n')}`;

      return {
        toolId: this.id, status: 'success', output: diff, durationMs: 0,
        metadata: { path: filePath, existed, originalContent, newContent: content },
      };
    } catch (err: any) {
      return { toolId: this.id, status: 'error', output: '', error: `Write failed: ${err.message}`, durationMs: 0 };
    }
  }

  private generateDiff(filePath: string, original: string, modified: string): string {
    const o = original.split('\n'), m = modified.split('\n');
    let diff = `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${o.length} +1,${m.length} @@\n`;
    for (const l of o) diff += `-${l}\n`;
    for (const l of m) diff += `+${l}\n`;
    return diff;
  }
}