import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, Message, ChatOptions, ChatResponse, ChatChunk, ModelInfo, RateLimitInfo, ToolDefinition } from '@lambda128/shared';
import { PROVIDER_IDS } from '@lambda128/shared';

const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-20250514',
    providerId: PROVIDER_IDS.ANTHROPIC,
    displayName: 'Claude Sonnet 4',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsVision: true,
    pricing: { inputPer1k: 0.003, outputPer1k: 0.015 },
  },
  {
    id: 'claude-3-5-haiku-20241022',
    providerId: PROVIDER_IDS.ANTHROPIC,
    displayName: 'Claude 3.5 Haiku',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsVision: false,
    pricing: { inputPer1k: 0.0008, outputPer1k: 0.004 },
  },
];

export class AnthropicProvider implements AIProvider {
  readonly id = PROVIDER_IDS.ANTHROPIC;
  readonly name = 'Anthropic';
  readonly supportsStreaming = true;
  readonly supportsToolCalling = true;
  readonly defaultModels = DEFAULT_MODELS;

  private client: Anthropic | null = null;
  private apiKey: string | null = null;

  constructor(apiKey?: string) {
    if (apiKey) {
      this.setApiKey(apiKey);
    }
  }

  setApiKey(key: string): void {
    this.apiKey = key;
    this.client = new Anthropic({ apiKey: key });
  }

  private ensureClient(): Anthropic {
    if (!this.client) {
      throw new Error('Anthropic client not initialized. Call setApiKey() first.');
    }
    return this.client;
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const client = this.ensureClient();
    const { systemPrompt, conversationMessages } = this.formatMessages(messages);

    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens || 4096,
      system: systemPrompt,
      messages: conversationMessages,
      tools: options.tools ? this.convertTools(options.tools) : undefined,
      temperature: options.temperature,
    });

    return this.parseResponse(response);
  }

  async *chatStream(messages: Message[], options: ChatOptions): AsyncIterable<ChatChunk> {
    const client = this.ensureClient();
    const { systemPrompt, conversationMessages } = this.formatMessages(messages);

    const stream = client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens || 4096,
      system: systemPrompt,
      messages: conversationMessages,
      tools: options.tools ? this.convertTools(options.tools) : undefined,
      temperature: options.temperature,
    });

    let currentToolUse: { id?: string; name?: string; arguments?: string } = {};

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { contentDelta: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          currentToolUse.arguments = (currentToolUse.arguments || '') + event.delta.partial_json;
          yield {
            toolCallDelta: {
              id: currentToolUse.id,
              name: currentToolUse.name,
              arguments: currentToolUse.arguments as unknown as Record<string, unknown>,
            },
          };
        }
      } else if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            arguments: '',
          };
        }
      } else if (event.type === 'message_delta') {
        yield {
          usage: {
            completion: event.usage?.output_tokens || 0,
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
      const tempClient = new Anthropic({ apiKey: key });
      await tempClient.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  async checkRateLimit(): Promise<RateLimitInfo> {
    // Anthropic doesn't expose rate limits via API; return optimistic
    return { remaining: 100, limit: 100, resetAt: Date.now() + 60_000 };
  }

  private formatMessages(messages: Message[]): {
    systemPrompt: string;
    conversationMessages: Anthropic.MessageParam[];
  } {
    let systemPrompt = '';
    const conversationMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
      } else if (msg.role === 'user') {
        conversationMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const content: Anthropic.ContentBlock[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content } as Anthropic.TextBlock);
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments as Record<string, unknown>,
            } as Anthropic.ToolUseBlock);
          }
        }
        conversationMessages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        conversationMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId || '',
            content: msg.content,
          }],
        });
      }
    }

    return { systemPrompt, conversationMessages };
  }

  private parseResponse(response: Anthropic.Message): ChatResponse {
    let textContent = '';
    const toolCalls: ChatResponse['toolCalls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      id: response.id,
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        prompt: response.usage?.input_tokens || 0,
        completion: response.usage?.output_tokens || 0,
        total: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      },
      finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    };
  }

  private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: t.parameters.properties as Record<string, unknown>,
        required: t.parameters.required,
      },
    }));
  }
}