# lambda128 — AI Coding Assistant

An agentic AI coding assistant that works as a **VS Code extension** and **standalone desktop IDE**.
Built on Code-OSS. Inspired by Cursor's AI workflow — but open-source.

[![CI](https://github.com/androvonx95/lambda128/actions/workflows/ci.yml/badge.svg)](https://github.com/androvonx95/lambda128/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-BUSL%201.1-blue.svg)](./LICENSE)
[![CLA](https://img.shields.io/badge/CLA-required-green.svg)](./CLA.md)

---

## What lambda128 Does

lambda128 adds an AI pair programmer to your editor. It can:

- **Chat** about your codebase with full workspace awareness
- **Act as an agent** — plan tasks, read files, search code, run terminal commands, and edit multiple files
- **Show diffs before writing** — you approve every change
- **Run with your own API key** — no subscription, no hosted backend
- **Fail over between providers** — if Anthropic goes down, it switches to OpenAI automatically

---

## Current Status

**v0.1.0 Alpha** — The core engine works. You can chat, run the agent, and it will plan + edit code.

| What Works | What's Coming |
|-----------|---------------|
| Chat with streaming responses | Desktop app packaging (.AppImage/.dmg/.exe) |
| Agent mode (plan → execute → observe → replan) | VS Code Marketplace / Open VSX publishing |
| 11 tools (read, write, edit, search, git, terminal) | Tab autocomplete (FIM) |
| 6 AI providers (OpenAI, Anthropic, Gemini, OpenRouter, Bedrock, Ollama) | |
| Local/Ollama models (llama3.2, codellama, qwen2.5-coder, deepseek-coder, codestral) | |
| Automatic provider failover | Semantic search (embeddings engine built, UI in progress) |
| Patch/diff review before any file is written | |
| Permission tiers (auto-approve reads, ask for writes) | |
| 39 tests passing, 0 TypeScript errors | |

See [ROADMAP.md](./ROADMAP.md) for the full development plan.

---

## Installation

lambda128 is **not yet published** on any marketplace. Desktop binaries are not yet built.

### Build from Source (the only option today)

```bash
# Prerequisites: Node.js 22+, pnpm 11+
git clone https://github.com/androvonx95/lambda128.git
cd lambda128
pnpm install
pnpm -r build

# Run tests
node test-caches.mjs   # Should print: 39 passed, 0 failed

# Launch the extension
# Open the project in VS Code / VS Codium and press F5
# This opens an Extension Development Host with lambda128 loaded
```

---

## Configuration

lambda128 uses **your API keys** — nothing is hosted.

Open VS Code Settings (`Ctrl+,`) and configure at least one provider:

| Setting | Description |
|---------|-------------|
| `lambda128.anthropicApiKey` | Anthropic API key (recommended) |
| `lambda128.openaiApiKey` | OpenAI API key |
| `lambda128.geminiApiKey` | Google Gemini API key |
| `lambda128.openrouterApiKey` | OpenRouter API key |
| `lambda128.bedrockAccessKeyId` | AWS Bedrock access key |
| `lambda128.ollamaModel` | Ollama model (default: `llama3.2`) |
| `lambda128.ollamaBaseUrl` | Ollama API URL (default: `http://localhost:11434/v1`) |
| `lambda128.defaultProvider` | Which provider to use first (default: `anthropic`) |

Keys are stored in your **OS keychain** — never in plaintext.

---

## Architecture

lambda128 is an **8-package monorepo**:

```
packages/
├── shared/           Types, constants, IPC contracts
├── core/             Agent engine, prompt orchestrator, tool registry, token budget
├── providers/        OpenAI, Anthropic, Gemini, OpenRouter, Bedrock
├── storage/          SQLite conversations, OS keychain, file cache
├── repository/       Workspace scanner, repo-map, embeddings engine
├── vscode-extension/ VS Code extension (chat webview, settings, history, agent UI)
├── webview/          React chat UI
└── desktop/          Electron desktop app shell
```

Full architecture: [ARCHITECTURE.md](./ARCHITECTURE.md) (16-section design document)

---

## Features

### Chat

Ask the AI anything about your code. It has context about open files, selected code, project structure, and git status.

### Agent Mode

Prefix with `@agent` or use the command palette. The agent:

1. Decomposes your task into steps
2. Reads relevant files
3. Searches the codebase (ripgrep-powered)
4. Generates edits as SEARCH/REPLACE patches
5. Shows you a diff
6. Applies the change only after you approve

### Tools the AI Can Use

| Tool | Category | Requires Approval |
|------|----------|:---:|
| `read_file` | Read file contents | ❌ Auto |
| `write_file` | Create/overwrite files | ✅ Always |
| `edit_file` | Targeted SEARCH/REPLACE edits | ✅ Always |
| `search_files` | Regex search (ripgrep) | ❌ Auto |
| `glob` | Find files by pattern | ❌ Auto |
| `list_directory` | List directory contents | ❌ Auto |
| `git_status` | Working tree status | ❌ Auto |
| `git_diff` | Staged/unstaged diffs | ❌ Auto |
| `delete_file` | Delete with backup | ✅ Double confirm |
| `rename_file` | Rename/move files | ✅ Always |
| `run_terminal` | Execute shell commands | ✅ Always |

All permissions are configurable in Settings.

---

## Security

- **API keys** stored in OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- **No cloud backend** — all provider calls go directly from your machine
- **File writes require approval** — the AI cannot modify files without your consent
- **Terminal commands require approval** — dangerous commands are flagged
- **Workspace boundary** — the AI cannot read files outside your project

See [SECURITY.md](./SECURITY.md) for the full security policy.

---

## Contributing

All contributors must sign the [CLA](./CLA.md) before PRs can be merged. The CLA grants a license to your contribution, and assigns copyright if the project is ever relicensed or transferred.

```bash
git clone https://github.com/androvonx95/lambda128.git
cd lambda128
pnpm install
pnpm -r build
node test-caches.mjs  # Must pass all 39 tests
```

Full guide: [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## License

lambda128 is licensed under the [Business Source License 1.1](./LICENSE).

- **Free for non-production use** (personal, evaluation, development)
- **Free for production use** if your organization has less than $1M USD annual revenue **OR** fewer than 25 employees
- **Converts to Apache 2.0** four years after each release
- **Commercial licenses available** — contact androvonx95@tutamail.com

---

## Governance

androvonx95 is a single-maintainer project with a path toward community governance. See [GOVERNANCE.md](./GOVERNANCE.md) and [MAINTAINERS.md](./MAINTAINERS.md).