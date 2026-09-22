import {
  AppLogger,
} from "../../../infrastructure/observability/logger";

import {
  AstrologyMcpClient,
} from "./mcp.client";

import {
  McpToolRegistry,
} from "./mcp.tool-registry";

/**
 * Replaces the registry's contents with the live tool list
 * from the connected MCP server.
 *
 * Call once at boot, after `AstrologyMcpClient.connect()` has
 * already succeeded. The registry should already contain the
 * bundled local catalog as a seed — if this sync fails, that
 * seed is left in place rather than leaving the app with no
 * tools at all.
 */
export async function syncAstrologyToolsFromServer(
  client: AstrologyMcpClient,
  registry: McpToolRegistry,
  logger: AppLogger
): Promise<void> {
  try {
    const tools =
      await client.listTools();

    if (tools.length === 0) {
      logger.warn(
        {
          module: "astrology-mcp",
        },
        "MCP server returned zero tools — keeping existing (fallback) tool registry"
      );

      return;
    }

    registry.replaceAll(tools);

    logger.info(
      {
        module: "astrology-mcp",

        toolCount: tools.length,
      },
      "Astrology tool registry synced from live MCP server"
    );
  } catch (error) {
    logger.error(
      {
        err: error,

        module: "astrology-mcp",
      },
      "Failed to sync tools from MCP server — keeping existing (fallback) tool registry"
    );
  }
}
