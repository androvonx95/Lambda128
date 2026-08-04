/**
 * AWS Bedrock Provider — Claude and other models via AWS Bedrock API.
 * Uses the Bedrock Converse API (streaming + tool calling supported).
 * 
 * Authentication: AWS credentials via environment variables, ~/.aws/credentials, or IAM role.
 * No separate API key needed — uses AWS SDK credential chain.
 */
import type { AIProvider, ChatOptions, ChatResponse, ChatChunk, ModelInfo, Message, TokenUsage } from '@lambda128/shared';

function mkModel(id: string, dn: string, ctx: number, maxOut = 8192): ModelInfo {
  return { id, providerId: 'bedrock', displayName: dn, contextWindow: ctx, maxOutputTokens: maxOut, supportsStreaming: true, supportsToolCalling: true, supportsVision: false, pricing: { inputPer1k: 0.003, outputPer1k: 0.015 } };
}

export class BedrockProvider implements AIProvider {
  readonly id = 'bedrock';
  readonly name = 'AWS Bedrock';
  readonly supportsStreaming = true;
  readonly supportsToolCalling = true;
  readonly defaultModels: ModelInfo[] = [
    mkModel('us.anthropic.claude-sonnet-4-20250514-v1:0', 'Claude Sonnet 4', 200000),
    mkModel('us.anthropic.claude-opus-4-20250514-v1:0', 'Claude Opus 4', 200000),
    mkModel('us.anthropic.claude-haiku-3-5-v1:0', 'Claude Haiku 3.5', 200000),
    mkModel('us.meta.llama4-maverick-17b-instruct-v1:0', 'Llama 4 Maverick', 128000, 4096),
    mkModel('amazon.nova-pro-v1:0', 'Amazon Nova Pro', 300000, 5120),
  ];

  private region: string;
  private accessKeyId?: string;
  private secretAccessKey?: string;
  private sessionToken?: string;

  constructor(region: string = 'us-east-1') {
    this.region = region;
  }

  setCredentials(accessKeyId: string, secretAccessKey: string, sessionToken?: string): void {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
  }

