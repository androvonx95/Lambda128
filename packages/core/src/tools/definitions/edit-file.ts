import { createPatch } from 'diff';
import type { Tool, ToolResult, ToolExecutionContext, ValidationResult } from '@lambda128/shared';
import { TOOL_IDS } from '@lambda128/shared';
import fs from 'node:fs';
import path from 'node:path';

interface SearchReplaceBlock { search: string; replace: string; }

export class EditFileTool implements Tool {
  readonly id = TOOL_IDS.EDIT_FILE;
  readonly name = 'Edit File';
  readonly description = `Apply targeted edits using SEARCH/REPLACE blocks.\nFormat:\n------- SEARCH\n[exact content]\n=======\n[new content]\n+++++++ REPLACE`;
  readonly category = 'WRITE' as const;
  readonly requiresApproval = true;
  readonly parameters = {
    type: 'object' as const,
    properties: {
      path: { type: 'string' as const, description: 'File path relative to workspace.' },
      edits: { type: 'string' as const, description: 'One or more SEARCH/REPLACE blocks.' },
    },
    required: ['path', 'edits'],
  };

  validate(p: Record<string, unknown>): ValidationResult {
    if (!p.path || typeof p.path !== 'string') return { valid: false, errors: ['path required'] };
    if (!p.edits || typeof p.edits !== 'string') return { valid: false, errors: ['edits required'] };
    return { valid: true };
  }

  async execute(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const fp = path.resolve(ctx.workspaceRoot, params.path as string);
    if (!fp.startsWith(ctx.workspaceRoot)) return { toolId: this.id, status: 'error', output: '', error: 'Path traversal', durationMs: 0 };
    try {
      const blocks = this.parseBlocks(params.edits as string);
      if (!blocks.length) return { toolId: this.id, status: 'error', output: '', error: 'No valid SEARCH/REPLACE blocks', durationMs: 0 };
      let content = fs.readFileSync(fp, 'utf-8');
      const orig = content;
      for (const b of blocks) {
        if (!content.includes(b.search)) return { toolId: this.id, status: 'error', output: '', error: `SEARCH not found:\n${b.search.substring(0, 200)}...`, durationMs: 0 };
        content = content.replace(b.search, b.replace);
      }
      fs.writeFileSync(fp, content, 'utf-8');
      const patch = createPatch(fp, orig, content, 'original', 'modified');
      const hunks = this.parseHunks(patch);
      return { toolId: this.id, status: 'success', output: patch, durationMs: 0, metadata: { path: params.path, originalContent: orig, newContent: content, hunks, applied: true, blocksApplied: blocks.length } };
    } catch (err: any) { return { toolId: this.id, status: 'error', output: '', error: err.message, durationMs: 0 }; }
  }

  private parseBlocks(text: string): SearchReplaceBlock[] {
    const blocks: SearchReplaceBlock[] = [];
    const re = /------- SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n\+\+\+\+\+\+\+ REPLACE/g;
    let m;
    while ((m = re.exec(text)) !== null) blocks.push({ search: m[1], replace: m[2] });
    return blocks;
  }

  private parseHunks(patch: string): Array<{ header: string; lines: string[] }> {
    const hunks: Array<{ header: string; lines: string[] }> = [];
    let cur: { header: string; lines: string[] } | null = null;
    for (const l of patch.split('\n')) {
      if (l.startsWith('@@')) { if (cur) hunks.push(cur); cur = { header: l, lines: [] }; }
      else if (cur && /^[+\- ]/.test(l)) cur.lines.push(l);
    }
    if (cur) hunks.push(cur);
    return hunks;
  }
}