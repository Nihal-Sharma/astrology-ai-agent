import {
  AppLogger,
} from "../../../infrastructure/observability/logger";

import {
  AstrologyMcpClient,
} from "./mcp.client";

import {
  McpCache,
  McpCacheInput,
} from "./mcp.cache";

import {
  McpToolRegistry,
} from "./mcp.tool-registry";

import {
  McpToolCallResult,
} from "./mcp.types";

export interface ExecuteToolsInput {
  tools: string[];

  arguments?: Record<
    string,
    Record<string, unknown>
  >;

  signal?: AbortSignal;
}

export class McpExecutor {
  constructor(
    private readonly client: AstrologyMcpClient,

    private readonly registry: McpToolRegistry,

    private readonly cache: McpCache,

    private readonly logger: AppLogger
  ) {}

  async execute(
    input: ExecuteToolsInput
  ): Promise<McpToolCallResult[]> {
    const tools =
      input.tools;

    if (tools.length === 0) {
      return [];
    }

    /*
     * Validate everything before executing anything.
     */
    for (const toolName of tools) {
      const tool =
        this.registry.get(
          toolName
        );

      if (!tool) {
        throw new Error(
          `Unknown MCP tool: ${toolName}`
        );
      }

      if (!tool.enabled) {
        throw new Error(
          `MCP tool is disabled: ${toolName}`
        );
      }
    }

    /*
     * Execute independent tools concurrently.
     *
     * This is important for our realtime target.
     */
    const results =
      await Promise.all(
        tools.map((toolName) =>
          this.executeOne(
            toolName,
            input
          )
        )
      );

    this.logger.debug(
      {
        module:
          "astrology-mcp",

        tools,

        count:
          results.length,
      },
      "MCP tools execution completed"
    );

    return results;
  }

  private async executeOne(
    toolName: string,
    input: ExecuteToolsInput
  ): Promise<McpToolCallResult> {
    const args =
      input.arguments?.[
        toolName
      ] ?? {};

    const cacheInput: McpCacheInput =
      {
        toolName,
        arguments: args,
      };

    const cached =
      await this.safeCacheGet<McpToolCallResult>(
        cacheInput
      );

    if (cached) {
      this.logger.debug(
        {
          module:
            "astrology-mcp",

          tool: toolName,
        },
        "MCP tool cache hit"
      );

      return cached;
    }

    const result =
      await this.client.callTool({
        toolName,

        arguments: args,

        signal: input.signal,
      });

    /*
     * Only cache successful results — never cache a
     * transient failure.
     */
    if (
      result.success &&
      !result.isError
    ) {
      await this.safeCacheSet(
        cacheInput,
        result
      );
    }

    return result;
  }

  /**
   * The cache is a best-effort optimization: if Redis is
   * unavailable, tool execution should still work, just
   * without caching.
   */
  private async safeCacheGet<T>(
    input: McpCacheInput
  ): Promise<T | null> {
    try {
      return await this.cache.get<T>(
        input
      );
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          module:
            "astrology-mcp",
          tool: input.toolName,
        },
        "MCP cache read failed — continuing without cache"
      );

      return null;
    }
  }

  private async safeCacheSet<T>(
    input: McpCacheInput,
    value: T
  ): Promise<void> {
    try {
      await this.cache.set(
        input,
        value
      );
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          module:
            "astrology-mcp",
          tool: input.toolName,
        },
        "MCP cache write failed — continuing without cache"
      );
    }
  }
}