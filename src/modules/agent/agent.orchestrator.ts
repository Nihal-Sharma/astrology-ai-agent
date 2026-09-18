import {
  AppLogger,
} from "../../infrastructure/observability/logger";

import {
  AgentContext,
  AgentExecutionResults,
  AgentTurnInput,
} from "./agent.types";

import {
  ContextBuilder,
} from "./context/context.builder";

import {
  ContextWindowBuilder,
} from "./context/context-window.builder";

import {
  PlannerService,
} from "./planner/planner.service";

import {
  ResponseService,
} from "./response/response.service";

import {
  ResponseStreamEvent,
} from "./response/response.types";

import {
  AgentPersonaMode,
  AgentResponseMode,
} from "./planner/planner.types";

import {
  startSpan,
} from "../../infrastructure/observability/tracing";

import {
  agentTurnsTotal,
} from "../../infrastructure/observability/metrics";

/**
 * The orchestrator's public streaming contract: the response
 * text stream, plus a "plan" event yielded once up front so
 * callers (the realtime gateway) can expose the chosen persona
 * mode to the client before the reply starts arriving — see
 * §3 (persona system) "expose current mode to the client".
 *
 * Defined here rather than in agent.types.ts to avoid a
 * circular import (response.types.ts already imports from
 * agent.types.ts).
 */
export type AgentStreamEvent =
  | {
      type: "plan";

      personaMode: AgentPersonaMode;

      responseMode: AgentResponseMode;
    }
  | ResponseStreamEvent;

export interface AgentOrchestratorDependencies {
  contextBuilder: ContextBuilder;

  contextWindowBuilder: ContextWindowBuilder;

  planner: PlannerService;

  responseService: ResponseService;

  logger: AppLogger;

  /**
   * Write-side conversation persistence + rolling
   * summarization trigger. Structurally typed (rather than
   * importing the concrete class) to match the existing
   * astrology/rag/memory dependency style.
   */
  conversation: {
    recordUserTurn(input: {
      conversationId: string;
      userId: string;
      message: string;
    }): Promise<unknown>;

    recordAssistantTurn(input: {
      conversationId: string;
      userId: string;
      message: string;
    }): Promise<unknown>;

    maybeSummarize(
      conversationId: string
    ): Promise<void>;

    updatePersonaMode(
      conversationId: string,
      mode: AgentPersonaMode
    ): Promise<unknown>;
  };

  astrology: {
    executeTools(
      tools: string[],
      input: {
        userId: string;
        conversationId: string;
        message: string;
        birthProfile:
          AgentContext["birthProfile"];

        partner?: {
          birthProfile?:
            AgentContext["partnerProfile"];

          name?: string;
        };

        /**
         * From the planner's mcp.targetDate/targetRangeDays —
         * for transit/predictive questions rather than the
         * fixed natal chart. Translating these into the
         * various provider-specific extra parameter names
         * (dasha_date, start_date/end_date, ...) is the
         * astrology module's own concern, not the
         * orchestrator's.
         */
        targetDate?: string | null;
        targetRangeDays?:
          | number
          | null;

        signal?: AbortSignal;
      }
    ): Promise<
      AgentExecutionResults["mcp"]
    >;
  };

  rag: {
    retrieve(
      queries: string[],
      topK: number
    ): Promise<
      AgentExecutionResults["rag"]
    >;
  };

  memory: {
    retrieve(
      userId: string,
      queries: string[],
      topK: number
    ): Promise<
      AgentExecutionResults["memories"]
    >;

    /**
     * Best-effort fact extraction from a completed turn — see
     * §4 (Memory). Called fire-and-forget, same pattern as
     * conversation.maybeSummarize/updatePersonaMode.
     */
    extractAndStore(input: {
      userId: string;
      conversationId: string;
      userMessage: string;
      assistantMessage: string;
    }): Promise<unknown>;
  };
}

export class AgentOrchestrator {
  constructor(
    private readonly dependencies: AgentOrchestratorDependencies
  ) {}

