/**
 * Repository Map — ported patterns from Aider's production-grade repomap.py.
 * 
 * Builds a structured representation of the codebase showing:
 * - File tree (depth-limited)
 * - Function/class signatures in each file
 * - Import relationships
 * - Relevance ranking based on:
 *   - Recency of modification
 *   - Proximity to currently open files
 *   - Git status (modified > staged > unchanged)
 * 
 * This gives the LLM a navigable map of the repo without reading every file.
 * 
 * @see Aider: aider/repomap.py
 * @see Aider: RepoMap.get_ranked_tags()
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { execSync } from 'node:child_process';

export interface RepoMapEntry {
  path: string;
  type: 'file' | 'directory';
  size: number;
  lastModified: number;
  language?: string;
  symbols?: RepoSymbol[];
  imports?: string[];
  relevanceScore: number;
}

export interface RepoSymbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable' | 'export';
  line: number;
  signature?: string;
}

export interface RepoMapOptions {
  maxDepth: number;
  maxFiles: number;
  includeSymbols: boolean;
  respectGitignore: boolean;
  rankingWeights: {
    recency: number;
    proximity: number;
    gitModified: number;
  };
}

export interface RepoMap {
  root: string;
  entries: RepoMapEntry[];
  generatedAt: number;
  totalFiles: number;
  languageStats: Record<string, number>;
}

// ============================================================================
// Fast file-type / symbol extraction (no tree-sitter dependency in MVP)
// ============================================================================
const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.rs': 'rust',
  '.go': 'go', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.md': 'markdown', '.css': 'css', '.html': 'html',
  '.sql': 'sql', '.sh': 'shell', '.toml': 'toml',
};

function detectLanguage(filePath: string): string | undefined {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  return LANG_MAP[ext] || undefined;
}

function extractSymbols(filePath: string, content: string): RepoSymbol[] {
  const symbols: RepoSymbol[] = [];
  const lines = content.split('\n');

  // Fast regex-based extraction (no tree-sitter in MVP)
  const patterns: Array<{ regex: RegExp; kind: RepoSymbol['kind'] }> = [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: 'function' },
    { regex: /^(?:export\s+)?class\s+(\w+)/, kind: 'class' },
    { regex: /^(?:export\s+)?interface\s+(\w+)/, kind: 'interface' },
    { regex: /^(?:export\s+)?type\s+(\w+)\s*=/m, kind: 'type' },
    { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)/, kind: 'variable' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const { regex, kind } of patterns) {
      const match = line.match(regex);
      if (match) {
        symbols.push({ name: match[1], kind, line: i + 1, signature: line });
        break;
      }
    }
    // Stop after N symbols per file (performance)
    if (symbols.length >= 50) break;
  }
  return symbols;
}

function extractImports(filePath: string, content: string): string[] {
  const imports: string[] = [];
  const lines = content.split('\n');
  const importRegex = /^(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/;
  const pythonImport = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/;

  for (const line of lines) {
    const tsMatch = line.match(importRegex);
    if (tsMatch) {
      imports.push(tsMatch[1] || tsMatch[2]);
      continue;
    }
    const pyMatch = line.match(pythonImport);
    if (pyMatch) {
      imports.push(pyMatch[1] || pyMatch[2]);
    }
    if (imports.length >= 30) break;
  }
  return imports;
}

function shouldIgnore(name: string): boolean {
  const ignorePatterns = [
    'node_modules', '.git', '.svn', '__pycache__', '.DS_Store',
    'dist', 'build', '.next', '.turbo', 'coverage', '.cache',
    '*.min.js', '*.min.css', '*.map', '*.lock',
  ];
  return ignorePatterns.some(p => {
    if (p.startsWith('*')) return name.endsWith(p.slice(1));
    return name === p;
  });
}

// ============================================================================
// RepoMap Builder
// ============================================================================

export function buildRepoMap(
  root: string,
  openFilePaths: string[] = [],
  options: Partial<RepoMapOptions> = {}
): RepoMap {
  const opts: RepoMapOptions = {
    maxDepth: 3,
    maxFiles: 500,
    includeSymbols: true,
    respectGitignore: true,
    rankingWeights: { recency: 0.3, proximity: 0.5, gitModified: 0.2 },
    ...options,
  };

  const entries: RepoMapEntry[] = [];
  const languageStats: Record<string, number> = {};
  let totalFiles = 0;

  // Get git-modified files for ranking
  let gitModifiedFiles = new Set<string>();
  try {
    const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8', timeout: 3000 });
    for (const line of status.split('\n')) {
      const filePath = line.substring(3).trim();
      if (filePath) gitModifiedFiles.add(filePath);
    }
  } catch { /* not a git repo or git not available */ }

  // Resolve open file paths to relative paths
  const openRelativePaths = new Set(
    openFilePaths.map(p => relative(root, p)).filter(p => !p.startsWith('..'))
  );

  function walk(dir: string, depth: number): void {
    if (depth > opts.maxDepth || entries.length >= opts.maxFiles) return;

    let items: string[];
    try {
      items = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of items) {
      if (shouldIgnore(name)) continue;
      const fullPath = join(dir, name);
      const relPath = relative(root, fullPath);

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        entries.push({
          path: relPath + '/',
          type: 'directory',
          size: 0,
          lastModified: stat.mtimeMs,
          relevanceScore: 0,
        });
        walk(fullPath, depth + 1);
        continue;
      }

      if (stat.isFile()) {
        totalFiles++;
        const language = detectLanguage(name);
        if (language) {
          languageStats[language] = (languageStats[language] || 0) + 1;
        }

        const entry: RepoMapEntry = {
          path: relPath,
          type: 'file',
          size: stat.size,
          lastModified: stat.mtimeMs,
          language,
          relevanceScore: 0,
        };

        // Extract symbols for source files (skip large/binary)
        if (opts.includeSymbols && stat.size < 100_000 && language) {
          try {
            const content = readFileSync(fullPath, 'utf-8');
            entry.symbols = extractSymbols(fullPath, content);
            entry.imports = extractImports(fullPath, content);
          } catch {
            // Binary or unreadable file
          }
        }

        // Calculate relevance score
        let score = 0;
        // Recency: newer = higher score (0-1)
        const ageHours = (Date.now() - stat.mtimeMs) / 3_600_000;
        score += opts.rankingWeights.recency * Math.max(0, 1 - ageHours / 168); // 1 week window
        // Proximity: in same dir as open files = higher score
        for (const openPath of openRelativePaths) {
          if (dirname(relPath) === dirname(openPath)) {
            score += opts.rankingWeights.proximity * 0.8;
            break;
          }
          const relDir = dirname(relPath);
          const openDir = dirname(openPath);
          if (relDir.startsWith(openDir) || openDir.startsWith(relDir)) {
            score += opts.rankingWeights.proximity * 0.4;
            break;
          }
        }
        // Git modified: recently changed files = higher priority
        if (gitModifiedFiles.has(relPath)) {
          score += opts.rankingWeights.gitModified * 1.0;
        }
        entry.relevanceScore = Math.min(1, score);

        entries.push(entry);
      }
    }
  }

  walk(root, 0);

  // Sort by relevance score (highest first)
  entries.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return {
    root,
    entries: entries.slice(0, opts.maxFiles),
    generatedAt: Date.now(),
    totalFiles,
    languageStats,
  };
}

/**
 * Format the repo map as a text summary suitable for LLM context.
 * Mirrors Aider's get_repo_map() output format.
 */
export function formatRepoMapForLLM(map: RepoMap, maxEntries = 50): string {
  const lines: string[] = [];
  lines.push(`## Repository Map (${map.totalFiles} files, ${Object.keys(map.languageStats).length} languages)`);
  lines.push(`Languages: ${Object.entries(map.languageStats).map(([l, c]) => `${l}(${c})`).join(', ')}`);
  lines.push('');

  const topEntries = map.entries.filter(e => e.type === 'file').slice(0, maxEntries);

  for (const entry of topEntries) {
    const symbolSummary = entry.symbols && entry.symbols.length > 0
      ? ` [${entry.symbols.map(s => `${s.kind}:${s.name}`).join(', ')}]`
      : '';
    lines.push(`${entry.path}${symbolSummary}`);
  }

  return lines.join('\n');
}