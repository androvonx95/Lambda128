# Contributing to lambda128

Thank you for your interest in contributing! lambda128 is source-available under the Business Source License (BUSL 1.1). Before contributing, please read this guide.

## Contributor License Agreement (CLA)

**All contributors must sign the CLA before any pull request can be merged.**

We use the [CLA Assistant](https://cla-assistant.io/) GitHub bot to manage signatures. Here's how it works:

### First-Time Contributors

1. Open a Pull Request
2. The CLA Assistant bot will comment on your PR with a link to sign
3. Click the link and sign with your GitHub account
4. The bot will update your PR status to "CLA signed"
5. This is a **one-time process** — you won't need to sign again for future PRs

### Alternative: Sign via Commit

You can also sign the CLA by including a `Signed-off-by` line in every commit message:

```
git commit -s -m "Your commit message"
```

This adds:
```
Signed-off-by: Your Name <your.email@example.com>
```

### What the CLA Covers

- You grant the project owner a perpetual, royalty-free license to use, sublicense, and distribute your contribution
- If the project is relicensed, sold, or transferred, you agree to assign copyright in your contribution to the project owner (§2.2)
- You waive moral rights (attribution and integrity) to the fullest extent permitted by law (§4)
- You grant a patent license covering your contribution (§3)
- You confirm your contribution is your original work
- You confirm you have the right to contribute it

Read the full CLA at [CLA.md](./CLA.md).

### Setting Up CLA Assistant (for Maintainers)

The CLA Assistant is configured at [cla-assistant.io](https://cla-assistant.io/):

1. Go to https://cla-assistant.io
2. Sign in with GitHub
3. Add the repository: `androvonx95/Lambda128`
4. Link the CLA gist or use the CLA text from [CLA.md](./CLA.md)
5. Configure required status checks in GitHub branch protection rules

The CI workflow (`.github/workflows/ci.yml`) already includes a CLA check step that verifies signatures.

---

## Development Setup

```bash
# Prerequisites: Node.js 22+, pnpm 11+
git clone https://github.com/androvonx95/Lambda128.git
cd lambda128
pnpm install
pnpm -r build        # Typecheck all 7 packages
node test-caches.mjs  # Run 39 tests
```

## Project Structure

```
packages/
├── shared/          # Shared TypeScript types, constants, validation
├── core/            # Agent engine, prompt orchestrator, tool registry, caches
├── providers/       # OpenAI, Anthropic, Gemini, OpenRouter, Bedrock
├── storage/         # SQLite database, keychain, file cache
├── repository/      # Workspace scanner, repo-map, embeddings
├── vscode-extension/# VS Code extension (chat, settings, history, agent UI)
└── desktop/         # Electron desktop app shell
```

## Development Workflow

### Running the Extension

1. Open the project in VS Code / VS Codium
2. Press `F5` to launch the Extension Development Host
3. The lambda128 sidebar appears in the activity bar
4. Open the Chat panel and start using the AI

### Running Tests

```bash
# Run all 39 tests
node test-caches.mjs

# Expected output: 39 passed, 0 failed
```

### Building the Desktop App

```bash
cd packages/desktop
pnpm build
npx electron-builder
# Output in packages/desktop/release/
```

### Type Checking

```bash
pnpm -r build        # Build + typecheck all 7 packages (0 errors required)
```

---

## Pull Request Process

1. **Fork** the repo and create a branch from `main`
2. **Make your changes** following the code style below
3. **Run** `pnpm -r build` — must pass with 0 errors
4. **Run** `node test-caches.mjs` — all 39 tests must pass
5. **Open a PR** with a clear description:
   - What problem does this solve?
   - What approach did you take?
   - How did you test it?
6. **Sign the CLA** when prompted by the bot
7. **Wait for CI** to pass (typecheck + tests + lint)
8. **Address review feedback** from maintainers

### CI Pipeline

Every PR automatically runs:
- **TypeScript type check** — `pnpm -r build`
- **Unit tests** — `node test-caches.mjs` (39 tests)
- **Lint** — `pnpm -r lint` (if configured)
- **CLA check** — Verifies CLA signature

All checks must pass before merging.

---

## Code Style

- **TypeScript strict mode** — no implicit `any`
- **No `any` types** without a comment justifying why
- **Explicit return types** on all exported functions
- **Use shared types** from `@lambda128/shared` — don't redefine types
- **Follow existing patterns** in each package
- **Imports**: Use `.js` extensions in relative imports (ESM convention)
- **File naming**: `kebab-case.ts` for modules, `PascalCase.tsx` for React components

### Example

```typescript
// ✅ Good
import { ToolResult } from '@lambda128/shared';

export function executeTool(params: ToolParams): Promise<ToolResult> {
  // ...
}

// ❌ Bad
export function executeTool(params: any) {
  // ...
}
```

---

## Adding a New AI Provider

1. Create `packages/providers/src/<name>/provider.ts`
2. Implement the `AIProvider` interface from `@lambda128/shared`
3. Register in `packages/providers/src/index.ts`
4. Add settings in `packages/vscode-extension/package.json` (configuration section)
5. Add to provider router in `packages/providers/src/router.ts`

## Adding a New Tool

1. Create `packages/core/src/tools/definitions/<tool-name>.ts`
2. Implement the `Tool` interface
3. Register in `packages/core/src/tools/definitions/index.ts`
4. Add permission defaults in the tool registry

---

## Reporting Issues

- **Search existing issues** first
- **Include steps to reproduce**
- **Include environment**: OS, Node version, VS Code version
- **For agent issues**: Include the conversation that triggered the problem
- **For bugs**: Include error messages and stack traces

---

## Community

- **Discussions**: Use GitHub Discussions for questions and ideas
- **Issues**: Bug reports and feature requests
- **PRs**: Code contributions following this guide

---

## License

By contributing, you agree that your contributions will be licensed under the same BUSL 1.1 license that covers the project, and you grant the project maintainer the rights described in the [CLA](./CLA.md).