  async *streamTurn(
    input: AgentTurnInput
  ): AsyncGenerator<AgentStreamEvent> {
    const startedAt =
      performance.now();

    const turnSpan = startSpan(
      "agent.turn",
      this.dependencies.logger,
      {
        attributes: {
          userId: input.userId,
          conversationId:
            input.conversationId,
          inputType:
            input.inputType ??
            "text",
        },
      }
    );

    let turnPersonaMode:
      | AgentPersonaMode
      | undefined;

    try {
      yield* this.runTurn(
        input,
        turnSpan,
        startedAt,
        (mode) => {
          turnPersonaMode = mode;
        }
      );

      agentTurnsTotal.inc({
        inputType:
          input.inputType ?? "text",
        personaMode:
          turnPersonaMode ??
          "unknown",
        status: "success",
      });
    } catch (error) {
      turnSpan.end({
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });

      agentTurnsTotal.inc({
        inputType:
          input.inputType ?? "text",
        personaMode:
          turnPersonaMode ??
          "unknown",
        status: "error",
      });

      throw error;
    }
  }

  private async *runTurn(
    input: AgentTurnInput,
    turnSpan: ReturnType<
      typeof startSpan
    >,
    startedAt: number,
    onPersonaMode: (
      mode: AgentPersonaMode
    ) => void
  ): AsyncGenerator<AgentStreamEvent> {
    /*
     * 0. Persist the user's message first, before any LLM
     * call — durability wins over ordering neatness. The
     * context window builder dedupes it back out of the
     * transcript view for this turn.
     */
    await this.dependencies
      .conversation
      .recordUserTurn({
        conversationId:
          input.conversationId,

        userId: input.userId,

        message: input.message,
      });

    /*
     * 1. Build initial context.
     */
    const context =
      await this.dependencies
        .contextBuilder
        .build({
          userId:
            input.userId,

          conversationId:
            input.conversationId,

          message:
            input.message,

          inputType:
            input.inputType,
        });

    const window =
      this.dependencies
        .contextWindowBuilder
        .build(context);

    /*
     * 2. Planner.
     */
    const plannerSpan = startSpan(
      "agent.planner",
      this.dependencies.logger,
      {
        traceId: turnSpan.traceId,
        parentSpanId: turnSpan.spanId,
      }
    );

    const plan =
      await this.dependencies
        .planner
        .createPlan(
          window,
          input.signal
        );

    plannerSpan.end({
      responseMode:
        plan.responseMode,
      personaMode:
        plan.personaMode,
    });

    onPersonaMode(plan.personaMode);

    this.dependencies.logger.debug(
      {
        module: "agent",
        userId:
          input.userId,
        conversationId:
          input.conversationId,
        responseMode:
          plan.responseMode,
        personaMode:
          plan.personaMode,
        mcpTools:
          plan.mcp.tools,
        ragQueries:
          plan.rag.queries,
        memoryQueries:
          plan.memory.queries,
      },
      "Agent plan created"
    );

    /*
     * Surface the chosen mode as early as possible — before
     * MCP/RAG execution and response generation — so the
     * client can reflect it in the UI right away rather than
     * waiting for the first text delta.
     */
    yield {
      type: "plan",

      personaMode:
        plan.personaMode,

      responseMode:
        plan.responseMode,
    };

    /*
     * 3. Execute external capabilities.
     *
     * This is deliberately parallel.
     */
    const executionSpan = startSpan(
      "agent.execution",
      this.dependencies.logger,
      {
        traceId: turnSpan.traceId,
        parentSpanId: turnSpan.spanId,
      }
    );

    const mcpPromise =
      plan.mcp.required &&
      plan.mcp.tools.length > 0
        ? this.dependencies.astrology
            .executeTools(
              plan.mcp.tools,
              {
                userId:
                  input.userId,

                conversationId:
                  input.conversationId,

                message:
                  input.message,

                birthProfile:
                  context.birthProfile,

                partner:
                  context.partnerProfile
                    ? {
                        birthProfile:
                          context.partnerProfile,

                        name:
                          context.partnerProfile
                            .name,
                      }
                    : undefined,

                targetDate:
                  plan.mcp
                    .targetDate,

                targetRangeDays:
                  plan.mcp
                    .targetRangeDays,

                signal:
                  input.signal,
              }
            )
        : Promise.resolve([]);

    const ragPromise =
      plan.rag.required
        ? this.dependencies.rag
            .retrieve(
              plan.rag.queries,
              plan.rag.topK
            )
        : Promise.resolve([]);

    const memoryPromise =
      plan.memory.required
        ? this.dependencies.memory
            .retrieve(
              input.userId,
              plan.memory.queries,
              plan.memory.topK
            )
        : Promise.resolve(
            context.memories
          );

    const [
      mcp,
      rag,
      memories,
    ] = await Promise.all([
      mcpPromise,
      ragPromise,
      memoryPromise,
    ]);

    executionSpan.end({
      mcpCount: mcp.length,
      ragCount: rag.length,
      memoryCount: memories.length,
    });

    const results: AgentExecutionResults =
      {
        mcp,
        rag,
        memories,
      };

    /*
     * 4. Generate answer as a stream.
     */
    const responseSpan = startSpan(
      "agent.response",
      this.dependencies.logger,
      {
        traceId: turnSpan.traceId,
        parentSpanId: turnSpan.spanId,
      }
    );

    let fullText = "";

    let completedSuccessfully = false;

    for await (
      const event of this.dependencies
        .responseService
        .stream({
          window,
          plan,
          results,
          signal:
            input.signal,
        })
    ) {
      if (
        event.type === "text_delta"
      ) {
        fullText +=
          event.text ?? "";
      }

      if (event.type === "completed") {
        completedSuccessfully = true;
      }

      yield event;
    }

    responseSpan.end({
      completedSuccessfully,
      textLength: fullText.length,
    });

    /*
     * 5. Persist the assistant's reply and, best-effort,
     * roll old messages into the conversation summary.
     *
     * Only persisted on a clean completion — an aborted or
     * errored turn has nothing coherent to remember.
     */
    if (
      completedSuccessfully &&
      fullText.trim().length > 0
    ) {
      await this.dependencies
        .conversation
        .recordAssistantTurn({
          conversationId:
            input.conversationId,

          userId: input.userId,

          message: fullText,
        });

      void this.dependencies
        .conversation
        .maybeSummarize(
          input.conversationId
        )
        .catch((error) => {
          this.dependencies.logger.error(
            {
              err: error,
              module: "agent",
              conversationId:
                input.conversationId,
            },
            "Fire-and-forget summarization failed"
          );
        });

      void this.dependencies
        .conversation
        .updatePersonaMode(
          input.conversationId,
          plan.personaMode
        )
        .catch((error) => {
          this.dependencies.logger.error(
            {
              err: error,
              module: "agent",
              conversationId:
                input.conversationId,
            },
            "Fire-and-forget persona mode update failed"
          );
        });

      void this.dependencies
        .memory
        .extractAndStore({
          userId: input.userId,

          conversationId:
            input.conversationId,

          userMessage:
            input.message,

          assistantMessage:
            fullText,
        })
        .catch((error) => {
          this.dependencies.logger.error(
            {
              err: error,
              module: "agent",
              conversationId:
                input.conversationId,
            },
            "Fire-and-forget memory extraction failed"
          );
        });
    }

    const durationMs =
      Math.round(
        performance.now() -
          startedAt
      );

    this.dependencies.logger.debug(
      {
        module: "agent",
        userId:
          input.userId,
        conversationId:
          input.conversationId,
        durationMs,
      },
      "Agent turn completed"
    );

    turnSpan.end({
      status: "ok",
      durationMs,
      completedSuccessfully,
    });
  }
}