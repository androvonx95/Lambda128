/**
 * Agent system types.
 * Defines agent sessions, steps, plans, and execution state.
 */

export type AgentStatus = 'idle' | 'planning' | 'executing' | 'observing' | 'waiting_approval' | 'paused' | 'completed' | 'failed';

export interface AgentSession {
  id: string;
  conversationId: string;
  status: AgentStatus;
  objective: string;
  plan?: AgentPlan;
  currentStep: number;
  maxSteps: number;
  startedAt: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentPlan {
  steps: AgentStep[];
  reasoning: string;
  createdAt: number;
}

export interface AgentStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  toolCalls?: string[];
  result?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentProgress {
  sessionId: string;
  status: AgentStatus;
  currentStep: number;
  totalSteps: number;
  currentAction: string;
  toolResults: ToolExecutionSummary[];
}

export interface ToolExecutionSummary {
  toolId: string;
  status: 'success' | 'error' | 'timeout' | 'denied';
  summary: string;
  durationMs: number;
}