import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface WorkspaceIndex {
  projectName: string;
  rootPath: string;
  languages: string[];
  frameworks: string[];
  fileCount: number;
  tree: string;
  indexedAt: number;
  gitBranch?: string;
  gitHeadCommit?: string;
}

/**
 * File-based JSON cache for workspace indexing.
 * Stored at ~/.lambda128/workspace-cache/{hash}/index.json
 * Invalidated on git HEAD change or manual re-index.
 */
export class WorkspaceIndexCache {
  private cacheDir: string;

  constructor(storageDir: string) {
    this.cacheDir = path.join(storageDir, '.lambda128', 'workspace-cache');
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  private getWorkspaceHash(workspacePath: string): string {
    return createHash('sha256').update(workspacePath).digest('hex').substring(0, 16);
  }

  private getCachePath(workspacePath: string): string {
    const hash = this.getWorkspaceHash(workspacePath);
    const dir = path.join(this.cacheDir, hash);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'index.json');
  }

  /**
   * Load cached workspace index if it exists and is still valid.
   */
  load(workspacePath: string): WorkspaceIndex | null {
    const cachePath = this.getCachePath(workspacePath);
    try {
      if (!fs.existsSync(cachePath)) return null;
      const raw = fs.readFileSync(cachePath, 'utf-8');
      const index: WorkspaceIndex = JSON.parse(raw);

      // Check if cache is stale (older than 24 hours)
      const age = Date.now() - index.indexedAt;
      if (age > 24 * 60 * 60 * 1000) return null;

      return index;
    } catch {
      return null;
    }
  }

  /**
   * Save workspace index to cache.
   */
  save(workspacePath: string, index: WorkspaceIndex): void {
    const cachePath = this.getCachePath(workspacePath);
    fs.writeFileSync(cachePath, JSON.stringify(index, null, 2), 'utf-8');
  }

  /**
   * Invalidate cache for a workspace.
   */
  invalidate(workspacePath: string): void {
    const cachePath = this.getCachePath(workspacePath);
    try { fs.unlinkSync(cachePath); } catch { /* ignore */ }
  }

  /**
   * Check if cache is valid by comparing git HEAD.
   */
  isCacheValid(workspacePath: string, currentGitHead?: string): boolean {
    const cached = this.load(workspacePath);
    if (!cached) return false;
    if (currentGitHead && cached.gitHeadCommit !== currentGitHead) return false;
    return true;
  }
}

/**
 * Fast workspace scanner that respects .gitignore.
 */
export class WorkspaceScanner {
  private ignorePatterns: string[] = [
    'node_modules', '.git', 'dist', 'build', 'out',
    '.next', '.nuxt', '__pycache__', '.venv', 'venv',
    '.cache', '.DS_Store', '*.min.js', '*.min.css',
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    '.lambda128',
  ];

  /**
   * Scan a workspace and return a list of relevant file paths.
   */
  async scan(rootPath: string, maxFiles: number = 5000): Promise<string[]> {
    const files: string[] = [];
    await this.walk(rootPath, rootPath, files, maxFiles);
    return files;
  }

  /**
   * Generate a project tree string (depth-limited).
   */
  async generateTree(rootPath: string, maxDepth: number = 3): Promise<string> {
    const lines: string[] = [path.basename(rootPath) + '/'];
    await this.walkTree(rootPath, rootPath, lines, '', 0, maxDepth);
    return lines.join('\n');
  }

  /**
   * Detect languages used in the project.
   */
  detectLanguages(files: string[]): string[] {
    const extensions = new Set<string>();
    const langMap: Record<string, string> = {
      '.ts': 'TypeScript', '.tsx': 'TypeScript React',
      '.js': 'JavaScript', '.jsx': 'JavaScript React',
      '.py': 'Python', '.rs': 'Rust', '.go': 'Go',
      '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift',
      '.c': 'C', '.cpp': 'C++', '.h': 'C/C++ Header',
      '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML',
      '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
      '.md': 'Markdown', '.sql': 'SQL', '.sh': 'Shell',
      '.vue': 'Vue', '.svelte': 'Svelte',
    };

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (ext && langMap[ext]) {
        extensions.add(langMap[ext]);
      }
    }

    return Array.from(extensions).sort();
  }

  /**
   * Detect frameworks from config files.
   */
  detectFrameworks(files: string[]): string[] {
    const frameworks: string[] = [];
    const fileSet = new Set(files.map(f => path.basename(f)));

    if (fileSet.has('package.json')) frameworks.push('Node.js');
    if (fileSet.has('next.config.js') || fileSet.has('next.config.ts')) frameworks.push('Next.js');
    if (fileSet.has('vite.config.ts') || fileSet.has('vite.config.js')) frameworks.push('Vite');
    if (fileSet.has('tailwind.config.js') || fileSet.has('tailwind.config.ts')) frameworks.push('Tailwind CSS');
    if (fileSet.has('tsconfig.json')) frameworks.push('TypeScript');
    if (fileSet.has('Dockerfile')) frameworks.push('Docker');
    if (fileSet.has('requirements.txt') || fileSet.has('pyproject.toml')) frameworks.push('Python');
    if (fileSet.has('Cargo.toml')) frameworks.push('Rust');
    if (fileSet.has('go.mod')) frameworks.push('Go');

    return frameworks;
  }

  private async walk(
    rootPath: string,
    currentPath: string,
    files: string[],
    maxFiles: number
  ): Promise<void> {
    if (files.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (this.shouldIgnore(entry.name)) continue;

      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await this.walk(rootPath, fullPath, files, maxFiles);
      } else if (entry.isFile()) {
        files.push(path.relative(rootPath, fullPath));
      }
    }
  }

  private async walkTree(
    rootPath: string,
    currentPath: string,
    lines: string[],
    prefix: string,
    depth: number,
    maxDepth: number
  ): Promise<void> {
    if (depth >= maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const filtered = entries.filter(e => !this.shouldIgnore(e.name));
    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      const isLast = i === filtered.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');

      if (entry.isDirectory()) {
        lines.push(`${prefix}${connector}${entry.name}/`);
        await this.walkTree(rootPath, path.join(currentPath, entry.name), lines, childPrefix, depth + 1, maxDepth);
      } else {
        lines.push(`${prefix}${connector}${entry.name}`);
      }
    }
  }

  private shouldIgnore(name: string): boolean {
    if (name.startsWith('.')) return true;
    return this.ignorePatterns.includes(name);
  }
}

export { buildRepoMap, formatRepoMapForLLM } from './repo-map.js';
export type { RepoMap, RepoMapEntry, RepoSymbol, RepoMapOptions } from './repo-map.js';

// Embeddings
export { EmbeddingEngine } from './embeddings/embedding-engine.js';
export { LocalEmbedder } from './embeddings/local-embedder.js';
export { CloudEmbedder } from './embeddings/cloud-embedder.js';
export { chunkFile } from './embeddings/chunker.js';
export type { IEmbeddingProvider, ChunkResult, SearchResult } from './embeddings/embedder-interface.js';
