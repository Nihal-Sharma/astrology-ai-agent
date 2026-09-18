import {
  LlmClient,
} from "../../../infrastructure/llm";

import {
  AgentExecutionResults,
} from "../agent.types";

import {
  PromptContextWindow,
} from "../context/context-window.builder";

import {
  AgentPlan,
} from "../planner/planner.types";

import {
  buildResponseSystemPrompt,
} from "./response.prompt";

import {
  ResponseGenerationInput,
  ResponseStreamEvent,
} from "./response.types";

import {
  capTokens,
} from "../../../shared/utils/tokenizer";

/**
 * MCP/RAG results are computed fresh every turn (not
 * historical), so they're budgeted independently of the
 * conversation context window rather than through
 * ContextWindowBuilder.
 */
const RESULTS_TOKEN_BUDGET = 1500;

export class ResponseService {
  constructor(
    private readonly llm: LlmClient
  ) {}

  async *stream(
    input: ResponseGenerationInput
  ): AsyncIterable<ResponseStreamEvent> {
    const prompt =
      this.buildPrompt(
        input.window,
        input.plan,
        input.results
      );

    try {
      for await (
        const chunk of this.llm.stream({
          instructions:
            buildResponseSystemPrompt(
              input.plan.personaMode
            ),

          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],

          signal:
            input.signal,

          maxOutputTokens: 1200,
        })
      ) {
        if (
          chunk.type ===
          "text_delta"
        ) {
          yield {
            type: "text_delta",

            text:
              chunk.text ?? "",
          };
        }

        if (
          chunk.type ===
          "completed"
        ) {
          yield {
            type: "completed",
          };
        }

        if (
          chunk.type ===
          "error"
        ) {
          yield {
            type: "error",

            error:
              chunk.error,
          };
        }
      }
    } catch (error) {
      yield {
        type: "error",

        error:
          error instanceof Error
            ? error
            : new Error(
                String(error)
              ),
      };
    }
  }

  private buildPrompt(
    window: PromptContextWindow,

    plan: AgentPlan,

    results: AgentExecutionResults
  ): string {
    const notes = [
      window.resumeNote,
      window.priorConversationNote,
    ]
      .filter(
        (note): note is string =>
          Boolean(note)
      )
      .map((note) => `NOTE: ${note}`)
      .join("\n");

    const responseModeNote =
      window.inputType === "voice"
        ? "NOTE: This turn is VOICE — the user spoke this and your reply will be converted to speech aloud. Keep it short and conversational: no markdown, no headers, no bullet lists, no asterisks, no long numbers read digit-by-digit. Say it the way you'd actually say it out loud."
        : undefined;

    return `
USER QUESTION:
${window.currentMessage}
${responseModeNote ? `\n${responseModeNote}\n` : ""}${notes ? `\n${notes}\n` : ""}
CONVERSATION SUMMARY:
${window.conversationSummary ?? "None"}

CURRENT TOPIC:
${window.currentTopic ?? "None"}

RECENT CONVERSATION:
${window.recentMessages
  .map(
    (message) =>
      `${message.role}: ${message.content}`
  )
  .join("\n")}

BIRTH PROFILE:
${
  window.birthProfile
    ? JSON.stringify(
        window.birthProfile,
        null,
        2
      )
    : "No birth profile available"
}

PARTNER PROFILE (for synastry/matchmaking/compatibility questions):
${
  window.partnerProfile
    ? JSON.stringify(
        window.partnerProfile,
        null,
        2
      )
    : "None attached to this conversation"
}

RELEVANT MEMORIES:
${JSON.stringify(
  window.memories,
  null,
  2
)}

ASTROLOGY CALCULATIONS:
${this.capResultsJson(results.mcp)}

ASTROLOGY KNOWLEDGE:
${this.capResultsJson(results.rag)}

PLANNER DECISION:
${JSON.stringify(
  plan,
  null,
  2
)}

Answer the user's question naturally.
`;
  }

  private capResultsJson(
    value: unknown
  ): string {
    return capTokens(
      JSON.stringify(value, null, 2),
      RESULTS_TOKEN_BUDGET
    );
  }
}