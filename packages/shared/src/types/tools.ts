/**
 * Tool system types.
 * Defines the tool interface, categories, permissions, and execution results.
 */

/** Categories for tool permission grouping */
export type ToolCategory = 'READ' | 'WRITE' | 'DESTROY' | 'SHELL' | 'NETWORK';

/** Permission level for a tool execution */
export type PermissionLevel = 'auto' | 'ask_once' | 'always_ask' | 'never';

/** Result of a tool execution */
export interface ToolResult {
  toolId: string;
  status: 'success' | 'error' | 'timeout' | 'denied';
  output: string;
  error?: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

/** Context passed to every tool execution */
export interface ToolExecutionContext {
  workspaceRoot: string;
  sessionId: string;
  conversationId: string;
  userId?: string;
}

/**
 * The core Tool interface.
 * Every tool (read_file, edit_file, search_files, etc.) implements this.
 */
export interface Tool {
  /** Unique identifier, e.g. 'read_file' */
  readonly id: string;
  /** Display name for UI */
  readonly name: string;
  /** Description sent to the LLM for function calling */
  readonly description: string;
  /** Category for permission grouping */
  readonly category: ToolCategory;
  /** Whether this tool requires user approval */
  readonly requiresApproval: boolean | 'configurable';
  /** JSON Schema for parameters (sent to LLM) */
  readonly parameters: ToolParameterSchema;

  /** Execute the tool with given parameters */
  execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult>;

  /** Optional: validate parameters before execution */
  validate?(params: Record<string, unknown>): ValidationResult;
}

/** JSON Schema for tool parameters (simplified) */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: { type: string };
  default?: unknown;
}

/** Result of parameter validation */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/** Permission policy for a tool category */
export interface PermissionPolicy {
  category: ToolCategory;
  level: PermissionLevel;
  /** For 'ask_once': how long does approval last? */
  approvalDuration?: 'session' | 'always';
}

/** A logged tool execution record */
export interface ToolExecutionRecord {
  id: string;
  agentSessionId?: string;
  conversationId?: string;
  toolId: string;
  parameters: Record<string, unknown>;
  result: ToolResult;
  createdAt: number;
}