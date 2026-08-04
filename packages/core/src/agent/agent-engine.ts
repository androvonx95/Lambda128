import type {
  Message, ToolCall, ChatOptions, ToolResult,
  AgentSession, AgentStatus, AgentProgress, ToolExecutionSummary,
  ContextSnapshot
} from '@lambda128/shared';
import { LIMITS } from '@lambda128/shared';
import type { ProviderRouter } from '@lambda128/providers';
import type { ToolRegistry } from '../tools/registry.js';
import type { PromptOrchestrator } from '../prompt/orchestrator.js';
import type { TokenBudgetManager } from '../cache/token-budget.js';
import type { SafetyRulesEngine } from './safety-rules.js';
import type { CheckpointManager } from './checkpoint.js';
import type { CompactionEngine } from './compaction.js';
import { randomUUID } from 'node:crypto';

/** Deterministic key-sorting for loop-detection signatures */
function sortKeys(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export interface AgentEngineOptions {
  providerRouter: ProviderRouter;
  toolRegistry: ToolRegistry;
  promptOrchestrator: PromptOrchestrator;
  tokenBudget: TokenBudgetManager;
  workspaceRoot: string;
  model?: string;
  providerId?: string;
  maxSteps?: number;
  onProgress?: (progress: AgentProgress) => void;
  onApprovalRequired?: (toolId: string, params: Record<string, unknown>) => Promise<boolean>;
}

/**
 * Agent Engine: the core execution loop.
 * Implements: Plan → Execute → Observe → Replan
 */
export class AgentEngine {
  private providerRouter: ProviderRouter;
  private toolRegistry: ToolRegistry;
  private promptOrchestrator: PromptOrchestrator;
  private tokenBudget: TokenBudgetManager;
  private workspaceRoot: string;
  private model: string;
  private providerId?: string;
  private maxSteps: number;
  private onProgress?: (progress: AgentProgress) => void;
  private onApprovalRequired?: (toolId: string, params: Record<string, unknown>) => Promise<boolean>;

  private session: AgentSession | null = null;
  private history: Message[] = [];
  private abortController: AbortController | null = null;

  // Safety, compaction, and checkpoint engines (optional, can be set after construction)
  public safetyEngine?: SafetyRulesEngine;
  public checkpointManager?: CheckpointManager;
  public compactionEngine?: CompactionEngine;

  // Loop detection: prevents agent from calling same tool with identical params repeatedly
  private loopState = { lastToolName: '', lastToolSignature: '', consecutiveIdenticalCount: 0 };
  private readonly MAX_CONSECUTIVE_IDENTICAL = 3;
  private mistakeCount = 0;
  private readonly MAX_MISTAKES = 5;

  constructor(options: AgentEngineOptions) {
    this.providerRouter = options.providerRouter;
    this.toolRegistry = options.toolRegistry;
    this.promptOrchestrator = options.promptOrchestrator;
    this.tokenBudget = options.tokenBudget;
    this.workspaceRoot = options.workspaceRoot;
    this.model = options.model || 'claude-sonnet-4-20250514';
    this.providerId = options.providerId;
    this.maxSteps = options.maxSteps || LIMITS.MAX_AGENT_STEPS;
    this.onProgress = options.onProgress;
    this.onApprovalRequired = options.onApprovalRequired;
  }

  /**
   * Start an agent session to accomplish an objective.
   */
  async run(objective: string, context?: ContextSnapshot): Promise<AgentSession> {
    const sessionId = randomUUID();
    const conversationId = randomUUID();

    this.session = {
      id: sessionId,
      conversationId,
      status: 'planning',
      objective,
      currentStep: 0,
      maxSteps: this.maxSteps,
      startedAt: Date.now(),
    };

    this.history = [];
    this.abortController = new AbortController();
    this.tokenBudget.reset();

    this.emitProgress();

    try {
      // Phase 1: Planning
      this.updateStatus('planning');
      const plan = await this.plan(objective, context);
      this.session.plan = plan;
      this.emitProgress();

      // Phase 2: Execution loop
      for (const step of plan.steps) {
        if (this.abortController.signal.aborted) break;

        this.session.currentStep++;
        this.updateStatus('executing');
        step.status = 'in_progress';
        step.startedAt = Date.now();
        this.emitProgress();

        try {
          const result = await this.executeStep(step.description, context);
          step.status = 'completed';
          step.result = result;
          step.completedAt = Date.now();
        } catch (err: any) {
          step.status = 'failed';
          step.result = err.message;
          step.completedAt = Date.now();

          // Check if we should continue despite failure
          if (this.session.currentStep >= this.maxSteps) {
            throw err;
          }
        }

        this.updateStatus('observing');
        this.emitProgress();
      }

      this.session.status = 'completed';
      this.session.completedAt = Date.now();
    } catch (err: any) {
      this.session.status = 'failed';
      this.session.completedAt = Date.now();
    }

    this.emitProgress();
    return this.session;
  }

  /**
   * Stop the agent execution.
   */
  stop(): void {
    this.abortController?.abort();
    if (this.session) {
      this.session.status = 'paused';
      this.emitProgress();
    }
  }

  /**
   * Get the current conversation history.
   */
  getHistory(): Message[] {
    return this.history;
  }

  /**
   * Planning phase: decompose the objective into steps.
   */
  private async plan(objective: string, context?: ContextSnapshot): Promise<import('@lambda128/shared').AgentPlan> {
    const planPrompt = `You are planning a coding task. Break down the following objective into clear, sequential steps.

Objective: ${objective}

Respond with a JSON array of steps. Each step should have:
- "description": what needs to be done
- "tools": suggested tools to use (read_file, edit_file, write_file, search_files, etc.)

Keep steps focused and actionable. Output ONLY valid JSON.`;

    const messages = this.promptOrchestrator.assemble(planPrompt, [], { context, includeHistory: false });
    const tools = this.toolRegistry.getDefinitionsForLLM();

    try {
      const { response } = await this.providerRouter.chat(
        messages,
        { model: this.model, tools, maxTokens: 2000 },
        this.providerId
      );

      // Try to parse the plan from the response
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const steps = JSON.parse(jsonMatch[0]);
        return {
          steps: steps.map((s: any, i: number) => ({
            id: `step-${i + 1}`,
            description: s.description,
            status: 'pending' as const,
          })),
          reasoning: response.content,
          createdAt: Date.now(),
        };
      }
    } catch {
      // Fallback: single-step plan
    }

    // Fallback plan
    return {
      steps: [{
        id: 'step-1',
        description: objective,
        status: 'pending' as const,
      }],
      reasoning: 'Direct execution',
      createdAt: Date.now(),
    };
  }

  /**
   * Execute a single step in the agent loop.
   */
  private async executeStep(stepDescription: string, context?: ContextSnapshot): Promise<string> {
    const tools = this.toolRegistry.getDefinitionsForLLM();
    const messages = this.promptOrchestrator.assemble(
      `Execute this step: ${stepDescription}`,
      this.history,
      { context, tools }
    );

    let continueLoop = true;
    let loopCount = 0;
    const maxLoops = 5; // Max tool-call loops per step

    while (continueLoop && loopCount < maxLoops) {
      loopCount++;

      // Check token budget before sending
      const estimatedTokens = this.promptOrchestrator.estimateTokens(messages);
      const budgetState = this.tokenBudget.getState();
      if (budgetState.isCritical) {
        // Trim history to fit
        const trimmed = this.tokenBudget.trimHistory(this.history);
        this.history = trimmed;
        // Rebuild messages with trimmed history
        messages.length = 0;
        messages.push(...this.promptOrchestrator.assemble(
          `Execute this step: ${stepDescription}`,
          this.history,
          { context, tools }
        ));
      }

      const { response, providerId } = await this.providerRouter.chat(
        messages,
        { model: this.model, tools, maxTokens: 4096 },
        this.providerId
      );

      // Track token usage
      if (response.usage) {
        this.tokenBudget.trackUsage(response.usage.prompt, response.usage.completion);
      }

      // Add assistant response to history
      const assistantMsg: Message = {
        id: randomUUID(),
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
        tokenUsage: response.usage,
        createdAt: Date.now(),
      };
      this.history.push(assistantMsg);
      messages.push(assistantMsg);

      // If no tool calls, we're done with this step
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return response.content;
      }

      // Execute tool calls
      for (const toolCall of response.toolCalls) {
        // --- LOOP DETECTION: catch repeated identical tool calls ---
        const sig = toolCall.name + ':' + JSON.stringify(sortKeys(toolCall.arguments));
        if (sig === this.loopState.lastToolSignature) {
          this.loopState.consecutiveIdenticalCount++;
          if (this.loopState.consecutiveIdenticalCount >= this.MAX_CONSECUTIVE_IDENTICAL) {
            const loopMsg: Message = {
              id: randomUUID(),
              role: 'tool',
              content: `Loop detected: same tool call repeated ${this.loopState.consecutiveIdenticalCount} times. Stopping.`,
              toolCallId: toolCall.id,
              createdAt: Date.now(),
            };
            this.history.push(loopMsg);
            messages.push(loopMsg);
            continueLoop = false;
            break;
          }
        } else {
          this.loopState = { lastToolName: toolCall.name, lastToolSignature: sig, consecutiveIdenticalCount: 1 };
        }

        // Check approval for write/destructive tools
        const tool = this.toolRegistry.get(toolCall.name);
        if (tool && (tool.requiresApproval === true || tool.category === 'WRITE' || tool.category === 'DESTROY')) {
          if (this.onApprovalRequired) {
            const approved = await this.onApprovalRequired(toolCall.name, toolCall.arguments);
            if (!approved) {
              const deniedMsg: Message = {
                id: randomUUID(),
                role: 'tool',
                content: 'User denied this tool execution.',
                toolCallId: toolCall.id,
                createdAt: Date.now(),
              };
              this.history.push(deniedMsg);
              messages.push(deniedMsg);
              continue;
            }
          }
        }

        // --- SAFETY CHECK: run safety rules engine before execution ---
        if (this.safetyEngine) {
          const safetyResult = this.safetyEngine.evaluate({
            toolName: toolCall.name,
            params: toolCall.arguments,
            workspaceRoot: this.workspaceRoot,
            sessionId: this.session?.id || '',
          });
          if (!safetyResult.allowed && safetyResult.category === 'block') {
            const blockedMsg: Message = {
              id: randomUUID(),
              role: 'tool',
              content: `Safety check blocked: ${safetyResult.reason}`,
              toolCallId: toolCall.id,
              createdAt: Date.now(),
            };
            this.history.push(blockedMsg);
            messages.push(blockedMsg);
            continue;
          }
        }

        // --- CHECKPOINT: snapshot files before write/edit/delete ---
        if (this.checkpointManager && ['write_file', 'edit_file', 'delete_file', 'rename_file'].includes(toolCall.name)) {
          this.checkpointManager.snapshotForTool(toolCall.name, toolCall.arguments);
        }

        // Execute the tool
        const result = await this.toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          {
            workspaceRoot: this.workspaceRoot,
            sessionId: this.session?.id || '',
            conversationId: this.session?.conversationId || '',
          }
        );

        // Add tool result to history
        const toolMsg: Message = {
          id: randomUUID(),
          role: 'tool',
          content: result.status === 'success'
            ? result.output
            : `Error: ${result.error}`,
          toolCallId: toolCall.id,
          createdAt: Date.now(),
        };
        this.history.push(toolMsg);
        messages.push(toolMsg);
      }

      // Check if we should continue the loop
      continueLoop = response.finishReason === 'tool_calls';
    }

    return 'Step completed';
  }

  private updateStatus(status: AgentStatus): void {
    if (this.session) {
      this.session.status = status;
    }
  }

  private emitProgress(): void {
    if (!this.session || !this.onProgress) return;

    const toolResults: ToolExecutionSummary[] = this.history
      .filter(m => m.role === 'tool')
      .slice(-5)
      .map(m => ({
        toolId: m.toolCallId || 'unknown',
        status: m.content.startsWith('Error') ? 'error' as const : 'success' as const,
        summary: m.content.substring(0, 100),
        durationMs: 0,
      }));

    this.onProgress({
      sessionId: this.session.id,
      status: this.session.status,
      currentStep: this.session.currentStep,
      totalSteps: this.session.plan?.steps.length || 1,
      currentAction: this.session.plan?.steps[this.session.currentStep - 1]?.description || 'Working...',
      toolResults,
    });
  }
}