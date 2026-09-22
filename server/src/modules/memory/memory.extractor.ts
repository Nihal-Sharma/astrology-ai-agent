import {
  LlmClient,
} from "../../infrastructure/llm";

import {
  AppLogger,
} from "../../infrastructure/observability/logger";

import {
  ExtractedFact,
  memoryExtractionSchema,
} from "./memory.extractor.schema";

import {
  MEMORY_EXTRACTOR_SYSTEM_PROMPT,
} from "./memory.extractor.prompt";

import {
  stripJsonCodeFence,
} from "../../shared/utils/llm-json";

/**
 * LLM-based fact extraction, replacing the original no-op stub
 * — see §4 (Memory), item 2. Same generate → JSON.parse →
 * zod-validate pattern as ConversationSummarizer.
 */
export class MemoryExtractor {
  constructor(
    private readonly llm: LlmClient,

    private readonly logger: AppLogger
  ) {}

  /**
   * Best-effort: never throws. A failed extraction just means
   * no facts are stored from this turn, which is always a safe
   * fallback (unlike summarization, there's no cumulative state
   * to corrupt).
   */
  async extractFacts(input: {
    userMessage: string;

    assistantMessage: string;
  }): Promise<ExtractedFact[]> {
    const userPrompt = `
USER SAID:
${input.userMessage}

ASSISTANT REPLIED:
${input.assistantMessage}

Return only JSON matching the required schema.
`;

    try {
      const response =
        await this.llm.generate({
          instructions:
            MEMORY_EXTRACTOR_SYSTEM_PROMPT,

          messages: [
            {
              role: "user",
              content: userPrompt,
            },
          ],

          maxOutputTokens: 300,
        });

      const parsed = JSON.parse(
        stripJsonCodeFence(
          response.text
        )
      );

      const result =
        memoryExtractionSchema.safeParse(
          parsed
        );

      if (!result.success) {
        this.logger.debug(
          {
            module: "memory",
            error:
              result.error.message,
          },
          "Memory extraction returned an invalid shape, skipping"
        );

        return [];
      }

      return result.data.facts;
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "memory",
        },
        "Memory fact extraction failed"
      );

      return [];
    }
  }
}
