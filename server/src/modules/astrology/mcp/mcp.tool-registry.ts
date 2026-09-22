import {
  McpToolDefinition,
} from "./mcp.types";

export class McpToolRegistry {
  private readonly tools =
    new Map<
      string,
      McpToolDefinition
    >();

  register(
    tool: McpToolDefinition
  ): void {
    this.tools.set(
      tool.name,
      tool
    );
  }

  registerMany(
    tools: McpToolDefinition[]
  ): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Clears the registry and registers exactly the given
   * tools. Used when syncing from the live MCP server so
   * stale/renamed local-only tools don't linger.
   */
  replaceAll(
    tools: McpToolDefinition[]
  ): void {
    this.tools.clear();
    this.registerMany(tools);
  }

  unregister(
    toolName: string
  ): boolean {
    return this.tools.delete(
      toolName
    );
  }

  get(
    toolName: string
  ):
    | McpToolDefinition
    | undefined {
    return this.tools.get(
      toolName
    );
  }

  has(
    toolName: string
  ): boolean {
    return this.tools.has(
      toolName
    );
  }

  getAll(): McpToolDefinition[] {
    return Array.from(
      this.tools.values()
    );
  }

  getEnabled(): McpToolDefinition[] {
    return this.getAll().filter(
      (tool) =>
        tool.enabled
    );
  }

  enable(
    toolName: string
  ): void {
    const tool =
      this.tools.get(
        toolName
      );

    if (tool) {
      tool.enabled = true;
    }
  }

  disable(
    toolName: string
  ): void {
    const tool =
      this.tools.get(
        toolName
      );

    if (tool) {
      tool.enabled = false;
    }
  }
}