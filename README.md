# lambda128 — AI Coding Assistant

An agentic AI coding assistant that works as both a **standalone desktop IDE** and a **VS Code extension**. Built on Code-OSS, inspired by Cursor's AI workflow.

[![CI](https://github.com/androvonx95/lambda128/actions/workflows/ci.yml/badge.svg)](https://github.com/androvonx95/lambda128/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-BUSL%201.1-blue.svg)](./LICENSE)
[![CLA](https://img.shields.io/badge/CLA-required-green.svg)](./CLA.md)

---

## Why lambda128?

| | lambda128 | Cursor | Cline | Windsurf | Continue.dev |
|---|:---:|:---:|:---:|:---:|:---:|
| **Price** | Free | $20/mo | Free | $15/mo | Free |
| **Agent Mode** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Provider Failover** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Standalone IDE** | ✅ | ✅ | ❌ | ✅ | ❌ |
| **VS Code Extension** | ✅ | ❌ | ✅ | ❌ | ✅ |
| **Token Budget Mgmt** | ✅ | ✅ | ❌ | ✅ | ❌ |
| **Checkpoints** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **CLA Protection** | ✅ | ❌ | ❌ | ❌ | ❌ |

See [full comparison](./COMPARISON.md) for detailed breakdown.

---

## Installation

### Option 1: Standalone Desktop App (Recommended)

The desktop app is a self-contained IDE — no VS Code required, no extension conflicts.

#### Linux

```bash
# AppImage (any distro)
wget https://github.com/androvonx95/lambda128/releases/latest/download/lambda128.AppImage
chmod +x lambda128.AppImage
./lambda128.AppImage

# Debian/Ubuntu
wget https://github.com/androvonx95/lambda128/releases/latest/download/lambda128.deb
sudo dpkg -i lambda128.deb

# Arch Linux (AUR)
yay -S lambda128
# or
paru -S lambda128
```

#### macOS

```bash
# Download the DMG from releases
# https://github.com/androvonx95/lambda128/releases/latest
# Open lambda128.dmg and drag to Applications
```

Or via Homebrew (coming soon):
```bash
brew install --cask lambda128
```

#### Windows

```bash
# Download the installer from releases
# https://github.com/androvonx95/lambda128/releases/latest
# Run lambda128-Setup.exe
```

Or via winget (coming soon):
```bash
winget install lambda128
```

### Option 2: VS Code / VS Codium Extension

Install alongside your existing VS Code setup:

```bash
# From VS Code Marketplace (coming soon)
code --install-extension lambda128.lambda128

# From Open VSX Registry (coming soon)
codium --install-extension lambda128.lambda128

# From a .vsix file (manual)
# Download the latest .vsix from releases
code --install-extension lambda128-0.1.0.vsix
```

### Option 3: Build from Source

```bash
# Prerequisites: Node.js 22+, pnpm 9+
git clone https://github.com/androvonx95/lambda128.git
cd lambda128
pnpm install
pnpm -r build

# Run tests (39 tests)
node test-caches.mjs

# Launch as VS Code extension
# Open in VS Code / VS Codium and press F5
# This opens an Extension Development Host window

# Build desktop app
cd packages/desktop
pnpm build
npx electron-builder
# Output in packages/desktop/release/
```

---

## Configuration

After installation, configure your AI provider:

### Settings (VS Code / Desktop App)

Open Settings (`Ctrl+,`) and set:

| Setting | Description | Required? |
|---------|-------------|-----------|
| `lambda128.anthropicApiKey` | Anthropic API key | Recommended |
| `lambda128.openaiApiKey` | OpenAI API key | Optional |
| `lambda128.geminiApiKey` | Google Gemini API key | Optional |
| `lambda128.openrouterApiKey` | OpenRouter API key | Optional |
| `lambda128.defaultProvider` | Default: `anthropic` | Optional |
| `lambda128.anthropicModel` | Default: `claude-sonnet-4-20250514` | Optional |
| `lambda128.openaiModel` | Default: `gpt-4o` | Optional |

**Provider failover**: If your primary provider fails, lambda128 automatically switches to the next available one.

---

## Features

### Chat Mode
Open the AI panel (`Ctrl+Shift+P` → `AI: Open Chat`) and type messages. The AI has context about:
- Currently open file
- Selected code
- Project structure
- Git status

### Agent Mode
Prefix with `@agent` or use `AI: Start Agent Mode`. The agent:
1. Plans the task into steps
2. Reads relevant files
3. Searches the codebase
4. Generates edits as diffs
5. Asks for approval before writing

### Inline Commands
Select code → Right-click:
- **Explain This Code**
- **Fix This Code**
- **Refactor This Code**
- **Optimize This Code**

### Tools Available to AI

| Tool | Category | Description |
|------|----------|-------------|
| `read_file` | Read | Read file contents with line range |
| `write_file` | Write | Create or overwrite files |
| `edit_file` | Write | Targeted SEARCH/REPLACE edits |
| `search_files` | Read | Regex search across project (ripgrep) |
| `glob` | Read | Find files by pattern |
| `list_directory` | Read | List directory contents |
| `git_status` | Read | Working tree status |
| `git_diff` | Read | Staged/unstaged diffs |
| `delete_file` | Destroy | Delete with backup |
| `rename_file` | Write | Rename/move files |
| `run_terminal` | Shell | Execute shell commands |

### Permission Tiers

| Tier | Read Files | Write Files | Delete Files | Shell Commands |
|------|:----------:|:-----------:|:------------:|:--------------:|
| Auto-approve | ✅ | | | |
| Ask once | | | | ✅ |
| Always ask | | ✅ | ✅ (double) | |
| Never allow | | | | |

All configurable in settings.

---

## Architecture

```
packages/
├── shared/           → Shared TypeScript types, constants, validation
├── core/             → Agent engine, prompt orchestrator, tool registry, caches
├── providers/        → OpenAI, Anthropic, Gemini, OpenRouter, Bedrock
├── storage/          → SQLite database, keychain, file cache
├── repository/       → Workspace scanner, repo-map, embeddings
├── vscode-extension/ → VS Code extension (chat, settings, history, agent UI)
└── desktop/          → Electron desktop app shell
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full 16-section architecture document.

---

## Project Status

**Current**: v0.1.0 Alpha — Core agent engine functional, 39 tests passing.

See [ROADMAP.md](./ROADMAP.md) for the full development plan and [COMPARISON.md](./COMPARISON.md) for competitive analysis.

### Quick Status

- ✅ Agent engine with planning loop
- ✅ 11 tools with permission system
- ✅ 5 AI providers with automatic failover
- ✅ VS Code extension
- ✅ CLA + CI/CD pipeline
- 🚧 Desktop app packaging (next)
- 🚧 VS Code Marketplace publishing (next)
- 📋 Tab autocomplete (planned)
- 📋 Local/Ollama models (planned)

---

## Contributing

We welcome contributions! All contributors must sign the [CLA](./CLA.md) before PRs can be merged.

```bash
git clone https://github.com/androvonx95/lambda128.git
cd lambda128
pnpm install
pnpm -r build
node test-caches.mjs  # Must pass all 39 tests
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full guidelines.

---

## License

lambda128 is licensed under the [Business Source License 1.1 (BUSL 1.1)](./LICENSE). The license automatically converts to Apache 2.0 after 4 years.

All contributors must sign the [Contributor License Agreement](./CLA.md).

---

## Security

API keys are stored in your OS keychain (never in plaintext). The AI never writes to your filesystem without explicit approval. See [ARCHITECTURE.md §10](./ARCHITECTURE.md#10-security-model) for the full security model.