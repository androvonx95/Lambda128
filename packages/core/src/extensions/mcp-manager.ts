/**
 * MCP (Model Context Protocol) Manager — ported patterns from Cline's production SDK.
 * 
 * Manages MCP server connections, tool discovery, and lifecycle.
 * MCP allows external tools to be registered as agent tools via stdio or SSE transport.
 * 
 * @see Cline: sdk/packages/core/src/extensions/mcp/manager.ts
 * @see Cline: sdk/packages/core/src/extensions/mcp/client.ts
 */
import type { ToolDefinition } from '@lambda128/shared';

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  timeout?: number;
}

export interface MCPToolInfo {
  serverName: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP Manager: discovers and manages MCP server connections.
 * In MVP, this is a stub that can be extended with full MCP support.
 */
export class MCPManager {
  private servers: Map<string, MCPServerConfig> = new Map();
  private tools: Map<string, MCPToolInfo[]> = new Map();
  private enabled = false;

  /**
   * Register an MCP server configuration.
   */
  registerServer(config: MCPServerConfig): void {
    this.servers.set(config.name, config);
  }

  /**
   * Remove an MCP server configuration.
   */
  unregisterServer(name: string): void {
    this.servers.delete(name);
    this.tools.delete(name);
  }

  /**
   * Get all registered server configs.
   */
  getServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Enable or disable MCP support.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if MCP is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Discover tools from all enabled MCP servers.
   * In MVP, returns an empty list. Full implementation would:
   * 1. Spawn each server process
   * 2. Send tools/list request via JSON-RPC over stdio
   * 3. Parse and register discovered tools
   */
  async discoverTools(): Promise<MCPToolInfo[]> {
    if (!this.enabled) return [];

    const allTools: MCPToolInfo[] = [];
    for (const [name, config] of this.servers) {
      if (!config.enabled) continue;
      // Stub: In full implementation, spawn process and discover tools
      const serverTools = this.tools.get(name) || [];
      allTools.push(...serverTools);
    }
    return allTools;
  }

  /**
   * Convert MCP-discovered tools to agent tool definitions.
   */
  toAgentToolDefinitions(mcpTools: MCPToolInfo[]): ToolDefinition[] {
    return mcpTools.map(t => ({
      name: `mcp__${t.serverName}__${t.toolName}`,
      description: `[MCP:${t.serverName}] ${t.description}`,
      parameters: {
        type: 'object' as const,
        properties: t.inputSchema.properties as Record<string, any> || {},
        required: t.inputSchema.required as string[] | undefined,
      },
    }));
  }

  /**
   * Execute an MCP tool.
   * In MVP, this is a stub. Full implementation would:
   * 1. Find the server that owns the tool
   * 2. Send tools/call request via JSON-RPC
   * 3. Return the result
   */
  async executeTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!this.enabled) throw new Error('MCP is not enabled');
    const config = this.servers.get(serverName);
    if (!config || !config.enabled) throw new Error(`MCP server "${serverName}" not found or disabled`);
    // Stub: In full implementation, call the tool via JSON-RPC
    return `[MCP stub] Tool "${toolName}" on server "${serverName}" would execute with args: ${JSON.stringify(args)}`;
  }

  /**
   * Load MCP server configs from a JSON config file.
   */
  static fromConfig(configs: MCPServerConfig[]): MCPManager {
    const manager = new MCPManager();
    for (const config of configs) {
      manager.registerServer(config);
    }
    return manager;
  }
}