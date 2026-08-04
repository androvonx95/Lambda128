# lambda128 — AI Coding Assistant for VS Code

An agentic AI coding assistant built on top of Code-OSS (VS Code), inspired by Cursor's AI workflow.

## Architecture

```
packages/
├── shared/          → Types, constants, validation
├── storage/         → SQLite persistence layer
├── providers/       → OpenAI + Anthropic with failover
├── core/            → Agent engine, tools, prompt, caching
├── repository/      → Workspace scanning + indexing
└── vscode-extension/→ VS Code extension (chat + agent)
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm -r exec tsc -b

# Run tests
node test-caches.mjs

# Launch in VS Code / VS Codium
# Press F5 to open Extension Development Host
```

## Configuration

Set in VS Code settings (`Ctrl+,`):
- `lambda128.openaiApiKey` — Your OpenAI API key
- `lambda128.anthropicApiKey` — Your Anthropic API key

## Features

### Chat Mode
Open the AI panel and type messages. The AI has context about:
- Currently open file
- Selected code
- Project structure
- Git status

### Agent Mode
Prefix with `@agent` or use the command palette. The agent:
1. Plans the task into steps
2. Reads relevant files
3. Searches the codebase
4. Generates edits as diffs
5. Asks for approval before writing

### Inline Commands
Select code → Right-click / Command Palette:
- **Explain This Code**
- **Fix This Code**
- **Refactor This Code**

### Tools Available to AI
| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Create/overwrite files |
| `edit_file` | SEARCH/REPLACE edits |
| `search_files` | Regex search (ripgrep) |
| `glob` | Find files by pattern |
| `list_directory` | List directory contents |
| `git_status` | Working tree status |
| `git_diff` | Show staged/unstaged diffs |
| `delete_file` | Delete with backup |
| `rename_file` | Rename/move files |
| `run_terminal` | Execute shell commands |

### Supported AI Providers
- OpenAI (GPT-4o, GPT-4o-mini)
- Anthropic (Claude Sonnet 4, Claude 3.5 Haiku)
- Automatic failover between providers

## Caching & Token Economy

- **FileCache** — 60s TTL for file reads
- **TokenBudgetManager** — Auto-trims history at 95% context
- **WorkspaceIndexCache** — 24h disk cache for project structure
- **ContextCache** — Hash-based dedup of context snapshots
- **System Prompt Memoization** — Rebuilt only when tools change

## Keys

API keys are stored in VS Code settings. Never committed to the repository.