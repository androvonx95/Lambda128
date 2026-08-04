import type { AIProvider, Message, ChatOptions, ChatResponse, ChatChunk, ModelInfo, RateLimitInfo, ToolDefinition } from '@lambda128/shared';
import { PROVIDER_IDS } from '@lambda128/shared';

const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro', providerId: PROVIDER_IDS.GEMINI, displayName: 'Gemini 2.5 Pro', contextWindow: 1_048_576, maxOutputTokens: 65_536, supportsStreaming: true, supportsToolCalling: true, supportsVision: true, pricing: { inputPer1k: 0.00125, outputPer1k: 0.01 } },
  { id: 'gemini-2.5-flash', providerId: PROVIDER_IDS.GEMINI, displayName: 'Gemini 2.5 Flash', contextWindow: 1_048_576, maxOutputTokens: 8_192, supportsStreaming: true, supportsToolCalling: true, supportsVision: true, pricing: { inputPer1k: 0.00015, outputPer1k: 0.0006 } },
];

interface GeminiContent { role: 'user' | 'model' | 'tool'; parts: GeminiPart[]; }
interface GeminiPart { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: { output: string } }; }

export class GeminiProvider implements AIProvider {
  readonly id = PROVIDER_IDS.GEMINI;
  readonly name = 'Google Gemini';
  readonly supportsStreaming = true;
  readonly supportsToolCalling = true;
  readonly defaultModels = DEFAULT_MODELS;
  private apiKey: string | null = null;

  setApiKey(key: string) { this.apiKey = key; }

  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const { systemInstruction, contents, tools } = this.formatMessages(messages, options.tools);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${this.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_instruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined, contents, tools, generationConfig: { maxOutputTokens: options.maxTokens || 4096, temperature: options.temperature } }),
    });
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    return this.parseResponse(await res.json());
  }

  async *chatStream(messages: Message[], options: ChatOptions): AsyncIterable<ChatChunk> {
    const { systemInstruction, contents, tools } = this.formatMessages(messages, options.tools);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${options.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_instruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined, contents, tools, generationConfig: { maxOutputTokens: options.maxTokens || 4096, temperature: options.temperature } }),
    });
    if (!res.ok) throw new Error(`Gemini error ${res.status}`);
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const d = JSON.parse(line.slice(6));
        const part = d.candidates?.[0]?.content?.parts?.[0];
        if (part?.text) yield { contentDelta: part.text };
      } catch { /* skip malformed SSE chunks */ }
    }
  }

  async listModels(): Promise<ModelInfo[]> { return DEFAULT_MODELS; }
  async getModelInfo(id: string): Promise<ModelInfo> { const m = DEFAULT_MODELS.find(x => x.id === id); if (!m) throw new Error(`Unknown: ${id}`); return m; }
  async validateApiKey(key: string): Promise<boolean> { try { const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`); return r.ok; } catch { return false; } }
  async checkRateLimit(): Promise<RateLimitInfo> { return { remaining: 100, limit: 100, resetAt: Date.now() + 60_000 }; }

  private formatMessages(messages: Message[], tools?: ToolDefinition[]) {
    let systemInstruction = '';
    const contents: GeminiContent[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') { systemInstruction += (systemInstruction ? '\n' : '') + msg.content; continue; }
      const parts: GeminiPart[] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) parts.push({ functionCall: { name: tc.name, args: tc.arguments as Record<string, unknown> } });
      }
      if (msg.role === 'tool') {
        parts.push({ functionResponse: { name: msg.toolCallId || 'tool', response: { output: msg.content } } });
      }
      const role = msg.role === 'assistant' ? 'model' : msg.role === 'tool' ? 'tool' : 'user';
      contents.push({ role, parts });
    }
    const geminiTools = tools?.map(t => ({ functionDeclarations: [{ name: t.name, description: t.description, parameters: t.parameters }] }));
    return { systemInstruction, contents, tools: geminiTools };
  }

  private parseResponse(data: any): ChatResponse {
    const c = data.candidates?.[0];
    const parts = c?.content?.parts || [];
    let text = '';
    const toolCalls: ChatResponse['toolCalls'] = [];
    for (const p of parts) { if (p.text) text += p.text; if (p.functionCall) toolCalls.push({ id: p.functionCall.name + Date.now(), name: p.functionCall.name, arguments: p.functionCall.args }); }
    return { id: data.candidates?.[0]?.finishReason || 'stop', content: text, toolCalls: toolCalls.length ? toolCalls : undefined, usage: { prompt: data.usageMetadata?.promptTokenCount || 0, completion: data.usageMetadata?.candidatesTokenCount || 0, total: (data.usageMetadata?.totalTokenCount || 0) }, finishReason: c?.finishReason === 'STOP' ? 'stop' : 'tool_calls' };
  }
}