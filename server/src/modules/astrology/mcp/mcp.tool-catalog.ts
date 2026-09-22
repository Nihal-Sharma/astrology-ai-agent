import rawCatalog from "./tool-catalog.json";

import {
  McpToolDefinition,
} from "./mcp.types";

type RawCatalogTool = {
  name: string;

  description?: string;

  inputSchema: Record<
    string,
    unknown
  >;

  source?: "server" | "local";

  enabled?: boolean;
};

type RawCatalog = Record<
  string,
  RawCatalogTool[]
>;

export function loadAstrologyToolCatalog():
  McpToolDefinition[] {
  const catalog =
    rawCatalog as RawCatalog;

  const toolsByName =
    new Map<
      string,
      McpToolDefinition
    >();

  for (
    const [
      category,
      tools,
    ] of Object.entries(catalog)
  ) {
    for (const tool of tools) {
      const existing =
        toolsByName.get(
          tool.name
        );

      if (!existing) {
        toolsByName.set(
          tool.name,
          {
            name: tool.name,

            description:
              tool.description,

            inputSchema:
              tool.inputSchema,

            source:
              tool.source ??
              "local",

            enabled:
              tool.enabled ??
              true,

            categories: [
              category,
            ],
          }
        );

        continue;
      }

      /*
       * Same tool can appear in multiple
       * business categories.
       */
      if (
        !existing.categories.includes(
          category
        )
      ) {
        existing.categories.push(
          category
        );
      }

      /*
       * Prefer a non-empty description
       * if another category happens to
       * contain one.
       */
      if (
        !existing.description &&
        tool.description
      ) {
        existing.description =
          tool.description;
      }
    }
  }

  return Array.from(
    toolsByName.values()
  );
}

export const ASTROLOGY_TOOL_CATALOG =
  loadAstrologyToolCatalog();