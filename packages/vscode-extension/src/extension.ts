import * as vscode from 'vscode';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseManager, ConversationRepository, MessageRepository } from '@lambda128/storage';
import { ProviderRouter, OpenAIProvider, AnthropicProvider, GeminiProvider, OpenRouterProvider, BedrockProvider, OllamaProvider } from '@lambda128/providers';
import { ToolRegistry, ReadFileTool, EditFileTool, WriteFileTool, SearchFilesTool, GlobTool, ListDirectoryTool, GitStatusTool, GitDiffTool, DeleteFileTool, RenameFileTool, RunTerminalTool, PromptOrchestrator, AgentEngine, FileCache, TokenBudgetManager, SafetyRulesEngine, CheckpointManager, CompactionEngine } from '@lambda128/core';
import type { AgentEngineOptions } from '@lambda128/core';
import type { ContextSnapshot, FileContext, Message, ToolCall } from '@lambda128/shared';
import { WorkspaceScanner, WorkspaceIndexCache, EmbeddingEngine } from '@lambda128/repository';
import { SettingsPanelProvider } from './settings-panel.js';
import type { SettingsState, EmbeddingEstimate } from './settings-panel.js';
import { AgentProgressManager } from './agent-progress.js';
import { registerInlineActions } from './inline-actions.js';
import { ConversationHistoryProvider, registerHistoryCommands } from './history-view.js';
import { RepoMapPanelProvider } from './repo-map-view.js';
import { DiffViewManager } from './diff-view.js';
import { SecretStorageManager } from './secret-storage.js';
import { CompletionsProvider } from './completions.js';
import { loadRules, watchRules, type RulesContext } from './rules-loader.js';
import { randomUUID, createHash } from 'node:crypto';

let dbManager: DatabaseManager;
let convRepo: ConversationRepository;
let msgRepo: MessageRepository;
let providerRouter: ProviderRouter;
let toolRegistry: ToolRegistry;
let promptOrchestrator: PromptOrchestrator;
let fileCache: FileCache;
let tokenBudget: TokenBudgetManager;
let workspaceScanner: WorkspaceScanner;
let workspaceIndexCache: WorkspaceIndexCache;
let agentEngine: AgentEngine | null = null;
let chatView: vscode.WebviewView | undefined;
let currentConversationId: string | null = null;
let conversationHistory: Message[] = [];
let contextCache: { hash: string; snapshot: ContextSnapshot } | null = null;
let pendingApprovals: Map<string, (approved: boolean) => void> = new Map();
let fileWatcher: vscode.FileSystemWatcher | null = null;
let secretStorage: SecretStorageManager;
let embeddingEngine: EmbeddingEngine;

