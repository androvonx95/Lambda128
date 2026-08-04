import type { Message, ToolDefinition, ContextSnapshot } from '@lambda128/shared';
import { SYSTEM_PROMPT } from '@lambda128/shared';

export interface PromptAssemblyOptions {
  systemPrompt?: string;
  context?: ContextSnapshot;
  tools?: ToolDefinition[];
  includeHistory?: boolean;
}

/**
 * Prompt orchestrator: assembles the final prompt array from all context sources.
 */
export class PromptOrchestrator {
  private systemPrompt: string;
  private cachedSystemPrompt: string | null = null;
  private lastToolHash: string | null = null;

  constructor(systemPrompt?: string) {
    this.systemPrompt = systemPrompt || SYSTEM_PROMPT;
  }

  /**
   * Assemble the full message array for a chat request.
   */
  assemble(
    userMessage: string,
    history: Message[],
    options: PromptAssemblyOptions = {}
  ): Message[] {
    const messages: Message[] = [];

    // 1. System prompt
    messages.push({
      id: 'system',
      role: 'system',
      content: this.buildSystemPrompt(options),
      createdAt: Date.now(),
    });

    // 2. Workspace context (if available)
    if (options.context) {
      const contextBlock = this.buildContextBlock(options.context);
      if (contextBlock) {
        messages.push({
          id: 'context',
          role: 'user',
          content: contextBlock,
          createdAt: Date.now(),
        });
      }
    }

    // 3. Conversation history
    if (options.includeHistory !== false) {
      messages.push(...history);
    }

    // 4. Current user message
    messages.push({
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      createdAt: Date.now(),
    });

    return messages;
  }

  /**
   * Build the system prompt with tool instructions.
   */
  private buildSystemPrompt(options: PromptAssemblyOptions): string {
    // Memoize: only rebuild if tools changed
    const toolHash = options.tools ? JSON.stringify(options.tools.map(t => t.name).sort()) : 'none';
    if (this.cachedSystemPrompt && this.lastToolHash === toolHash) {
      return this.cachedSystemPrompt;
    }

    let prompt = this.systemPrompt;

    if (options.tools && options.tools.length > 0) {
      prompt += '\n\nAVAILABLE TOOLS:\n';
      prompt += 'You have access to the following tools. Use them to read files, search code, and make edits.\n';
      prompt += 'When making edits, always use the edit_file tool with SEARCH/REPLACE blocks.\n';
      prompt += 'Never write directly to files without showing the user a diff first.\n';
    }

    this.cachedSystemPrompt = prompt;
    this.lastToolHash = toolHash;
    return prompt;
  }

  /**
   * Build a context block from the current workspace state.
   */
  private buildContextBlock(context: ContextSnapshot): string | null {
    const parts: string[] = [];

    if (context.activeFile) {
      parts.push(`<active_file>\n${context.activeFile.path}\n`);
      if (context.activeFile.content) {
        parts.push(`<file_content path="${context.activeFile.path}">\n${context.activeFile.content}\n</file_content>`);
      }
      if (context.selectedCode) {
        parts.push(`<selected_code>\n${context.selectedCode}\n</selected_code>`);
      }
      parts.push('</active_file>');
    }

    if (context.openEditors.length > 0) {
      parts.push('<open_editors>');
      for (const editor of context.openEditors) {
        parts.push(`- ${editor.path} (${editor.language})`);
      }
      parts.push('</open_editors>');
    }

    if (context.projectStructure) {
      parts.push(`<project_structure>\n${context.projectStructure}\n</project_structure>`);
    }

    if (context.gitStatus) {
      parts.push(`<git_status>\nBranch: ${context.gitStatus.branch}\nModified: ${context.gitStatus.status.unstaged.join(', ') || 'none'}\n</git_status>`);
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  /**
   * Estimate token count for a message array (rough approximation).
   * Uses ~4 chars per token as a simple heuristic.
   */
  estimateTokens(messages: Message[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += msg.content.length;
      if (msg.toolCalls) {
        totalChars += JSON.stringify(msg.toolCalls).length;
      }
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * Trim conversation history to fit within a token budget.
   */
  trimHistory(history: Message[], maxTokens: number): Message[] {
    if (history.length === 0) return [];

    let tokens = 0;
    const kept: Message[] = [];

    // Keep from most recent backwards
    for (let i = history.length - 1; i >= 0; i--) {
      const msgTokens = this.estimateTokens([history[i]]);
      if (tokens + msgTokens > maxTokens) break;
      tokens += msgTokens;
      kept.unshift(history[i]);
    }

    return kept;
  }
}