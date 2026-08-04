/**
 * Embedding Provider Interface — common contract for local and cloud embedders.
 */
export interface IEmbeddingProvider {
  readonly id: string;
  readonly modelName: string;
  readonly dimensions: number;
  readonly source: 'local' | 'cloud';

  /** Convert texts to vectors */
  embed(texts: string[]): Promise<Float32Array[]>;

  /** Check if the provider is available (model downloaded, API key set, etc.) */
  isAvailable(): Promise<boolean>;

  /** Estimate cost/time for a given number of texts */
  estimateCost(textCount: number): { dollars: number; timeSeconds: number };
}

export interface ChunkResult {
  filePath: string;
  chunks: string[];
  startLines: number[];
}

export interface SearchResult {
  filePath: string;
  chunk: string;
  startLine: number;
  score: number;
}