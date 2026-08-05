/**
 * Ollama Provider — local LLM inference via Ollama's OpenAI-compatible API.
 *
 * Ollama exposes an OpenAI-compatible endpoint at localhost:11434/v1.
 * No API key required — just install Ollama and pull a model.
 *
 * https://ollama.com/blog/openai-compatibility
 */
import type { AIProvider, ChatOptions, ChatResponse, ChatChunk, Message, ModelInfo, RateLimitInfo, ToolDefinition, ToolCall } from '@lambda128/shared';
import { PROVIDER_IDS } from '@lambda128/shared';

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export class OllamaProvider implements AIProvider {
  readonly id = PROVIDER_IDS.OLLAMA;
  readonly name = 'Ollama';
  readonly supportsStreaming = true;
  readonly supportsToolCalling = true;
  readonly defaultModels: ModelInfo[] = [
    this.makeModelInfo('llama3.2', 'Llama 3.2', 128000),
    this.makeModelInfo('llama3.1:8b', 'Llama 3.1 8B', 128000),
    this.makeModelInfo('codellama:13b', 'CodeLlama 13B', 16384),
    this.makeModelInfo('qwen2.5-coder:7b', 'Qwen 2.5 Coder 7B', 32768),
    this.makeModelInfo('deepseek-coder-v2', 'DeepSeek Coder V2', 128000),
    this.makeModelInfo('mistral:7b', 'Mistral 7B', 32768),
    this.makeModelInfo('codestral:22b', 'Codestral 22B', 32768),
  ];

  private baseUrl: string;
  private model: string;

  constructor(model?: string, baseUrl?: string) {
    this.baseUrl = baseUrl || 'http://localhost:11434/v1';
    this.model = model || 'llama3.2';
  }

  setModel(model: string): void {
    this.model = model;
  }

  async validateApiKey(_key: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/v1\/?$/, '')}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async checkRateLimit(): Promise<RateLimitInfo> {
    return { remaining: 9999, limit: 9999, resetAt: Date.now() + 3600000 };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/v1\/?$/, '')}/api/tags`);
      if (!res.ok) return this.defaultModels;
      const data = await res.json() as { models: OllamaModel[] };
      const models: ModelInfo[] = data.models.map(m => this.makeModelInfo(m.name, m.name, 32768));
      return models.length > 0 ? models : this.defaultModels;
    } catch {
      return this.defaultModels;
    }
  }

  async getModelInfo(modelId: string): Promise<ModelInfo> {
    const models = await this.listModels();
    return models.find(m => m.id === modelId) || this.makeModelInfo(modelId, modelId, 32768);
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const model = options.model || this.model;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => this.convertMessage(m)),
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = this.convertTools(options.tools);
      body.tool_choice = options.toolChoice || 'auto';
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ollama' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama error (${res.status}): ${err}`);
    }

    const completion = await res.json() as Record<string, unknown>;
    const choice = ((completion.choices as Array<Record<string, unknown>>)?.[0]) || {};
    const msg = (choice.message as Record<string, unknown>) || {};

    const response: ChatResponse = {
      id: (completion.id as string) || crypto.randomUUID(),
      content: (msg.content as string) || '',
      usage: {
        prompt: (completion.usage as Record<string, number>)?.prompt_tokens || 0,
        completion: (completion.usage as Record<string, number>)?.completion_tokens || 0,
        total: (completion.usage as Record<string, number>)?.total_tokens || 0,
      },
      finishReason: this.mapFinishReason(choice.finish_reason as string),
    };

    const toolCallData = msg.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCallData && toolCallData.length > 0) {
      response.toolCalls = toolCallData.map((tc: Record<string, unknown>) => ({
        id: (tc.id as string) || crypto.randomUUID(),
        name: ((tc.function as Record<string, string>)?.name) || '',
        arguments: JSON.parse(((tc.function as Record<string, string>)?.arguments) || '{}'),
      }));
    }

    return response;
  }

  async *chatStream(messages: Message[], options: ChatOptions): AsyncIterable<ChatChunk> {
    const model = options.model || this.model;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => this.convertMessage(m)),
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = this.convertTools(options.tools);
      body.tool_choice = options.toolChoice || 'auto';
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ollama' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama stream error (${res.status}): ${err}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const activeToolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;

          if (!delta) {
            if (json.usage) {
              yield {
                usage: {
                  prompt: json.usage.prompt_tokens || 0,
                  completion: json.usage.completion_tokens || 0,
                  total: json.usage.total_tokens || 0,
                },
              };
            }
            continue;
          }

          // Text content
          if (delta.content) {
            yield { contentDelta: delta.content };
          }

          // Tool calls in streaming — accumulate and emit as toolCallDelta
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index as number;
              if (!activeToolCalls.has(idx)) {
                activeToolCalls.set(idx, {
                  id: tc.id || crypto.randomUUID(),
                  name: tc.function?.name || '',
                  args: tc.function?.arguments || '',
                });
              }

              const existing = activeToolCalls.get(idx)!;
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;

              // Emit partial tool call delta
              yield {
                toolCallDelta: {
                  id: existing.id,
                  name: existing.name,
                  arguments: tc.function?.arguments ? {} : undefined, // partial
                },
              };
            }
          }

          // On finish, emit final tool calls
          const finish = json.choices?.[0]?.finish_reason;
          if (finish && activeToolCalls.size > 0) {
            for (const tc of activeToolCalls.values()) {
              try {
                yield {
                  toolCallDelta: {
                    id: tc.id,
                    name: tc.name,
                    arguments: JSON.parse(tc.args || '{}'),
                  },
                };
              } catch {
                // Skip incomplete
              }
            }
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private makeModelInfo(id: string, displayName: string, contextWindow: number): ModelInfo {
    return {
      id,
      providerId: PROVIDER_IDS.OLLAMA,
      displayName,
      contextWindow,
      maxOutputTokens: 4096,
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsVision: false,
      pricing: { inputPer1k: 0, outputPer1k: 0 },
    };
  }

  private convertMessage(m: Message): Record<string, unknown> {
    const msg: Record<string, unknown> = {
      role: m.role === 'tool' ? 'tool' : m.role,
      content: m.content || '',
    };

    if (m.role === 'tool' && m.toolCallId) {
      msg.tool_call_id = m.toolCallId;
    }

    if (m.toolCalls && m.toolCalls.length > 0) {
      msg.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }

    return msg;
  }

  private convertTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  private mapFinishReason(reason?: string): ChatResponse['finishReason'] {
    switch (reason) {
      case 'tool_calls': return 'tool_calls';
      case 'length': return 'length';
      case 'stop': return 'stop';
      default: return 'stop';
    }
  }
}