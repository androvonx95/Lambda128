/**
 * Inline AI Actions — Right-click context menu + CodeLens + decorations.
 * Supports: explain, fix, refactor, optimize on selected code.
 */
import * as vscode from 'vscode';

export function registerInlineActions(
  context: vscode.ExtensionContext,
  onAction: (action: string, code: string, filePath: string) => Promise<string>
): void {
  // CodeLens provider — shows "Explain" / "Fix" above functions
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, new AICodeLensProvider(onAction))
  );

  // Right-click context menu commands
  const actions = ['explain', 'fix', 'refactor', 'optimize'];
  for (const action of actions) {
    context.subscriptions.push(
      vscode.commands.registerTextEditorCommand(
        `lambda128.inline.${action}`,
        async (editor) => {
          const result = await handleInlineAction(editor, action, onAction);
          if (result) showInlineResult(editor, result);
        }
      )
    );
  }
}

async function handleInlineAction(
  editor: vscode.TextEditor,
  action: string,
  onAction: (action: string, code: string, filePath: string) => Promise<string>
): Promise<string | null> {
  const selection = editor.selection;
  const selectedText = editor.document.getText(
    selection.isEmpty ? new vscode.Range(0, 0, Math.min(editor.document.lineCount, 100), 0) : selection
  );
  const filePath = editor.document.uri.fsPath;

  const actionLabel = { explain: 'Explaining', fix: 'Fixing', refactor: 'Refactoring', optimize: 'Optimizing' }[action];

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `${actionLabel} code...` },
    async () => onAction(action, selectedText, filePath)
  );
}

function showInlineResult(editor: vscode.TextEditor, result: string): void {
  const selection = editor.selection;
  const endLine = selection.isEmpty ? Math.min(100, editor.document.lineCount - 1) : selection.end.line;

  // Show result as an information message with copy option
  const preview = result.length > 200 ? result.substring(0, 200) + '...' : result;
  vscode.window.showInformationMessage(
    `AI: ${preview}`,
    'Show Full Response',
    'Copy to Clipboard'
  ).then(choice => {
    if (choice === 'Show Full Response') {
      // Open in new untitled document
      vscode.workspace.openTextDocument({ content: result, language: 'markdown' })
        .then(doc => vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside }));
    } else if (choice === 'Copy to Clipboard') {
      vscode.env.clipboard.writeText(result);
    }
  });
}

/**
 * CodeLens provider: adds AI action buttons above function/class definitions.
 */
class AICodeLensProvider implements vscode.CodeLensProvider {
  private onAction: (action: string, code: string, filePath: string) => Promise<string>;

  constructor(onAction: (action: string, code: string, filePath: string) => Promise<string>) {
    this.onAction = onAction;
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Find function/class definitions
      if (line.match(/^(export\s+)?(async\s+)?(function|class|const|let|var)\s+\w+/)) {
        const range = new vscode.Range(i, 0, i, 0);
        lenses.push(new vscode.CodeLens(range, {
          title: '🤖 Explain',
          command: 'lambda128.inline.explain',
          arguments: [],
        }));
        lenses.push(new vscode.CodeLens(range, {
          title: '🔧 Fix',
          command: 'lambda128.inline.fix',
          arguments: [],
        }));
      }
    }
    return lenses;
  }
}