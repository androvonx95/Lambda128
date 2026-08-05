/**
 * Tab Autocomplete (FIM — Fill-in-the-Middle) Provider
 *
 * Provides inline code completions as the user types, similar to
 * Cursor's Tab or GitHub Copilot. Uses the configured AI provider
 * to generate context-aware suggestions.
 *
 * VS Code API: InlineCompletionItemProvider (requires VS Code >= 1.92)
 */
import * as vscode from 'vscode';
import type { ProviderRouter } from '@lambda128/providers';
import type { Message } from '@lambda128/shared';

/** Maximum characters of prefix/suffix to send to the model */
const MAX_CONTEXT_CHARS = 4000;

/** Debounce delay in ms before requesting a completion */
const DEBOUNCE_MS = 300;

/** Maximum completions to show at once */
const MAX_COMPLETIONS = 3;

/** Minimum characters typed before triggering autocomplete */
const MIN_TRIGGER_LENGTH = 2;

/** File extensions that support autocomplete */
const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi', '.pyx',
  '.rs',
  '.go',
  '.java', '.kt', '.kts',
  '.rb',
  '.php',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
  '.cs',
  '.swift',
  '.scala',
  '.lua',
  '.sh', '.bash', '.zsh',
  '.sql',
  '.html', '.css', '.scss', '.less',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx',
  '.vue', '.svelte',
  '.dart',
  '.ex', '.exs',
  '.elm',
  '.r', '.R',
]);

/** Trigger characters that should immediately request a completion */
const TRIGGER_CHARACTERS = ['.', '(', '[', '{', ' ', '=', ':', ',', '>', '/'];

export class CompletionsProvider implements vscode.InlineCompletionItemProvider {
  private providerRouter: ProviderRouter;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(providerRouter: ProviderRouter) {
    this.providerRouter = providerRouter;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
    // Skip if autocomplete is disabled
    const config = vscode.workspace.getConfiguration('lambda128');
    if (config.get('autocomplete.enabled') === false) return [];

    // Skip if file type is not supported
    const ext = document.fileName.split('.').pop();
    if (ext && !SUPPORTED_EXTENSIONS.has(`.${ext}`)) return [];

    // Skip if triggered manually but we don't have enough context
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      // For automatic triggers, check minimum prefix length
      const linePrefix = document.lineAt(position.line).text.substring(0, position.character);
      if (linePrefix.trim().length < MIN_TRIGGER_LENGTH) return [];
    }

    // Cancel any in-flight request
    this.cancelPending();

    // Debounce: wait before sending request
    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        if (token.isCancellationRequested) {
          resolve([]);
          return;
        }

        try {
          const items = await this.generateCompletions(document, position, token);
          resolve(items);
        } catch {
          resolve([]);
        }
      }, DEBOUNCE_MS);
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private cancelPending(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async generateCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    // Extract prefix (text before cursor) and suffix (text after cursor)
    const fullText = document.getText();
    const offset = document.offsetAt(position);

    const prefix = fullText.substring(Math.max(0, offset - MAX_CONTEXT_CHARS), offset);
    const suffix = fullText.substring(offset, Math.min(fullText.length, offset + MAX_CONTEXT_CHARS));

    // Skip if prefix is empty
    if (!prefix.trim()) return [];

    // Build the FIM prompt
    const language = document.languageId;
    const filePath = vscode.workspace.asRelativePath(document.uri);

    const systemPrompt = `You are a code completion engine. Complete the code at the cursor position.
File: ${filePath}
Language: ${language}

RULES:
- Output ONLY the code that should appear at the cursor — no explanations, no markdown fences
- Match the existing indentation, style, and naming conventions
- Complete the current expression/statement/block naturally
- If the cursor is mid-word, complete the word
- If the cursor is at the end of a line, suggest the next logical line(s)
- Keep completions concise (1-5 lines typically)
- Do NOT repeat the prefix or suffix in your output`;

    const userMessage = `<|prefix|>\n${prefix}\n<|suffix|>\n${suffix}\n<|middle|>`;

    const messages: Message[] = [
      { id: 'sys', role: 'system', content: systemPrompt, createdAt: Date.now() },
      { id: 'usr', role: 'user', content: userMessage, createdAt: Date.now() },
    ];

    this.abortController = new AbortController();

    try {
      const { response } = await this.providerRouter.chat(messages, {
        model: this.getCompletionModel(),
        maxTokens: 150,
        temperature: 0.1, // Low temperature for consistent completions
      });

      if (token.isCancellationRequested) return [];

      const completionText = response.content.trim();
      if (!completionText) return [];

      // Create completion items
      const items: vscode.InlineCompletionItem[] = [];

      // Main completion
      items.push(new vscode.InlineCompletionItem(
        completionText,
        new vscode.Range(position, position),
      ));

      // If the completion has multiple lines, also offer just the first line
      const lines = completionText.split('\n');
      if (lines.length > 1) {
        items.push(new vscode.InlineCompletionItem(
          lines[0],
          new vscode.Range(position, position),
        ));
      }

      return items.slice(0, MAX_COMPLETIONS);
    } catch {
      return [];
    }
  }

  private getCompletionModel(): string {
    const config = vscode.workspace.getConfiguration('lambda128');
    const provider = config.get<string>('defaultProvider') || 'anthropic';

    switch (provider) {
      case 'openai': return config.get<string>('openaiModel') || 'gpt-4o';
      case 'anthropic': return config.get<string>('anthropicModel') || 'claude-sonnet-4-20250514';
      case 'gemini': return config.get<string>('geminiModel') || 'gemini-2.5-flash';
      case 'openrouter': return config.get<string>('openrouterModel') || 'openai/gpt-4o';
      case 'ollama': return config.get<string>('ollamaModel') || 'llama3.2';
      default: return 'claude-sonnet-4-20250514';
    }
  }

  dispose(): void {
    this.cancelPending();
  }
}