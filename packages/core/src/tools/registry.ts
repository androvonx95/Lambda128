import type { Tool, ToolResult, ToolExecutionContext, ToolDefinition, ValidationResult } from '@lambda128/shared';

/**
 * Tool registry: manages all available tools.
 * Tools are registered here and exposed to the LLM via function calling.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool '${tool.id}' is already registered`);
    }
    this.tools.set(tool.id, tool);
  }

  unregister(toolId: string): void {
    this.tools.delete(toolId);
  }

  get(toolId: string): Tool | undefined {
    return this.tools.get(toolId);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool definitions formatted for LLM function calling.
   */
  getDefinitionsForLLM(): ToolDefinition[] {
    return this.list().map(tool => ({
      name: tool.id,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }

  /**
   * Execute a tool by ID with the given parameters.
   */
  async execute(
    toolId: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return {
        toolId,
        status: 'error',
        output: '',
        error: `Unknown tool: ${toolId}`,
        durationMs: 0,
      };
    }

    // Validate parameters if the tool has a validator
    if (tool.validate) {
      const validation = tool.validate(params);
      if (!validation.valid) {
        return {
          toolId,
          status: 'error',
          output: '',
          error: `Invalid parameters: ${validation.errors?.join(', ')}`,
          durationMs: 0,
        };
      }
    }

    const startTime = Date.now();
    try {
      const result = await tool.execute(params, context);
      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        toolId,
        status: 'error',
        output: '',
        error: err.message || 'Tool execution failed',
        durationMs: Date.now() - startTime,
      };
    }
  }
}