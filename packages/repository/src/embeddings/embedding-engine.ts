/**
 * Embedding Engine — orchestrates chunking, embedding, and search.
 * Activated when user toggles embedding mode to 'local' or 'cloud' in settings.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IEmbeddingProvider, SearchResult } from './embedder-interface.js';
import { chunkFile } from './chunker.js';
import { LocalEmbedder } from './local-embedder.js';
import { CloudEmbedder } from './cloud-embedder.js';

interface IndexedChunk {
  filePath: string;
  chunk: string;
  startLine: number;
  vector: Float32Array;
}

export class EmbeddingEngine {
  private embedder: IEmbeddingProvider | null = null;
  private index: IndexedChunk[] = [];
  private indexed = false;
  private indexing = false;
  private mode: 'off' | 'local' | 'cloud' = 'off';

  getMode(): 'off' | 'local' | 'cloud' { return this.mode; }

  async setMode(mode: 'off' | 'local' | 'cloud', apiKey?: string): Promise<void> {
    this.mode = mode;
    if (mode === 'off') {
      this.embedder = null;
      this.index = [];
      this.indexed = false;
      return;
    }
    if (mode === 'local') {
      this.embedder = new LocalEmbedder();
    } else {
      const cloud = new CloudEmbedder();
      if (apiKey) cloud.setApiKey(apiKey);
      this.embedder = cloud;
    }
    this.indexed = false;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.embedder) return false;
    return this.embedder.isAvailable();
  }

  async indexWorkspace(rootPath: string, onProgress?: (pct: number) => void): Promise<number> {
    if (!this.embedder || this.mode === 'off') return 0;
    if (this.indexing) return this.index.length;

    this.indexing = true;
    this.index = [];

    const files = this.collectFiles(rootPath);
    const allChunks: { filePath: string; chunk: string; startLine: number }[] = [];

    // Phase 1: Chunk all files
    for (const file of files) {
      try {
        const result = chunkFile(file);
        for (let i = 0; i < result.chunks.length; i++) {
          allChunks.push({
            filePath: result.filePath,
            chunk: result.chunks[i],
            startLine: result.startLines[i],
          });
        }
      } catch { /* skip unreadable files */ }
    }

    if (allChunks.length === 0) { this.indexing = false; return 0; }

    // Phase 2: Embed in batches
    const batchSize = 32;
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize);
      const texts = batch.map(c => c.chunk);
      const vectors = await this.embedder.embed(texts);

      for (let j = 0; j < batch.length; j++) {
        this.index.push({
          filePath: batch[j].filePath,
          chunk: batch[j].chunk,
          startLine: batch[j].startLine,
          vector: vectors[j],
        });
      }

      if (onProgress) {
        onProgress(Math.round(((i + batch.length) / allChunks.length) * 100));
      }
    }

    this.indexed = true;
    this.indexing = false;
    return this.index.length;
  }

  async search(query: string, topK: number = 10): Promise<SearchResult[]> {
    if (!this.embedder || !this.indexed || this.index.length === 0) return [];

    const [queryVector] = await this.embedder.embed([query]);

    // Cosine similarity search
    const scored = this.index.map((chunk, idx) => ({
      idx,
      score: this.cosineSimilarity(queryVector, chunk.vector),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => ({
      filePath: this.index[s.idx].filePath,
      chunk: this.index[s.idx].chunk,
      startLine: this.index[s.idx].startLine,
      score: s.score,
    }));
  }

  getIndexSize(): number { return this.index.length; }
  isIndexed(): boolean { return this.indexed; }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
  }

  private collectFiles(rootPath: string): string[] {
    const files: string[] = [];
    const ignore = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '__pycache__', '.venv', '.lambda128']);
    const walk = (dir: string) => {
      try {
        const { readdirSync } = require('node:fs');
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || ignore.has(entry.name)) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile() && /\.(ts|tsx|js|jsx|py|rs|go|java|kt|swift|c|cpp|h|vue|svelte)$/.test(entry.name)) {
            files.push(full);
          }
        }
      } catch { /* skip */ }
    };
    walk(rootPath);
    return files.slice(0, 500); // Cap at 500 files for performance
  }
}