export function activate(context: vscode.ExtensionContext) {
  // Migrate API keys from plaintext config to SecretStorage (one-time)
  SecretStorageManager.migrateFromConfig(context).catch(() => {});
  secretStorage = new SecretStorageManager(context);
  embeddingEngine = new EmbeddingEngine();
  // Initialize storage
  const storageDir = join(homedir());
  dbManager = new DatabaseManager(storageDir);
  dbManager.runMigrations();
  convRepo = new ConversationRepository(dbManager.getDatabase());
  msgRepo = new MessageRepository(dbManager.getDatabase());

  // Initialize providers
  providerRouter = new ProviderRouter();
  providerRouter.register(new OpenAIProvider());
  providerRouter.register(new AnthropicProvider());
  providerRouter.register(new GeminiProvider());
  providerRouter.register(new OpenRouterProvider());
  providerRouter.register(new BedrockProvider(process.env.AWS_REGION || 'us-east-1'));
  providerRouter.register(new OllamaProvider());
  providerRouter.setDefault('anthropic');
  providerRouter.setFallbackChain(['openai', 'gemini', 'openrouter', 'bedrock']);

  // Load API keys from settings
  loadApiKeys();

  // Initialize caches
  fileCache = new FileCache(60_000);
  tokenBudget = new TokenBudgetManager(200_000, 8_192);
  workspaceScanner = new WorkspaceScanner();
  workspaceIndexCache = new WorkspaceIndexCache(storageDir);

  // Initialize tools with cache
  const readFileTool = new ReadFileTool();
  const searchFilesTool = new SearchFilesTool();
  readFileTool.setFileCache(fileCache);
  searchFilesTool.setFileCache(fileCache);
  toolRegistry = new ToolRegistry();
  toolRegistry.register(readFileTool);
  toolRegistry.register(new EditFileTool());
  toolRegistry.register(new WriteFileTool());
  toolRegistry.register(searchFilesTool);
  toolRegistry.register(new GlobTool());
  toolRegistry.register(new ListDirectoryTool());
  toolRegistry.register(new GitStatusTool());
  toolRegistry.register(new GitDiffTool());
  toolRegistry.register(new DeleteFileTool());
  toolRegistry.register(new RenameFileTool());
  toolRegistry.register(new RunTerminalTool());

  // Initialize prompt orchestrator
  promptOrchestrator = new PromptOrchestrator();

  // File watcher: invalidate caches on file changes
  if (vscode.workspace.workspaceFolders?.length) {
    fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    fileWatcher.onDidChange(uri => {
      const relPath = uri.fsPath.replace(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath + '/', '');
      fileCache?.invalidateFile(relPath);
      contextCache = null;
    });
    fileWatcher.onDidCreate(uri => { contextCache = null; });
    fileWatcher.onDidDelete(uri => { contextCache = null; });
    context.subscriptions.push(fileWatcher);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('lambda128.openChat', () => openChatPanel(context)),
    vscode.commands.registerCommand('lambda128.explainCode', () => handleInlineCommand('explain')),
    vscode.commands.registerCommand('lambda128.fixCode', () => handleInlineCommand('fix')),
    vscode.commands.registerCommand('lambda128.refactorCode', () => handleInlineCommand('refactor')),
    vscode.commands.registerCommand('lambda128.startAgent', () => startAgentMode()),
  );

  // Register webview view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lambda128.chat', {
      resolveWebviewView(webviewView) {
        chatView = webviewView;
        setupWebview(webviewView.webview, context);
      },
    })
  );

  // --- NEW: Settings Panel ---
  const settingsProvider = new SettingsPanelProvider(context, () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const cached = workspaceIndexCache.load(root);
    const fileCount = cached?.fileCount || 0;
    return SettingsPanelProvider.calculateEstimate(fileCount);
  }, embeddingEngine);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SettingsPanelProvider.viewType, settingsProvider)
  );
  settingsProvider.onSettingsChanged((state: SettingsState) => {
    loadApiKeys();
    if (state.defaultProvider) providerRouter.setDefault(state.defaultProvider);
  });

  // --- NEW: Agent Progress (Status Bar) ---
  const agentProgress = new AgentProgressManager();
  context.subscriptions.push(agentProgress);

  // --- NEW: Inline AI Actions (CodeLens + Right-Click) ---
  registerInlineActions(context, async (action, code, filePath) => {
    const prompts: Record<string, string> = {
      explain: `Explain this code:\n\`\`\`\n${code}\n\`\`\``,
      fix: `Fix bugs in this code:\n\`\`\`\n${code}\n\`\`\``,
      refactor: `Refactor this code for readability:\n\`\`\`\n${code}\n\`\`\``,
      optimize: `Optimize this code for performance:\n\`\`\`\n${code}\n\`\`\``,
    };
    const tools = toolRegistry.getDefinitionsForLLM();
    const messages = promptOrchestrator.assemble(prompts[action] || prompts.explain, [], { tools });
    const { response } = await providerRouter.chat(messages, { model: 'claude-sonnet-4-20250514', maxTokens: 2048 });
    return response.content;
  });

  // --- NEW: Conversation History Sidebar ---
  const historyProvider = new ConversationHistoryProvider(convRepo);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('lambda128.history', historyProvider)
  );
  registerHistoryCommands(context, convRepo,
    async (id: string) => {
      currentConversationId = id;
      const msgs = msgRepo.getByConversation(id);
      conversationHistory = msgs.map(m => ({
        id: m.id, role: m.role as any, content: m.content,
        toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
        toolCallId: m.toolCallId, createdAt: m.createdAt,
      }));
      openChatPanel(context);
      // History loaded messages will be sent once the webview view resolves
      setTimeout(() => {
        if (chatView?.webview) {
          chatView.webview.postMessage({ type: 'chat:historyLoaded', payload: { messages: conversationHistory } });
        }
      }, 300);
    },
    (id: string) => {
      convRepo.delete(id);
      if (currentConversationId === id) {
        currentConversationId = null;
        conversationHistory = [];
      }
      historyProvider.refresh();
    }
  );

  // --- NEW: Repo Map Panel ---
  const repoMapProvider = new RepoMapPanelProvider(embeddingEngine);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RepoMapPanelProvider.viewType, repoMapProvider)
  );
  // Refresh repo map when workspace changes
  if (vscode.workspace.workspaceFolders?.length) {
    repoMapProvider.refresh();
  }

  // --- NEW: Tab Autocomplete (FIM) ---
  const completionsProvider = new CompletionsProvider(providerRouter);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**/*' },
      completionsProvider,
    ),
  );

  // --- NEW: Diff View Manager ---
  const diffManager = new DiffViewManager(storageDir);
  diffManager.onApply(async (filePath, content) => {
    // File already written by applyApproved, just notify
    fileCache?.invalidateFile(filePath);
  });

  vscode.window.showInformationMessage('lambda128 activated');
}

async function loadApiKeys() {
  if (!secretStorage) return;
  const keys = await secretStorage.getAllApiKeys();
  for (const [id, key] of Object.entries(keys)) {
    if (key) {
      const provider = providerRouter.getProvider(id);
      if (provider && 'setApiKey' in provider) (provider as any).setApiKey(key);
    }
  }
}

function openChatPanel(context: vscode.ExtensionContext) {
  // Focus the sidebar chat view (already initialized by WebviewViewProvider)
  vscode.commands.executeCommand('workbench.view.extension.lambda128');
}

function setupWebview(webview: vscode.Webview, context: vscode.ExtensionContext) {
  webview.options = { enableScripts: true };

  webview.html = getWebviewContent();

  webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
      case 'chat:send':
        await handleChatMessage(message.payload.message, webview);
        break;
      case 'chat:regenerate':
        await handleRegenerate(webview);
        break;
      case 'settings:set':
        await handleSettingsUpdate(message.payload, webview);
        break;
      case 'tool:approvalResponse': {
        const { toolId, approved } = message.payload;
        const resolver = pendingApprovals.get(toolId);
        if (resolver) { resolver(approved); pendingApprovals.delete(toolId); }
        break;
      }
      case 'agent:start':
        await startAgentWithPrompt(message.payload.objective, webview);
        break;
      case 'agent:stop':
        agentEngine?.stop();
        break;
      case 'chat:newConversation':
        currentConversationId = null;
        conversationHistory = [];
        webview.postMessage({ type: 'chat:newConversationReady', payload: {} });
        break;
      case 'chat:toggleSidebar':
        vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
        break;
    }
  });
}

async function handleChatMessage(userMessage: string, webview: vscode.Webview) {
  try {
    // Detect agent mode
    if (userMessage.startsWith('/agent ') || userMessage.startsWith('@agent ')) {
      const objective = userMessage.replace(/^\/(agent|@agent)\s+/, '');
      await startAgentWithPrompt(objective, webview);
      return;
    }

    // Create conversation if needed
    if (!currentConversationId) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || homedir();
      const conv = convRepo.create(workspaceRoot, userMessage.substring(0, 50));
      currentConversationId = conv.id;
    }

    // Gather context
    const context = await gatherContext();

    // Build messages
    const tools = toolRegistry.getDefinitionsForLLM();
    const messages = promptOrchestrator.assemble(userMessage, conversationHistory, { context, tools });

    // Save user message
    const userMsg: Message = {
      id: randomUUID(),
      role: 'user',
      content: userMessage,
      createdAt: Date.now(),
    };
    conversationHistory.push(userMsg);
    msgRepo.create({
      id: userMsg.id,
      conversationId: currentConversationId,
      role: 'user',
      content: userMessage,
    });

    // Multi-turn tool-calling loop
    let turnMessages = messages;
    let maxTurns = 5;

    while (maxTurns-- > 0) {
      let fullContent = '';
      let toolCalls: ToolCall[] | undefined;

      webview.postMessage({ type: 'chat:streamStart', payload: {} });

      for await (const chunk of providerRouter.chatStream(turnMessages, {
        model: 'claude-sonnet-4-20250514',
        tools,
        maxTokens: 4096,
      })) {
        if (chunk.contentDelta) {
          fullContent += chunk.contentDelta;
          webview.postMessage({
            type: 'chat:streamChunk',
            payload: { contentDelta: chunk.contentDelta },
          });
        }
        if (chunk.toolCallDelta) {
          if (!toolCalls) toolCalls = [];
          const delta = chunk.toolCallDelta as any;
          const existing = toolCalls.find(t => t.id === delta?.id);
          if (existing) {
            if (delta?.name) existing.name = delta.name;
            if (delta?.arguments) existing.arguments = { ...existing.arguments, ...safeParseJSON(delta.arguments) };
          } else if (delta) {
            toolCalls.push({
              id: delta.id || randomUUID(),
              name: delta.name || '',
              arguments: safeParseJSON(delta.arguments || '{}'),
            });
          }
          webview.postMessage({
            type: 'chat:toolCallDelta',
            payload: chunk.toolCallDelta,
          });
        }
      }

      webview.postMessage({ type: 'chat:streamEnd', payload: {} });

      // Save assistant message
      const assistantMsg: Message = {
        id: randomUUID(),
        role: 'assistant',
        content: fullContent,
        toolCalls,
        createdAt: Date.now(),
      };
      conversationHistory.push(assistantMsg);
      msgRepo.create({
        id: assistantMsg.id,
        conversationId: currentConversationId,
        role: 'assistant',
        content: fullContent,
        toolCalls: toolCalls ? JSON.stringify(toolCalls) : undefined,
      });

      // If no tool calls, we're done
      if (!toolCalls || toolCalls.length === 0) break;

      // Execute tool calls
      webview.postMessage({ type: 'chat:toolExecuting', payload: { count: toolCalls.length } });

      for (const tc of toolCalls) {
        try {
          // Check permissions
          const tool = toolRegistry.get(tc.name);
          const needsApproval = tool?.requiresApproval !== false;

          if (needsApproval) {
            const approved = await new Promise<boolean>((resolve) => {
              const approvalId = randomUUID();
              pendingApprovals.set(approvalId, resolve);
              webview.postMessage({
                type: 'tool:approvalRequest',
                payload: {
                  approvalId,
                  toolId: tc.name,
                  toolName: tc.name,
                  params: tc.arguments,
                  reason: `AI wants to run ${tc.name}`,
                },
              });
              setTimeout(() => {
                if (pendingApprovals.has(approvalId)) {
                  pendingApprovals.get(approvalId)!(false);
                  pendingApprovals.delete(approvalId);
                }
              }, 60_000);
            });

            if (!approved) {
              const deniedMsg: Message = {
                id: randomUUID(),
                role: 'tool',
                content: `Tool ${tc.name} was denied by user.`,
                toolCallId: tc.id,
                createdAt: Date.now(),
              };
              conversationHistory.push(deniedMsg);
              continue;
            }
          }

          // Execute the tool
          const result = await toolRegistry.execute(tc.name, tc.arguments as Record<string, unknown>, {
            workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || homedir(),
            sessionId: currentConversationId || 'unknown',
            conversationId: currentConversationId || 'unknown',
          });

          webview.postMessage({
            type: 'chat:toolResult',
            payload: { toolName: tc.name, status: result.status, summary: result.output?.substring(0, 200) },
          });

          // Add tool result to conversation
          const toolMsg: Message = {
            id: randomUUID(),
            role: 'tool',
            content: result.output || result.error || 'Tool executed',
            toolCallId: tc.id,
            createdAt: Date.now(),
          };
          conversationHistory.push(toolMsg);
          msgRepo.create({
            id: toolMsg.id,
            conversationId: currentConversationId,
            role: 'tool',
            content: toolMsg.content,
            toolCallId: tc.id,
          });
        } catch (err: any) {
          const errorMsg: Message = {
            id: randomUUID(),
            role: 'tool',
            content: `Error executing ${tc.name}: ${err.message}`,
            toolCallId: tc.id,
            createdAt: Date.now(),
          };
          conversationHistory.push(errorMsg);
        }
      }

      // Build next turn messages with tool results
      turnMessages = promptOrchestrator.assemble(
        'Continue based on tool results.',
        conversationHistory,
        { context, tools }
      );
    }

    convRepo.touch(currentConversationId);
  } catch (err: any) {
    webview.postMessage({
      type: 'chat:error',
      payload: { message: err.message || 'An error occurred' },
    });
  }
}

function safeParseJSON(str: string): Record<string, unknown> {
  try { return JSON.parse(str); } catch { return {}; }
}

async function handleRegenerate(webview: vscode.Webview) {
  // Remove last assistant message and retry
  if (conversationHistory.length >= 2) {
    const lastMsg = conversationHistory[conversationHistory.length - 1];
    if (lastMsg.role === 'assistant') {
      conversationHistory.pop();
      const userMsg = conversationHistory[conversationHistory.length - 1];
      if (userMsg.role === 'user') {
        await handleChatMessage(userMsg.content, webview);
      }
    }
  }
}

async function handleSettingsUpdate(payload: any, webview: vscode.Webview) {
  const config = vscode.workspace.getConfiguration('lambda128');
  if (payload.openaiApiKey) {
    await config.update('openaiApiKey', payload.openaiApiKey, true);
    const provider = providerRouter.getProvider('openai') as OpenAIProvider;
    provider?.setApiKey(payload.openaiApiKey);
  }
  if (payload.anthropicApiKey) {
    await config.update('anthropicApiKey', payload.anthropicApiKey, true);
    const provider = providerRouter.getProvider('anthropic') as AnthropicProvider;
    provider?.setApiKey(payload.anthropicApiKey);
  }
  if (payload.defaultProvider) {
    providerRouter.setDefault(payload.defaultProvider);
  }
  webview.postMessage({ type: 'settings:saved', payload: {} });
}

async function handleInlineCommand(action: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const filePath = editor.document.uri.fsPath;

  if (!selectedText && action !== 'explain') {
    vscode.window.showWarningMessage('Please select some code first.');
    return;
  }

  const prompts: Record<string, string> = {
    explain: `Explain the following code from ${filePath}:\n\n\`\`\`\n${selectedText || editor.document.getText()}\n\`\`\``,
    fix: `Fix any bugs or issues in this code from ${filePath}:\n\n\`\`\`\n${selectedText}\n\`\`\``,
    refactor: `Refactor this code from ${filePath} to improve readability and maintainability:\n\n\`\`\`\n${selectedText}\n\`\`\``,
  };

  // Focus sidebar and show inline prompt
  vscode.commands.executeCommand('workbench.view.extension.lambda128');
  if (chatView?.webview) {
    // Directly send via chat:send to trigger the AI response
    chatView.webview.postMessage({
      type: 'chat:send',
      payload: { message: prompts[action] },
    });
  }
}

async function startAgentMode() {
  const objective = await vscode.window.showInputBox({
    prompt: 'What should the AI agent do?',
    placeHolder: 'e.g., Add error handling to all API routes',
  });

  if (!objective) return;

  openChatPanel({ subscriptions: [] } as any);
  if (chatView?.webview) {
    await startAgentWithPrompt(objective, chatView.webview);
  }
}

async function startAgentWithPrompt(objective: string, webview: vscode.Webview) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || homedir();
  const context = await gatherContext();

  agentEngine = new AgentEngine({
    providerRouter,
    toolRegistry,
    promptOrchestrator,
    tokenBudget,
    workspaceRoot,
    onProgress: (progress) => {
      webview.postMessage({ type: 'agent:progress', payload: progress });
    },
    onApprovalRequired: async (toolId, params) => {
      return new Promise((resolve) => {
        const approvalId = randomUUID();
        pendingApprovals.set(approvalId, resolve);
        webview.postMessage({
          type: 'tool:approvalRequest',
          payload: { approvalId, toolId, toolName: toolId, params, reason: `Agent wants to run ${toolId}` },
        });
        // Auto-deny after 60s
        setTimeout(() => {
          if (pendingApprovals.has(approvalId)) {
            pendingApprovals.get(approvalId)!(false);
            pendingApprovals.delete(approvalId);
          }
        }, 60_000);
      });
    },
  });

  try {
    const session = await agentEngine.run(objective, context);
    webview.postMessage({ type: 'agent:complete', payload: session });
  } catch (err: any) {
    webview.postMessage({ type: 'agent:error', payload: { message: err.message } });
  }
}

async function gatherContext(): Promise<ContextSnapshot> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || homedir();
  const editor = vscode.window.activeTextEditor;

  const ctxParts = [workspaceRoot];
  if (editor) {
    ctxParts.push(editor.document.uri.fsPath, String(editor.document.version));
    if (!editor.selection.isEmpty) ctxParts.push(editor.document.getText(editor.selection));
  }
  const ctxHash = createHash('md5').update(ctxParts.join(':')).digest('hex');

  // Return cached context if nothing changed
  if (contextCache && contextCache.hash === ctxHash) return contextCache.snapshot;

  const activeFile: FileContext | undefined = editor ? {
    path: editor.document.uri.fsPath.replace(workspaceRoot + '/', ''),
    content: editor.document.getText(),
    language: editor.document.languageId,
    selection: editor.selection.isEmpty ? undefined : {
      startLine: editor.selection.start.line + 1,
      endLine: editor.selection.end.line + 1,
      startColumn: editor.selection.start.character,
      endColumn: editor.selection.end.character,
    },
    lastModified: Date.now(),
  } : undefined;

  const openEditors: FileContext[] = vscode.window.visibleTextEditors
    .filter(e => e !== editor)
    .map(e => ({
      path: e.document.uri.fsPath.replace(workspaceRoot + '/', ''),
      language: e.document.languageId,
      lastModified: Date.now(),
    }));

  // Repository intelligence: load or scan workspace
  let projectStructure: string | undefined;
  let repoMeta: Record<string, unknown> | undefined;
  const cachedIndex = workspaceIndexCache.load(workspaceRoot);
  if (cachedIndex) {
    projectStructure = cachedIndex.tree;
    repoMeta = { languages: cachedIndex.languages, frameworks: cachedIndex.frameworks, fileCount: cachedIndex.fileCount };
  } else {
    try {
      const files = await workspaceScanner.scan(workspaceRoot, 2000);
      const tree = await workspaceScanner.generateTree(workspaceRoot, 3);
      const languages = workspaceScanner.detectLanguages(files);
      const frameworks = workspaceScanner.detectFrameworks(files);
      projectStructure = tree;
      repoMeta = { languages, frameworks, fileCount: files.length };
      workspaceIndexCache.save(workspaceRoot, {
        projectName: workspaceRoot.split('/').pop() || 'project',
        rootPath: workspaceRoot, languages, frameworks, fileCount: files.length,
        tree, indexedAt: Date.now(),
      });
    } catch { /* scan failed, continue without */ }
  }

  const snapshot: ContextSnapshot = {
    workspaceRoot, activeFile, openEditors,
    selectedCode: editor ? editor.document.getText(editor.selection) : undefined,
    projectStructure, recentFiles: [], timestamp: Date.now(),
  };

  // Cache for reuse
  contextCache = { hash: ctxHash, snapshot };
  return snapshot;
}

function getWebviewContent(): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(__dirname, 'webview.html'), 'utf-8');
}

export function deactivate() {
  dbManager?.close();
}