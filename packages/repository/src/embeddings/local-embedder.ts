/**
 * Local Embedder — uses @xenova/transformers for free, offline embeddings.
 * Model auto-downloads on first use (~80MB for all-MiniLM-L6-v2).
 * Falls back gracefully if the package is not installed.
 */
import type { IEmbeddingProvider } from './embedder-interface.js';

export class LocalEmbedder implements IEmbeddingProvider {
  readonly id = 'local-transformers';
  readonly modelName: string;
  readonly dimensions: number;
  readonly source = 'local' as const;
  private pipeline: any = null;
  private loadError: string | null = null;

  constructor(modelName: string = 'all-MiniLM-L6-v2') {
    this.modelName = modelName;
    this.dimensions = modelName.includes('mpnet') ? 768 : 384;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureLoaded();
      return true;
    } catch {
      return false;
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    await this.ensureLoaded();
    const results: Float32Array[] = [];
    // Process in batches of 32 to avoid memory issues
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32);
      const output = await this.pipeline(batch, { pooling: 'mean', normalize: true });
      for (const tensor of output) {
        results.push(new Float32Array(tensor.data));
      }
    }
    return results;
  }

  estimateCost(textCount: number): { dollars: number; timeSeconds: number } {
    return {
      dollars: 0, // Free!
      timeSeconds: Math.round(textCount * 0.002), // ~2ms per text on CPU
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.pipeline) return;
    if (this.loadError) throw new Error(this.loadError);

    try {
      // Dynamic import — only loads if user enables embeddings
      const { pipeline } = await import('@xenova/transformers');
      this.pipeline = await pipeline('feature-extraction', this.modelName);
    } catch (err: any) {
      this.loadError = `Failed to load local embedding model: ${err.message}. Install @xenova/transformers or switch to cloud mode.`;
      throw new Error(this.loadError);
    }
  }
}