  setRegion(region: string): void {
    this.region = region;
  }

  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const body = this.buildRequestBody(messages, options);
    const data = await this.invokeModel(options.model, body) as Record<string, any>;
    return this.parseConverseResponse(data, options);
  }

  async *chatStream(messages: Message[], options: ChatOptions): AsyncIterable<ChatChunk> {
    const body = this.buildRequestBody(messages, options);
    const stream = await this.invokeModelStream(options.model, body);

    for await (const event of stream) {
      if (event.contentBlockDelta?.delta?.text) {
        yield { contentDelta: event.contentBlockDelta.delta.text };
      }
      if (event.contentBlockStart?.start?.toolUse) {
        const tu = event.contentBlockStart.start.toolUse;
        yield {
          toolCallDelta: {
            id: tu.toolUseId,
            name: tu.name,
            arguments: {},
          },
        };
      }
      if (event.contentBlockDelta?.delta?.toolUse?.input) {
        yield {
          toolCallDelta: {
            id: event.contentBlockDelta.delta.toolUse.toolUseId || '',
            arguments: JSON.parse(event.contentBlockDelta.delta.toolUse.input || '{}'),
          },
        };
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.defaultModels;
  }

  async getModelInfo(modelId: string): Promise<ModelInfo> {
    const found = this.defaultModels.find(m => m.id === modelId);
    return found || mkModel(modelId, modelId, 200000);
  }

  async validateApiKey(): Promise<boolean> {
    // Bedrock uses AWS credentials, not API keys. Check if we can reach the service.
    try {
      const creds = await this.getCredentials();
      return !!creds;
    } catch {
      return false;
    }
  }

  async checkRateLimit(): Promise<{ remaining: number; limit: number; resetAt: number }> {
    return { remaining: 100, limit: 500, resetAt: Date.now() + 60_000 };
  }

  // ---- response parsing ----

  private parseConverseResponse(data: Record<string, any>, _options: ChatOptions): ChatResponse {
    const output = data.output?.message;
    let content = '';
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    for (const block of (output?.content || [])) {
      if (block.text) content += block.text;
      if (block.toolUse) {
        toolCalls.push({ id: block.toolUse.toolUseId, name: block.toolUse.name, arguments: block.toolUse.input || {} });
      }
    }
    const usage: TokenUsage = { prompt: data.usage?.inputTokens || 0, completion: data.usage?.outputTokens || 0, total: (data.usage?.inputTokens || 0) + (data.usage?.outputTokens || 0) };
    return { id: data.$metadata?.requestId || '', content, toolCalls: toolCalls.length ? toolCalls : undefined, usage, finishReason: content && !toolCalls.length ? 'stop' : 'tool_calls' };
  }

  private buildRequestBody(messages: Message[], options: ChatOptions): Record<string, unknown> {
    const systemMessages = messages.filter(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const converseMessages = chatMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ text: m.content }],
    }));

    const toolConfig = options.tools?.length ? {
      tools: options.tools.map(t => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.parameters },
        },
      })),
    } : {};

    return {
      modelId: options.model,
      messages: converseMessages,
      system: systemMessages.map(m => ({ text: m.content })),
      inferenceConfig: {
        maxTokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7,
        stopSequences: options.stopSequences || [],
      },
      ...toolConfig,
    };
  }

  private async invokeModel(modelId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const creds = await this.getCredentials();
    const url = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${modelId}/converse`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getSignedHeaders(creds, url, body),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Bedrock API error ${response.status}: ${err}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private async *invokeModelStream(modelId: string, body: Record<string, unknown>): AsyncIterable<any> {
    const creds = await this.getCredentials();
    const url = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${modelId}/converse-stream`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getSignedHeaders(creds, url, body),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Bedrock stream error ${response.status}: ${err}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            yield JSON.parse(line.slice(6));
          } catch { /* skip malformed chunks */ }
        }
      }
    }
  }

  private async getCredentials(): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }> {
    // Use explicitly set credentials first
    if (this.accessKeyId && this.secretAccessKey) {
      return {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        sessionToken: this.sessionToken,
      };
    }

    // Fall back to environment variables
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      return {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      };
    }

    // Fall back to ~/.aws/credentials (try to read the file)
    try {
      const { readFileSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const credsPath = join(homedir(), '.aws', 'credentials');
      const content = readFileSync(credsPath, 'utf-8');
      const match = content.match(/aws_access_key_id\s*=\s*(\S+)/);
      const secretMatch = content.match(/aws_secret_access_key\s*=\s*(\S+)/);
      const tokenMatch = content.match(/aws_session_token\s*=\s*(\S+)/);
      if (match && secretMatch) {
        return {
          accessKeyId: match[1],
          secretAccessKey: secretMatch[1],
          sessionToken: tokenMatch?.[1],
        };
      }
    } catch { /* no credentials file */ }

    throw new Error(
      'No AWS credentials found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables, ' +
      'or configure ~/.aws/credentials, or call provider.setCredentials().'
    );
  }

  private getSignedHeaders(
    creds: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
    url: string,
    body: Record<string, unknown>
  ): Record<string, string> {
    // AWS Signature V4 signing
    const { createHash, createHmac } = require('node:crypto');
    const urlObj = new URL(url);
    const method = 'POST';
    const service = 'bedrock';
    const region = this.region;
    const host = urlObj.host;
    const contentType = 'application/json';
    const payload = JSON.stringify(body);
    const payloadHash = createHash('sha256').update(payload).digest('hex');

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-date';

    const canonicalRequest = [
      method, urlObj.pathname, urlObj.search || '',
      canonicalHeaders, signedHeaders, payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256', amzDate, credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const kDate = createHmac('sha256', `AWS4${creds.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(region).digest();
    const kService = createHmac('sha256', kRegion).update(service).digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const authHeader = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'X-Amz-Date': amzDate,
      'Authorization': authHeader,
      'Host': host,
    };

    if (creds.sessionToken) {
      headers['X-Amz-Security-Token'] = creds.sessionToken;
    }

    return headers;
  }
}