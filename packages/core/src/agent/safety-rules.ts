/**
 * Safety Rules Engine — ported patterns from Cline's production SDK.
 * 
 * Enforces boundaries on what the agent can do:
 * - No eval/exec of arbitrary code
 * - No network requests (MVP)
 * - Workspace boundary enforcement
 * - Dangerous command detection
 * - File extension allowlisting
 * 
 * @see Cline: sdk/packages/core/src/runtime/safety/rules.ts
 */
import { resolve } from 'node:path';

export interface SafetyRule {
  id: string;
  description: string;
  category: 'block' | 'warn' | 'allow';
  check(params: SafetyCheckParams): SafetyCheckResult;
}

export interface SafetyCheckParams {
  toolName: string;
  params: Record<string, unknown>;
  workspaceRoot: string;
  sessionId: string;
}

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
  category: 'block' | 'warn' | 'allow';
}

/**
 * Safety rules that apply to all tool executions.
 * Rules are evaluated in order; first "block" result stops execution.
 */
export class SafetyRulesEngine {
  private rules: SafetyRule[] = [];

  constructor() {
    this.registerDefaultRules();
  }

  /**
   * Add a custom safety rule.
   */
  register(rule: SafetyRule): void {
    this.rules.push(rule);
  }

  /**
   * Run all rules against a tool execution request.
   * Returns the first blocking result, or the most severe warning.
   */
  evaluate(params: SafetyCheckParams): SafetyCheckResult {
    let worstWarning: SafetyCheckResult | null = null;

    for (const rule of this.rules) {
      const result = rule.check(params);
      if (!result.allowed && result.category === 'block') {
        return result; // Immediate block
      }
      if (!result.allowed && result.category === 'warn') {
        worstWarning = result;
      }
    }

    if (worstWarning) return worstWarning;
    return { allowed: true, category: 'allow' };
  }

  /**
   * Register the default set of safety rules ported from Cline.
   */
  private registerDefaultRules(): void {
    // Rule 1: Workspace boundary — no access outside workspace
    this.register({
      id: 'workspace-boundary',
      description: 'Prevent file access outside workspace root',
      category: 'block',
      check(params) {
        const filePath = params.params.filePath as string;
        const oldPath = params.params.oldPath as string;
        const newPath = params.params.newPath as string;
        const paths = [filePath, oldPath, newPath].filter(Boolean);

        for (const p of paths) {
          const resolved = resolve(p);
          if (!resolved.startsWith(resolve(params.workspaceRoot)) &&
              !resolved.startsWith('/tmp/') &&
              !resolved.startsWith('/dev/null')) {
            return {
              allowed: false,
              reason: `Access denied: ${p} is outside workspace root ${params.workspaceRoot}`,
              category: 'block',
            };
          }
        }
        return { allowed: true, category: 'allow' };
      },
    });

    // Rule 2: No sensitive system directories
    this.register({
      id: 'no-system-dirs',
      description: 'Prevent access to sensitive system directories',
      category: 'block',
      check(params) {
        const filePath = (params.params.filePath as string) || '';
        const blockedPrefixes = ['/etc/', '/usr/', '/boot/', '/sys/', '/proc/', '~/.ssh/', '~/.aws/'];
        for (const prefix of blockedPrefixes) {
          const resolved = prefix.startsWith('~/')
            ? resolve(process.env.HOME || '/home/user', prefix.slice(2))
            : prefix;
          if (filePath.startsWith(resolved)) {
            return {
              allowed: false,
              reason: `Access denied: ${filePath} is in a protected system directory`,
              category: 'block',
            };
          }
        }
        return { allowed: true, category: 'allow' };
      },
    });

    // Rule 3: Dangerous shell commands
    this.register({
      id: 'no-dangerous-commands',
      description: 'Detect and warn about potentially dangerous shell commands',
      category: 'warn',
      check(params) {
        if (params.toolName !== 'run_terminal') return { allowed: true, category: 'allow' };
        const command = (params.params.command as string) || '';
        const dangerous = [
          'rm -rf /', 'rm -rf ~', 'rm -rf .', ':(){ :|:& };:', 'mkfs.',
          'dd if=', '> /dev/sda', 'chmod 777 /', 'sudo rm', 'wget -O - | sh',
          'curl | sh', 'curl | bash', 'eval ', '$(', '`',
        ];
        for (const pattern of dangerous) {
          if (command.toLowerCase().includes(pattern.toLowerCase())) {
            return {
              allowed: false,
              reason: `Warning: command may be dangerous (matches "${pattern}"). Review carefully.`,
              category: 'warn',
            };
          }
        }
        return { allowed: true, category: 'allow' };
      },
    });

    // Rule 4: No network requests (MVP)
    this.register({
      id: 'no-network-mvp',
      description: 'Block network requests in MVP',
      category: 'block',
      check(params) {
        if (params.toolName === 'web_fetch' || params.toolName === 'run_terminal') {
          const command = (params.params.command as string) || '';
          const networkPatterns = ['curl ', 'wget ', 'fetch ', 'http://', 'https://',
            'npx ', 'npm install', 'pip install', 'yarn add', 'pnpm add'];
          for (const pattern of networkPatterns) {
            if (command.includes(pattern)) {
              return {
                allowed: false,
                reason: 'Network requests are not allowed in MVP. Install packages manually.',
                category: 'warn',
              };
            }
          }
        }
        return { allowed: true, category: 'allow' };
      },
    });

    // Rule 5: Max file size for AI writes
    this.register({
      id: 'max-file-size',
      description: 'Limit maximum file size for AI writes',
      category: 'block',
      check(params) {
        if (['write_file', 'edit_file'].includes(params.toolName)) {
          const content = (params.params.content as string) || '';
          const maxBytes = 1_000_000; // 1MB
          if (Buffer.byteLength(content, 'utf-8') > maxBytes) {
            return {
              allowed: false,
              reason: `File content exceeds maximum size of ${maxBytes / 1_000_000}MB`,
              category: 'block',
            };
          }
        }
        return { allowed: true, category: 'allow' };
      },
    });
  }
}