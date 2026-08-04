# lambda128 — Development Roadmap

## Current Status: Pre-Release Alpha (v0.1.0)

### ✅ Completed

| Subsystem | Status | Notes |
|-----------|--------|-------|
| Agent Engine | ✅ Done | Full execution loop: plan → execute → observe → replan |
| Planning Engine | ✅ Done | Task decomposition with dependency ordering |
| Prompt Orchestrator | ✅ Done | Multi-source prompt assembly with token budget |
| Provider Router | ✅ Done | 5 providers with automatic failover |
| Tool Registry | ✅ Done | 11 tools with validation and permission enforcement |
| Permission System | ✅ Done | Tiered: auto/ask/deny per tool category |
| Patch/Diff Engine | ✅ Done | SEARCH/REPLACE with approval workflow |
| Context Engine | ✅ Done | Workspace, git, editors, history context gathering |
| Repository Intelligence | ✅ Done | Ripgrep search, glob, directory listing |
| Git Awareness | ✅ Done | Status, diff, log, branch detection |
| Terminal Execution | ✅ Done | Shell command execution with approval |
| Streaming Engine | ✅ Done | SSE chunk assembly for all providers |
| Token Budget Manager | ✅ Done | Auto-trim at 95% with priority eviction |
| Conversation Storage | ✅ Done | SQLite persistence with full history |
| Checkpoint System | ✅ Done | Git-based snapshots before agent actions |
| MCP Manager | ✅ Done | Model Context Protocol support |
| Embedding Engine | ✅ Done | Local (all-MiniLM-L6-v2) + Cloud (OpenAI) |
| File Cache | ✅ Done | 60s TTL with hash-based dedup |
| Inline Editing | ✅ Done | CodeLens + context menu commands |
| Settings Panel | ✅ Done | Full VS Code settings integration |
| Secret Storage | ✅ Done | OS keychain for API keys |
| VS Code Extension | ✅ Done | Chat, agent, history, repo-map views |
| Desktop App Shell | ✅ Done | Electron packaging configured |
| Arch Linux (AUR) | ✅ Done | PKGBUILD ready |
| CLA | ✅ Done | Contributor License Agreement |
| CI/CD Pipeline | ✅ Done | GitHub Actions: typecheck, test, lint, CLA |

---

### 🚧 In Progress / Next Up

| Priority | Feature | Effort | Target |
|----------|---------|--------|--------|
| P0 | **Desktop App Packaging** — Full Electron app with bundled Code-OSS | Medium | v0.2.0 |
| P0 | **VSIX Publishing** — VS Code Marketplace + Open VSX Registry | Low | v0.2.0 |
| P0 | **Installation Guide** — Step-by-step for all platforms | Low | v0.2.0 |
| P1 | **Tab Autocomplete (FIM)** — Real-time inline code suggestions | High | v0.3.0 |
| P1 | **Local Model Support** — Ollama integration for offline use | Medium | v0.3.0 |
| P1 | **Vision Support** — Screenshot/diagram input to AI | Medium | v0.4.0 |
| P1 | **Debugging Integration** — Runtime error analysis, stack traces | High | v0.4.0 |

---

### 📋 Backlog

| Feature | Effort | Notes |
|---------|--------|-------|
| Test Generation | Medium | Auto-generate unit tests from code |
| Documentation Generation | Low | Auto-generate docs from code |
| PR Review Bot | Medium | GitHub bot that reviews PRs |
| Multi-workspace Support | High | Work across multiple projects |
| Team/Org Features | High | Shared settings, team billing |
| Custom Tool Definitions | Medium | User-defined tools via config |
| Web UI | High | Browser-based interface |
| Mobile Companion | High | iOS/Android app for on-the-go |
| Plugin System | High | Third-party tool extensions |
| Analytics Dashboard | Medium | Usage stats, token tracking |

---

## Release Plan

### v0.1.0 — Alpha (Current)
- [x] Core agent engine
- [x] All 11 tools
- [x] 5 AI providers
- [x] VS Code extension
- [x] CLA + CI/CD
- [x] 39 passing tests

### v0.2.0 — "Installable" (Target: 2-4 weeks)
- [ ] Packaged Electron desktop app (AppImage, deb, dmg, exe)
- [ ] Published to VS Code Marketplace
- [ ] Published to Open VSX Registry
- [ ] Complete installation guide
- [ ] AUR package submission
- [ ] First public release announcement

### v0.3.0 — "Competitive" (Target: 4-8 weeks)
- [ ] Tab autocomplete (FIM)
- [ ] Ollama/local model support
- [ ] Improved agent planning
- [ ] More comprehensive tests
- [ ] Performance benchmarks

### v0.4.0 — "Complete" (Target: 8-12 weeks)
- [ ] Vision/image support
- [ ] Debugging integration
- [ ] Test generation
- [ ] Documentation generation
- [ ] E2E test suite

### v1.0.0 — "Stable"
- [ ] Production hardening
- [ ] Security audit
- [ ] Accessibility compliance
- [ ] Full documentation site
- [ ] Community governance model

---

## How to Contribute

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions and the PR process.

Priority areas for contributors:
1. **Tab autocomplete** — Fill-in-the-middle (FIM) model integration
2. **Local models** — Ollama provider implementation
3. **Testing** — Expand test coverage beyond 39 tests
4. **Documentation** — Improve README, add API docs
5. **Platform support** — Windows/macOS testing and fixes