import type { AIProvider, Message, ChatOptions, ChatResponse, ChatChunk, ModelInfo, RateLimitInfo, ToolDefinition } from '@lambda128/shared';
import { PROVIDER_IDS } from '@lambda128/shared';

const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'openai/gpt-4o', providerId: PROVIDER_IDS.OPENROUTER, displayName: 'GPT-4o (OpenRouter)', contextWindow: 128_000, maxOutputTokens: 16_384, supportsStreaming: true, supportsToolCalling: true, supportsVision: true, pricing: { inputPer1k: 0.0025, outputPer1k: 0.01 } },
  { id: 'anthropic/claude-sonnet-4-20250514', providerId: PROVIDER_IDS.OPENROUTER, displayName: 'Claude Sonnet 4 (OpenRouter)', contextWindow: 200_000, maxOutputTokens: 8_192, supportsStreaming: true, supportsToolCalling: true, supportsVision: true, pricing: { inputPer1k: 0.003, outputPer1k: 0.015 } },
  { id: 'google/gemini-2.5-flash', providerId: PROVIDER_IDS.OPENROUTER, displayName: 'Gemini 2.5 Flash (OpenRouter)', contextWindow: 1_048_576, maxOutputTokens: 8_192, supportsStreaming: true, supportsToolCalling: true, supportsVision: true, pricing: { inputPer1k: 0.00015, outputPer1k: 0.0006 } },
];

export class OpenRouterProvider implements AIProvider {
  readonly id = PROVIDER_IDS.OPENROUTER;
  readonly name = 'OpenRouter';
  readonly supportsStreaming = true;
  readonly supportsToolCalling = true;
  readonly defaultModels = DEFAULT_MODELS;
  private apiKey: string | null = null;

  setApiKey(key: string) { this.apiKey = key; }

  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}`, 'HTTP-Referer': 'lambda128', 'X-Title': 'lambda128' },
      body: JSON.stringify({ model: options.model, messages: this.formatMessages(messages), max_tokens: options.maxTokens || 4096, temperature: options.temperature, tools: options.tools ? this.convertTools(options.tools) : undefined, tool_choice: options.toolChoice, stream: false }),
    });
    if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const choice = data.choices?.[0];
    const msg = choice?.message;
    const toolCalls = msg?.tool_calls?.map((tc: any) => ({ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments) }));
    return { id: data.id, content: msg?.content || '', toolCalls: toolCalls?.length ? toolCalls : undefined, usage: { prompt: data.usage?.prompt_tokens || 0, completion: data.usage?.completion_tokens || 0, total: data.usage?.total_tokens || 0 }, finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop' };
  }

  async *chatStream(messages: Message[], options: ChatOptions): AsyncIterable<ChatChunk> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}`, 'HTTP-Referer': 'lambda128', 'X-Title': 'lambda128' },
      body: JSON.stringify({ model: options.model, messages: this.formatMessages(messages), max_tokens: options.maxTokens || 4096, temperature: options.temperature, tools: options.tools ? this.convertTools(options.tools) : undefined, tool_choice: options.toolChoice, stream: true }),
    });
    if (!res.ok) throw new Error(`OpenRouter error ${res.status}`);
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const d = JSON.parse(line.slice(6));
        const delta = d.choices?.[0]?.delta;
        if (delta?.content) yield { contentDelta: delta.content };
        if (d.usage) yield { usage: { prompt: d.usage.prompt_tokens, completion: d.usage.completion_tokens, total: d.usage.total_tokens } };
      } catch { /* skip malformed SSE */ }
    }
  }

  async listModels(): Promise<ModelInfo[]> { return DEFAULT_MODELS; }
  async getModelInfo(id: string): Promise<ModelInfo> { const m = DEFAULT_MODELS.find(x => x.id === id); if (!m) throw new Error(`Unknown: ${id}`); return m; }
  async validateApiKey(key: string): Promise<boolean> { try { const r = await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { 'Authorization': `Bearer ${key}` } }); return r.ok; } catch { return false; } }
  async checkRateLimit(): Promise<RateLimitInfo> { return { remaining: 100, limit: 100, resetAt: Date.now() + 60_000 }; }

  private formatMessages(messages: Message[]): Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }> {
    return messages.map(msg => {
      if (msg.role === 'system') return { role: 'system', content: msg.content };
      if (msg.role === 'user') return { role: 'user', content: msg.content };
      if (msg.role === 'tool') return { role: 'tool', content: msg.content, tool_call_id: msg.toolCallId || '' };
      if (msg.role === 'assistant') {
        const m: any = { role: 'assistant', content: msg.content || null };
        if (msg.toolCalls) m.tool_calls = msg.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } }));
        return m;
      }
      return { role: 'user', content: msg.content };
    });
  }

  private convertTools(tools: ToolDefinition[]): Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }> {
    return tools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.parameters.properties, required: t.parameters.required } } }));
  }
}