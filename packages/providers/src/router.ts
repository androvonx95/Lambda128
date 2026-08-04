import type { AIProvider, ChatOptions, ChatResponse, ChatChunk, Message, ModelInfo, RateLimitInfo, AIError } from '@lambda128/shared';
import { PROVIDER_IDS } from '@lambda128/shared';

/**
 * Provider router: selects and manages AI providers.
 * Handles failover, rate limit tracking, and provider health.
 */
export class ProviderRouter {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProviderId: string | null = null;
  private fallbackChain: string[] = [];

  register(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
    if (!this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
  }

  setDefault(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(`Provider '${providerId}' not registered`);
    }
    this.defaultProviderId = providerId;
  }

  setFallbackChain(providerIds: string[]): void {
    this.fallbackChain = providerIds.filter(id => this.providers.has(id));
  }

  getProvider(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  getDefaultProvider(): AIProvider {
    if (!this.defaultProviderId) {
      throw new Error('No default provider configured');
    }
    return this.providers.get(this.defaultProviderId)!;
  }

  listProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Resolve which provider to use, considering fallbacks.
   */
  async resolveProvider(preferredId?: string): Promise<AIProvider> {
    const chain = preferredId
      ? [preferredId, ...this.fallbackChain.filter(id => id !== preferredId)]
      : [this.defaultProviderId!, ...this.fallbackChain.filter(id => id !== this.defaultProviderId)];

    for (const id of chain) {
      const provider = this.providers.get(id);
      if (provider) {
        try {
          const rateLimit = await provider.checkRateLimit();
          if (rateLimit.remaining > 0) {
            return provider;
          }
        } catch {
          // Provider unavailable, try next
          continue;
        }
      }
    }

    throw new Error('No available AI provider');
  }

  /**
   * Send a chat request with automatic failover.
   */
  async chat(
    messages: Message[],
    options: ChatOptions,
    preferredProviderId?: string
  ): Promise<{ response: ChatResponse; providerId: string }> {
    let lastError: AIError | null = null;

    const chain = this.buildChain(preferredProviderId);
    for (const providerId of chain) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      try {
        const response = await this.retryWithBackoff(
          () => provider.chat(messages, options),
          3
        );
        return { response, providerId };
      } catch (err: any) {
        lastError = this.normalizeError(err, providerId);
        if (!lastError.retryable) break; // Don't retry non-retryable errors
      }
    }

    throw lastError || new Error('All providers failed');
  }

  /**
   * Stream a chat response with automatic failover.
   */
  async *chatStream(
    messages: Message[],
    options: ChatOptions,
    preferredProviderId?: string
  ): AsyncIterable<ChatChunk & { providerId: string }> {
    const chain = this.buildChain(preferredProviderId);
    let lastError: AIError | null = null;

    for (const providerId of chain) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      try {
        for await (const chunk of provider.chatStream(messages, options)) {
          yield { ...chunk, providerId };
        }
        return;
      } catch (err: any) {
        lastError = this.normalizeError(err, providerId);
        if (!lastError.retryable) break;
      }
    }

    throw lastError || new Error('All providers failed during streaming');
  }

  private buildChain(preferredId?: string): string[] {
    const chain: string[] = [];
    if (preferredId && this.providers.has(preferredId)) {
      chain.push(preferredId);
    }
    if (this.defaultProviderId && !chain.includes(this.defaultProviderId)) {
      chain.push(this.defaultProviderId);
    }
    for (const id of this.fallbackChain) {
      if (!chain.includes(id)) chain.push(id);
    }
    return chain;
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i < maxRetries - 1) {
          await this.sleep(Math.pow(2, i) * 1000); // 1s, 2s, 4s
        }
      }
    }
    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private normalizeError(err: any, providerId: string): AIError {
    return {
      code: err.code || 'UNKNOWN',
      message: err.message || 'Unknown error',
      status: err.status,
      retryable: err.status === 429 || err.status === 503 || err.status === 502,
      providerId,
    };
  }
}