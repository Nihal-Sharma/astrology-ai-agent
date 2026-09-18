import {
  AppLogger,
} from "../../infrastructure/observability/logger";

import {
  AstrologyExecutionInput,
  AstrologyExecutionOutput,
} from "./astrology.types";

import {
  McpExecutor,
} from "./mcp/mcp.executor";

import {
  McpArgumentResolver,
} from "./mcp/mcp.argument-resolver";

import {
  McpToolRegistry,
} from "./mcp/mcp.tool-registry";

import {
  McpArgumentContext,
} from "./mcp/mcp.argument-resolver";

import {
  buildTargetDateExtras,
} from "./mcp/target-date.mapper";

export class AstrologyService {
  constructor(
    private readonly executor:
      McpExecutor,

    private readonly argumentResolver:
      McpArgumentResolver,

    private readonly registry:
      McpToolRegistry,

    private readonly logger:
      AppLogger
  ) {}

  async executeTools(
    tools: string[],
    input: AstrologyExecutionInput
  ): Promise<
    AstrologyExecutionOutput["results"]
  > {
    if (tools.length === 0) {
      return [];
    }

    /*
     * ----------------------------------------------------------
     * Build the argument resolution context.
     *
     * The resolver will inspect each tool's schema and only
     * extract the arguments that tool actually requires.
     *
     * Example (real live schema — see birth-profile.mapper.ts):
     *
     * planets
     * -> day / month / year / hour / min / lat / lon / tzone
     *
     * numero_table
     * -> day / month / year / name
     *
     * geo_details
     * -> place
     *
     * matchmaking
     * -> m_* (user) / f_* (partner)
     *
     * composite/synastry charts
     * -> p_* (user) / s_* (partner)
     *
     * transit/predictive tools (via target-date.mapper.ts)
     * -> dasha_date, start_date/end_date, varshaphal_year,
     *    solar_year
     * ----------------------------------------------------------
     */

    const argumentContext:
      McpArgumentContext = {
      user: {
        birthProfile:
          input.user
            ?.birthProfile ??
          input.birthProfile,

        name:
          input.user
            ?.name,

        place:
          input.user
            ?.place,
      },

      partner: {
        birthProfile:
          input.partner
            ?.birthProfile,

        name:
          input.partner
            ?.name,

        place:
          input.partner
            ?.place,
      },

      /*
       * Target-date extras (for transit/predictive queries)
       * come first so an explicitly-supplied extra of the
       * same name (if a caller ever provides one) can still
       * override the derived default.
       */
      extras: {
        ...buildTargetDateExtras(
          input.targetDate,
          input.targetRangeDays
        ),

        ...input.extras,
      },
    };

    const argumentsByTool:
      Record<
        string,
        Record<string, unknown>
      > = {};

    /*
     * ----------------------------------------------------------
     * Resolve arguments independently for every selected tool.
     * ----------------------------------------------------------
     */

    for (const toolName of tools) {
      const tool =
        this.registry.get(
          toolName
        );

      if (!tool) {
        throw new Error(
          `Astrology tool not found in registry: ${toolName}`
        );
      }

      const resolvedArguments =
        this.argumentResolver.resolveOrThrow(
          {
            tool,

            context:
              argumentContext,
          }
        );

      argumentsByTool[
        toolName
      ] = resolvedArguments;
    }

    this.logger.debug(
      {
        module:
          "astrology",

        tools,

        userId:
          input.userId,

        conversationId:
          input.conversationId,

        argumentKeys:
          Object.fromEntries(
            Object.entries(
              argumentsByTool
            ).map(
              ([
                toolName,
                args,
              ]) => [
                toolName,
                Object.keys(args),
              ]
            )
          ),
      },
      "Resolved astrology tool arguments"
    );

    /*
     * ----------------------------------------------------------
     * Execute all selected tools through the MCP executor.
     *
     * Executor handles:
     * - validation
     * - parallel execution
     * - MCP client calls
     * ----------------------------------------------------------
     */

    const results =
      await this.executor.execute({
        tools,

        arguments:
          argumentsByTool,

        signal:
          input.signal,
      });

    this.logger.debug(
      {
        module:
          "astrology",

        tools,

        userId:
          input.userId,

        conversationId:
          input.conversationId,

        resultCount:
          results.length,
      },
      "Astrology tools executed"
    );

    return results;
  }
}