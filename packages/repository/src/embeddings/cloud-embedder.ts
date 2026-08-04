/**
 * Cloud Embedder — uses OpenAI's embeddings API.
 * Requires an OpenAI API key (stored in SecretStorage).
 */
import type { IEmbeddingProvider } from './embedder-interface.js';

export class CloudEmbedder implements IEmbeddingProvider {
  readonly id = 'cloud-openai';
  readonly modelName: string;
  readonly dimensions: number;
  readonly source = 'cloud' as const;
  private apiKey: string | null = null;

  constructor(modelName: string = 'text-embedding-3-small') {
    this.modelName = modelName;
    this.dimensions = modelName.includes('large') ? 3072 : 1536;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.apiKey) throw new Error('OpenAI API key not set for cloud embeddings');

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        input: texts,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embeddings API error: ${response.status} ${err}`);
    }

    const data = await response.json() as any;
    return data.data.map((item: any) => new Float32Array(item.embedding));
  }

  estimateCost(textCount: number): { dollars: number; timeSeconds: number } {
    // text-embedding-3-small: $0.02 per 1M tokens, ~500 tokens per chunk
    const tokensPerChunk = 500;
    const totalTokens = textCount * tokensPerChunk;
    const dollars = (totalTokens / 1_000_000) * 0.02;
    return {
      dollars: Math.round(dollars * 10000) / 10000,
      timeSeconds: Math.round(textCount * 0.02), // ~20ms per text (network)
    };
  }
}