/**
 * Shared constants used across all packages.
 */

/** Tool IDs */
export const TOOL_IDS = {
  READ_FILE: 'read_file',
  WRITE_FILE: 'write_file',
  EDIT_FILE: 'edit_file',
  CREATE_FILE: 'create_file',
  DELETE_FILE: 'delete_file',
  RENAME_FILE: 'rename_file',
  SEARCH_FILES: 'search_files',
  GLOB: 'glob',
  LIST_DIRECTORY: 'list_directory',
  GIT_STATUS: 'git_status',
  GIT_DIFF: 'git_diff',
  RUN_TERMINAL: 'run_terminal',
  READ_LINTS: 'read_lints',
  GET_SYMBOLS: 'get_symbols',
} as const;

/** Error codes */
export const ERROR_CODES = {
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
  TOOL_PERMISSION_DENIED: 'TOOL_PERMISSION_DENIED',
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
  CONTEXT_OVERFLOW: 'CONTEXT_OVERFLOW',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PATH_TRAVERSAL: 'PATH_TRAVERSAL',
  INVALID_PARAMETERS: 'INVALID_PARAMETERS',
  IPC_ERROR: 'IPC_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
} as const;

/** Default limits */
export const LIMITS = {
  MAX_AGENT_STEPS: 25,
  MAX_TOOL_TIMEOUT_MS: 30_000,
  MAX_SHELL_TIMEOUT_MS: 120_000,
  MAX_FILE_SIZE_BYTES: 1_048_576, // 1MB
  MAX_TOOL_OUTPUT_TOKENS: 8_000,
  TOKEN_BUDGET_THRESHOLD: 0.8, // 80% of context window
  MAX_OPEN_EDITORS_CONTEXT: 5,
  MAX_RECENT_FILES_CONTEXT: 10,
  MAX_GIT_COMMITS_CONTEXT: 5,
  CONVERSATION_SUMMARY_THRESHOLD: 0.6, // 60% of budget triggers summarization
} as const;

/** Provider IDs */
export const PROVIDER_IDS = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  OPENROUTER: 'openrouter',
} as const;

/** Default system prompt */
export const SYSTEM_PROMPT = `You are an AI coding assistant integrated into a code editor. You help users write, edit, understand, and debug code.

CAPABILITIES:
- Read and analyze code files in the user's workspace
- Search across the codebase using regex patterns
- Edit files with precise SEARCH/REPLACE operations
- Create new files
- Run terminal commands (with user approval)
- Access git status and diffs
- Understand project structure and dependencies

RULES:
1. Never overwrite code without showing a diff first
2. Always validate SEARCH blocks match actual file content
3. Ask for clarification when requirements are ambiguous
4. Prefer targeted edits over rewriting entire files
5. Respect .gitignore and workspace boundaries
6. Never access files outside the workspace
7. Never execute terminal commands without user approval
8. Report errors honestly and suggest recovery steps

RESPONSE FORMAT:
- Use markdown for explanations
- Use \`\`\`language blocks for code
- Use SEARCH/REPLACE blocks for edits
- Be concise but thorough`;

/** Storage paths */
export const STORAGE_PATHS = {
  BASE_DIR: '.lambda128',
  DB_FILE: 'db.sqlite',
  CACHE_DIR: 'cache',
  LOGS_DIR: 'logs',
  WORKSPACE_CACHE: 'workspace-cache',
} as const;