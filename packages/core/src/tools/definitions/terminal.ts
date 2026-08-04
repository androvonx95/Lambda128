import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolResult, ToolExecutionContext, ValidationResult } from '@lambda128/shared';
import { TOOL_IDS, LIMITS } from '@lambda128/shared';

const execAsync = promisify(exec);

const DANGEROUS = /\b(rm\s+-rf|sudo|chmod\s+777|mkfs|dd\s+if|:\(\)\s*\{|fork\s*bomb)\b/i;

export class RunTerminalTool implements Tool {
  readonly id = TOOL_IDS.RUN_TERMINAL;
  readonly name = 'Run Terminal Command';
  readonly description = 'Execute a shell command. Requires user approval.';
  readonly category = 'SHELL' as const;
  readonly requiresApproval = true;
  readonly parameters = {
    type: 'object' as const,
    properties: {
      command: { type: 'string' as const, description: 'Shell command to execute.' },
      cwd: { type: 'string' as const, description: 'Working directory (relative to workspace).' },
    },
    required: ['command'],
  };
  validate(p: Record<string, unknown>): ValidationResult {
    const cmd = p.command as string;
    if (!cmd || typeof cmd !== 'string') return { valid: false, errors: ['command required'] };
    if (DANGEROUS.test(cmd)) return { valid: false, errors: ['Dangerous command detected'] };
    return { valid: true };
  }
  async execute(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const command = params.command as string;
    const cwd = params.cwd ? `${ctx.workspaceRoot}/${params.cwd}` : ctx.workspaceRoot;
    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout: LIMITS.MAX_SHELL_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
      return { toolId: this.id, status: 'success', output: stdout || stderr || '(no output)', durationMs: 0 };
    } catch (err: any) {
      return { toolId: this.id, status: 'error', output: err.stdout || '', error: err.stderr || err.message, durationMs: 0 };
    }
  }
}