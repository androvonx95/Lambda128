/**
 * Storage entity types.
 * Maps to SQLite tables for persistence.
 */

export interface Conversation {
  id: string;
  workspacePath: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  metadata?: ConversationMetadata;
}

export interface ConversationMetadata {
  modelId?: string;
  providerId?: string;
  totalTokens?: number;
  messageCount?: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: string; // JSON string
  toolCallId?: string;
  tokenUsage?: string; // JSON string
  createdAt: number;
}

export interface StoredAgentSession {
  id: string;
  conversationId: string;
  status: string;
  objective: string;
  plan?: string; // JSON string
  currentStep: number;
  maxSteps: number;
  startedAt: number;
  completedAt?: number;
}

export interface StoredPatch {
  id: string;
  conversationId: string;
  agentSessionId?: string;
  filePath: string;
  originalContent?: string;
  newContent?: string;
  diff: string;
  status: 'pending' | 'approved' | 'applied' | 'rejected';
  hunksJson?: string;
  createdAt: number;
  appliedAt?: number;
}

export interface StoredToolExecution {
  id: string;
  agentSessionId?: string;
  conversationId?: string;
  toolId: string;
  parameters: string; // JSON string
  result?: string; // JSON string
  status: string;
  durationMs: number;
  createdAt: number;
}

export interface StoredWorkspaceMeta {
  workspacePath: string;
  projectName?: string;
  languages?: string; // JSON array
  frameworks?: string; // JSON array
  fileCount: number;
  lastIndexedAt: number;
}

export interface UserSettings {
  key: string;
  value: string; // JSON
  updatedAt: number;
}

export interface RecentProject {
  path: string;
  lastOpenedAt: number;
  conversationCount: number;
}