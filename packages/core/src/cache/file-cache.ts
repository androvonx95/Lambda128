import type { ToolResult } from '@lambda128/shared';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory cache with TTL for file contents, search results, and directory listings.
 * Invalidated by file watcher events or TTL expiration.
 */
export class FileCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private defaultTTL: number;

  constructor(defaultTTLMs: number = 300_000) {
    this.defaultTTL = defaultTTLMs;
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTTL),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate all entries matching a prefix (e.g., all cached files in a directory).
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate all entries for a specific file path.
   */
  invalidateFile(filePath: string): void {
    const readKey = `file:${filePath}`;
    const searchKey = `search:${filePath}`;
    this.cache.delete(readKey);
    this.cache.delete(searchKey);
  }

  /**
   * Cache a file read result.
   */
  cacheFileRead(filePath: string, result: ToolResult): void {
    this.set(`file:${filePath}`, result, 300_000); // 5 min TTL — files rarely change mid-conversation
  }

  /**
   * Get a cached file read result.
   */
  getCachedFileRead(filePath: string): ToolResult | undefined {
    return this.get<ToolResult>(`file:${filePath}`);
  }

  /**
   * Cache a directory listing.
   */
  cacheDirList(dirPath: string, result: ToolResult): void {
    this.set(`dir:${dirPath}`, result, 120_000); // 2 min TTL
  }

  getCachedDirList(dirPath: string): ToolResult | undefined {
    return this.get<ToolResult>(`dir:${dirPath}`);
  }

  /**
   * Cache a search result.
   */
  cacheSearch(query: string, result: ToolResult): void {
    this.set(`search:${query}`, result, 60_000); // 1 min TTL — searches stale faster than file reads
  }

  getCachedSearch(query: string): ToolResult | undefined {
    return this.get<ToolResult>(`search:${query}`);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}