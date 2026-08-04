import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolResult, ToolExecutionContext, ValidationResult } from '@lambda128/shared';
import { TOOL_IDS } from '@lambda128/shared';

const execAsync = promisify(exec);

async function gitCmd(ctx: ToolExecutionContext, args: string): Promise<string> {
  const { stdout } = await execAsync(`git -C '${ctx.workspaceRoot.replace(/'/g, "\\'")}' ${args} 2>&1`, { timeout: 10_000 });
  return stdout.trim();
}

export class GitStatusTool implements Tool {
  readonly id = TOOL_IDS.GIT_STATUS;
  readonly name = 'Git Status';
  readonly description = 'Show working tree status.';
  readonly category = 'READ' as const;
  readonly requiresApproval = 'configurable' as const;
  readonly parameters = { type: 'object' as const, properties: {}, required: [] };
  validate(): ValidationResult { return { valid: true }; }
  async execute(_: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    try {
      const output = await gitCmd(ctx, 'status --short');
      return { toolId: this.id, status: 'success', output: output || '(clean)', durationMs: 0 };
    } catch (err: any) { return { toolId: this.id, status: 'error', output: '', error: err.message, durationMs: 0 }; }
  }
}

export class GitDiffTool implements Tool {
  readonly id = TOOL_IDS.GIT_DIFF;
  readonly name = 'Git Diff';
  readonly description = 'Show staged/unstaged diffs.';
  readonly category = 'READ' as const;
  readonly requiresApproval = 'configurable' as const;
  readonly parameters = {
    type: 'object' as const,
    properties: { staged: { type: 'boolean' as const, description: 'Show staged changes only.' } },
    required: [],
  };
  validate(): ValidationResult { return { valid: true }; }
  async execute(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    try {
      const flag = params.staged ? '--staged' : '';
      const output = await gitCmd(ctx, `diff ${flag} -- .`);
      return { toolId: this.id, status: 'success', output: output || '(no changes)', durationMs: 0 };
    } catch (err: any) { return { toolId: this.id, status: 'error', output: '', error: err.message, durationMs: 0 }; }
  }
}