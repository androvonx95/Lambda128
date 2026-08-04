/**
 * Code Chunker — splits source files into semantic chunks for embedding.
 * Uses AST-aware boundaries (function/class definitions) when possible,
 * falls back to line-based chunking with overlap.
 */
import { readFileSync } from 'node:fs';
import type { ChunkResult } from './embedder-interface.js';

const MAX_CHUNK_LINES = 60;
const OVERLAP_LINES = 10;

export function chunkFile(filePath: string, content?: string): ChunkResult {
  const text = content || readFileSync(filePath, 'utf-8');
  const lines = text.split('\n');
  const chunks: string[] = [];
  const startLines: number[] = [];

  // Find function/class boundaries for smarter chunking
  const boundaries = findBoundaries(lines);

  if (boundaries.length > 1) {
    // AST-aware chunking: split at function/class boundaries
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i];
      const end = i + 1 < boundaries.length ? boundaries[i + 1] : lines.length;
      const chunkLines = lines.slice(start, Math.min(end, start + MAX_CHUNK_LINES));
      if (chunkLines.length > 0) {
        chunks.push(chunkLines.join('\n'));
        startLines.push(start + 1); // 1-based
      }
    }
  } else {
    // Fallback: fixed-size sliding window
    for (let i = 0; i < lines.length; i += MAX_CHUNK_LINES - OVERLAP_LINES) {
      const chunkLines = lines.slice(i, i + MAX_CHUNK_LINES);
      if (chunkLines.length > 0) {
        chunks.push(chunkLines.join('\n'));
        startLines.push(i + 1);
      }
    }
  }

  return { filePath, chunks, startLines };
}

function findBoundaries(lines: string[]): number[] {
  const boundaries: number[] = [0]; // Always start at line 0
  const patterns = [
    /^(export\s+)?(async\s+)?function\s+\w+/,
    /^(export\s+)?class\s+\w+/,
    /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/,
    /^(export\s+)?interface\s+\w+/,
    /^(export\s+)?type\s+\w+/,
    /^(export\s+)?enum\s+\w+/,
    /^\/\*\*/, // JSDoc comment start
    /^import\s/,
    /^export\s/,
  ];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        boundaries.push(i);
        break;
      }
    }
  }

  return boundaries;
}