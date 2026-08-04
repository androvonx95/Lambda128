/**
 * Context system types.
 * Defines context snapshots, file context, and workspace metadata.
 */

export interface ContextSnapshot {
  workspaceRoot: string;
  activeFile?: FileContext;
  openEditors: FileContext[];
  selectedCode?: string;
  gitStatus?: GitContext;
  projectStructure?: string;
  recentFiles: string[];
  timestamp: number;
}

export interface FileContext {
  path: string;
  content?: string;
  language: string;
  selection?: {
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
  };
  lastModified: number;
}

export interface GitContext {
  branch: string;
  status: {
    staged: string[];
    unstaged: string[];
    untracked: string[];
  };
  recentCommits: GitCommit[];
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: number;
}

export interface WorkspaceMetadata {
  path: string;
  projectName: string;
  languages: string[];
  frameworks: string[];
  fileCount: number;
  lastIndexedAt: number;
}

export interface FileRanking {
  path: string;
  score: number;
  reasons: string[];
}