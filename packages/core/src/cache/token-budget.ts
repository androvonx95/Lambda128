import type { Message } from '@lambda128/shared';

export interface TokenBudgetState {
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  isWarning: boolean;
  isCritical: boolean;
}

/**
 * Token budget manager: tracks cumulative token usage per agent session.
 * Trims conversation history when approaching limits.
 * Emits warnings at 80% threshold, critical at 95%.
 */
export class TokenBudgetManager {
  private totalUsed: number = 0;
  private contextLimit: number;
  private reservedOutputTokens: number;
  private warningThreshold: number;
  private criticalThreshold: number;

  constructor(contextLimit: number = 200_000, reservedOutputTokens: number = 8_192) {
    this.contextLimit = contextLimit;
    this.reservedOutputTokens = reservedOutputTokens;
    this.warningThreshold = 0.80;
    this.criticalThreshold = 0.95;
  }

  /**
   * Estimate tokens for a message array using ~4 chars per token heuristic.
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
   * Estimate tokens for a single string.
   */
  estimateStringTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Track token usage from a completed LLM call.
   */
  trackUsage(promptTokens: number, completionTokens: number): void {
    this.totalUsed += promptTokens + completionTokens;
  }

  /**
   * Get the current budget state.
   */
  getState(): TokenBudgetState {
    const available = this.contextLimit - this.reservedOutputTokens;
    const remaining = Math.max(0, available - this.totalUsed);
    const percentUsed = available > 0 ? this.totalUsed / available : 1;

    return {
      used: this.totalUsed,
      limit: this.contextLimit,
      remaining,
      percentUsed,
      isWarning: percentUsed >= this.warningThreshold,
      isCritical: percentUsed >= this.criticalThreshold,
    };
  }

  /**
   * Check if there's room for more tokens.
   */
  canFit(tokens: number): boolean {
    const available = this.contextLimit - this.reservedOutputTokens;
    return (this.totalUsed + tokens) <= available;
  }

  /**
   * Trim conversation history to fit within remaining budget.
   * Keeps the most recent messages, drops oldest first.
   * Always keeps the last 2 turns (user + assistant pairs).
   */
  trimHistory(history: Message[], minKeepTurns: number = 2): Message[] {
    if (history.length === 0) return [];

    const available = this.contextLimit - this.reservedOutputTokens - this.totalUsed;
    if (available <= 0) {
      // Keep only the minimum turns
      const minMessages = minKeepTurns * 2; // user + assistant per turn
      return history.slice(-Math.min(minMessages, history.length));
    }

    let tokens = 0;
    const kept: Message[] = [];

    // Keep from most recent backwards
    for (let i = history.length - 1; i >= 0; i--) {
      const msgTokens = this.estimateTokens([history[i]]);
      if (tokens + msgTokens > available) break;
      tokens += msgTokens;
      kept.unshift(history[i]);
    }

    // Ensure minimum turns are kept
    const minMessages = minKeepTurns * 2;
    if (kept.length < minMessages && history.length >= minMessages) {
      return history.slice(-minMessages);
    }

    return kept;
  }

  /**
   * Reset the budget for a new session.
   */
  reset(): void {
    this.totalUsed = 0;
  }

  /**
   * Set a new context limit (e.g., when switching models).
   */
  setContextLimit(limit: number): void {
    this.contextLimit = limit;
  }
}