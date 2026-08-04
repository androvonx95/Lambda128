import OpenAI from 'openai';
import type { AIProvider, Message, ChatOptions, ChatResponse, ChatChunk, ModelInfo, RateLimitInfo, ToolDefinition } from '@lambda128/shared';
import { PROVIDER_IDS } from '@lambda128/shared';

const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o',
    providerId: PROVIDER_IDS.OPENAI,
    displayName: 'GPT-4o',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsVision: true,
    pricing: { inputPer1k: 0.0025, outputPer1k: 0.01 },
  },
  {
    id: 'gpt-4o-mini',
    providerId: PROVIDER_IDS.OPENAI,
    displayName: 'GPT-4o Mini',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsVision: true,
    pricing: { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  },
];

export class OpenAIProvider implements AIProvider {
  readonly id = PROVIDER_IDS.OPENAI;
  readonly name = 'OpenAI';
  readonly supportsStreaming = true;
  readonly supportsToolCalling = true;
  readonly defaultModels = DEFAULT_MODELS;

  private client: OpenAI | null = null;

  constructor(apiKey?: string) {
    if (apiKey) {
      this.setApiKey(apiKey);
    }
  }

  setApiKey(key: string): void {
    this.client = new OpenAI({ apiKey: key });
  }

  private ensureClient(): OpenAI {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Call setApiKey() first.');
    }
    return this.client;
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const client = this.ensureClient();

    const response = await client.chat.completions.create({
      model: options.model,
      messages: this.formatMessages(messages),
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      tools: options.tools ? this.convertTools(options.tools) : undefined,
      tool_choice: options.toolChoice,
    });

    return this.parseResponse(response);
  }

  async *chatStream(messages: Message[], options: ChatOptions): AsyncIterable<ChatChunk> {
    const client = this.ensureClient();

    const stream = await client.chat.completions.create({
      model: options.model,
      messages: this.formatMessages(messages),
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      tools: options.tools ? this.convertTools(options.tools) : undefined,
      tool_choice: options.toolChoice,
      stream: true,
    });

    let currentToolCall: { id?: string; name?: string; arguments?: string } = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        yield { contentDelta: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) currentToolCall.id = tc.id;
          if (tc.function?.name) currentToolCall.name = tc.function.name;
          if (tc.function?.arguments) {
            currentToolCall.arguments = (currentToolCall.arguments || '') + tc.function.arguments;
          }
          yield {
            toolCallDelta: {
              id: currentToolCall.id,
              name: currentToolCall.name,
              arguments: currentToolCall.arguments as unknown as Record<string, unknown>,
            },
          };
        }
      }

      if (chunk.usage) {
        yield {
          usage: {
            prompt: chunk.usage.prompt_tokens,
            completion: chunk.usage.completion_tokens,
            total: chunk.usage.total_tokens,
          },
        };
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return DEFAULT_MODELS;
  }

  async getModelInfo(modelId: string): Promise<ModelInfo> {
    const model = DEFAULT_MODELS.find(m => m.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    return model;
  }

  async validateApiKey(key: string): Promise<boolean> {
    try {
      const tempClient = new OpenAI({ apiKey: key });
      await tempClient.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async checkRateLimit(): Promise<RateLimitInfo> {
    return { remaining: 100, limit: 100, resetAt: Date.now() + 60_000 };
  }

  private formatMessages(messages: Message[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return messages.map(msg => {
      if (msg.role === 'system') {
        return { role: 'system', content: msg.content };
      }
      if (msg.role === 'user') {
        return { role: 'user', content: msg.content };
      }
      if (msg.role === 'assistant') {
        const result: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: msg.content || null,
        };
        if (msg.toolCalls) {
          result.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        return result;
      }
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.toolCallId || '',
          content: msg.content,
        };
      }
      return { role: 'user', content: msg.content };
    });
  }

  private parseResponse(response: OpenAI.Chat.Completions.ChatCompletion): ChatResponse {
    const choice = response.choices[0];
    const message = choice?.message;

    const toolCalls = message?.tool_calls?.map(tc => {
      if ('function' in tc && tc.function) {
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        };
      }
      return {
        id: tc.id,
        name: 'unknown',
        arguments: {} as Record<string, unknown>,
      };
    });

    return {
      id: response.id,
      content: message?.content || '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        prompt: response.usage?.prompt_tokens || 0,
        completion: response.usage?.completion_tokens || 0,
        total: response.usage?.total_tokens || 0,
      },
      finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_calls'
        : choice?.finish_reason === 'stop' ? 'stop'
        : choice?.finish_reason === 'length' ? 'length'
        : 'error',
    };
  }

  private convertTools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object' as const,
          properties: t.parameters.properties as Record<string, unknown>,
          required: t.parameters.required,
        },
      },
    }));
  }
}