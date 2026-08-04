/**
 * Core AI provider types.
 * These interfaces define the contract between the application and any AI provider.
 */

/** A message in a conversation */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  tokenUsage?: TokenUsage;
  createdAt: number;
}

/** A tool call requested by the AI model */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Token usage for a single API call */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/** Options for a chat completion request */
export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  stopSequences?: string[];
}

/** A tool definition sent to the LLM for function calling */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

/** A single parameter in a tool definition */
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: { type: string };
}

/** Response from a chat completion */
export interface ChatResponse {
  id: string;
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

/** A chunk of a streaming response */
export interface ChatChunk {
  contentDelta?: string;
  toolCallDelta?: Partial<ToolCall>;
  usage?: Partial<TokenUsage>;
}

/** Information about an AI model */
export interface ModelInfo {
  id: string;
  providerId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  supportsVision: boolean;
  pricing: {
    inputPer1k: number;
    outputPer1k: number;
  };
}

/** Rate limit information from a provider */
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: number;
}

/** Standardized AI error */
export interface AIError {
  code: string;
  message: string;
  status?: number;
  retryable: boolean;
  providerId: string;
}

/**
 * The core AI provider interface.
 * Every provider (OpenAI, Anthropic, Gemini, OpenRouter) implements this.
 */
export interface AIProvider {
  readonly id: string;
  readonly name: string;
  readonly supportsStreaming: boolean;
  readonly supportsToolCalling: boolean;
  readonly defaultModels: ModelInfo[];

  chat(messages: Message[], options: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: Message[], options: ChatOptions): AsyncIterable<ChatChunk>;
  listModels(): Promise<ModelInfo[]>;
  getModelInfo(modelId: string): Promise<ModelInfo>;
  validateApiKey(key: string): Promise<boolean>;
  checkRateLimit(): Promise<RateLimitInfo>;
}