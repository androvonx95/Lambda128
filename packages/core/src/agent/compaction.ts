/**
 * Conversation Compaction — ported patterns from Cline's production SDK.
 * 
 * When conversation history exceeds the model's context window, instead of
 * simply dropping old messages (which loses context), we summarize them
 * using a lightweight LLM call and replace them with the summary.
 * 
 * Two levels:
 * - Basic: Simple truncation (drop oldest messages beyond limit)
 * - Agentic: Uses a second LLM call to summarize old turns
 * 
 * @see Cline: sdk/packages/core/src/extensions/context/compaction.ts
 * @see Cline: sdk/packages/core/src/extensions/context/agentic-compaction.ts
 */
import type { Message } from '@lambda128/shared';

export interface CompactionOptions {
  /** Maximum number of message turns to keep before compacting */
  maxTurnsBeforeCompaction: number;
  /** Minimum number of turns to always keep (most recent) */
  minKeepTurns: number;
  /** Whether to use agentic (LLM-based) summarization */
  useAgenticCompaction: boolean;
  /** Function to call for LLM summarization (if agentic) */
  summarizeFn?: (messages: Message[]) => Promise<string>;
}

export interface CompactionResult {
  /** The compacted message list */
  messages: Message[];
  /** Whether compaction was performed */
  compacted: boolean;
  /** Summary text (if agentic compaction was used) */
  summary?: string;
  /** Number of messages removed */
  removedCount: number;
}

/**
 * Compaction engine: keeps conversation history within token budget
 * by summarizing or truncating old messages.
 */
export class CompactionEngine {
  private options: CompactionOptions;

  constructor(options: Partial<CompactionOptions> = {}) {
    this.options = {
      maxTurnsBeforeCompaction: 10,
      minKeepTurns: 3,
      useAgenticCompaction: true,
      ...options,
    };
  }

  /**
   * Check if compaction is needed and perform it.
   * A "turn" = one user message + one assistant response.
   */
  async compact(messages: Message[]): Promise<CompactionResult> {
    const turns = this.countTurns(messages);

    if (turns <= this.options.maxTurnsBeforeCompaction) {
      return { messages, compacted: false, removedCount: 0 };
    }

    // Calculate how many turns to compact
    const turnsToCompact = turns - this.options.minKeepTurns;
    const messagesToCompact = this.getMessagesForTurns(messages, turnsToCompact);
    const messagesToKeep = messages.slice(messagesToCompact.length);

    if (this.options.useAgenticCompaction && this.options.summarizeFn) {
      // Agentic: summarize old turns
      try {
        const summary = await this.options.summarizeFn(messagesToCompact);
        const summaryMsg: Message = {
          id: 'compaction-summary-' + Date.now(),
          role: 'system',
          content: `[Previous conversation summary]\n${summary}`,
          createdAt: Date.now(),
        };
        return {
          messages: [summaryMsg, ...messagesToKeep],
          compacted: true,
          summary,
          removedCount: messagesToCompact.length,
        };
      } catch {
        // Fall through to basic compaction on error
      }
    }

    // Basic: just truncate
    return {
      messages: messagesToKeep,
      compacted: true,
      removedCount: messagesToCompact.length,
    };
  }

  /**
   * Count the number of conversation turns (user+assistant pairs).
   */
  private countTurns(messages: Message[]): number {
    let turns = 0;
    for (const msg of messages) {
      if (msg.role === 'user') turns++;
    }
    return turns;
  }

  /**
   * Get the messages belonging to the first N turns.
   */
  private getMessagesForTurns(messages: Message[], numTurns: number): Message[] {
    let turnCount = 0;
    const result: Message[] = [];
    for (const msg of messages) {
      result.push(msg);
      if (msg.role === 'user') {
        turnCount++;
        if (turnCount >= numTurns) break;
      }
    }
    return result;
  }

  /**
   * Generate a default summarization prompt for the LLM.
   */
  static buildSummarizationPrompt(messages: Message[]): string {
    const conversation = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content?.substring(0, 500) || '(tool call)'}`)
      .join('\n\n');

    return `Summarize the following conversation between an AI coding assistant and a user. 
Focus on: what was requested, what files were examined/modified, key decisions made, 
and the current state of the task. Keep the summary concise (under 500 words).

CONVERSATION:
${conversation}

SUMMARY:`;
  }
}