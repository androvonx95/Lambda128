# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅ Active development |
| 0.1.x   | ❌ End of life |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: `security@lambda128.dev`

We respond within 48 hours. We practice responsible disclosure — please allow us 90 days to patch before public disclosure.

## Security Model

lambda128 is a **local-first** application. Your API keys never leave your machine. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full security model.

### Key security properties:

- **API keys** stored in OS keychain (Keychain Access on macOS, Credential Manager on Windows, Secret Service on Linux)
- **No cloud backend** — all AI provider calls go directly from your machine
- **File writes require approval** — the AI cannot modify your filesystem without explicit consent
- **Terminal commands require approval** — dangerous commands (`rm -rf`, `sudo`, `chmod 777`) are flagged
- **Workspace boundary enforcement** — the AI cannot read files outside your project

### Reporting a vulnerability in a dependency

If you discover a vulnerability in a dependency used by lambda128, please report it to both the dependency maintainer and us.
