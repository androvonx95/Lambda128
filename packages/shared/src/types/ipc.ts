/**
 * IPC message contracts between webview and extension host.
 */

/** All possible IPC message types */
export type IPCMessageType =
  // Chat
  | 'chat:send'
  | 'chat:response'
  | 'chat:streamChunk'
  | 'chat:error'
  | 'chat:regenerate'
  | 'chat:cancel'
  // Agent
  | 'agent:start'
  | 'agent:stop'
  | 'agent:progress'
  | 'agent:complete'
  | 'agent:error'
  // Tools
  | 'tool:approvalRequest'
  | 'tool:approvalResponse'
  | 'tool:executionResult'
  // Conversations
  | 'conversation:list'
  | 'conversation:load'
  | 'conversation:delete'
  | 'conversation:create'
  // Settings
  | 'settings:get'
  | 'settings:set'
  | 'settings:getAll'
  // Context
  | 'context:update'
  | 'context:request';

/** Base IPC message */
export interface IPCMessage {
  type: IPCMessageType;
  id: string;
  payload: unknown;
  timestamp: number;
}

/** Request message (expects a response) */
export interface IPCRequest<T = unknown> extends IPCMessage {
  type: IPCMessageType;
  payload: T;
}

/** Response message */
export interface IPCResponse<T = unknown> extends IPCMessage {
  type: IPCMessageType;
  payload: T;
  error?: string;
}

/** Chat send request */
export interface ChatSendPayload {
  conversationId: string;
  message: string;
  context?: {
    activeFile?: string;
    selectedCode?: string;
  };
}

/** Chat stream chunk */
export interface ChatStreamChunk {
  conversationId: string;
  messageId: string;
  contentDelta: string;
  toolCallDelta?: {
    id?: string;
    name?: string;
    arguments?: string;
  };
}

/** Tool approval request sent to webview */
export interface ToolApprovalRequest {
  toolId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  reason: string;
}

/** Tool approval response from webview */
export interface ToolApprovalResponse {
  approved: boolean;
  modifications?: Record<string, unknown>;
}

/** Agent progress update */
export interface AgentProgressPayload {
  sessionId: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  currentAction: string;
}