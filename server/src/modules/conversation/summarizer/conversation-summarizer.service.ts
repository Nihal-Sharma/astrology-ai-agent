import {
  LlmClient,
} from "../../../infrastructure/llm";

import {
  ConversationMessage,
} from "../conversation.types";

import {
  ConversationSummaryResult,
  conversationSummarySchema,
} from "./conversation-summarizer.schema";

import {
  CONVERSATION_SUMMARIZER_SYSTEM_PROMPT,
} from "./conversation-summarizer.prompt";

import {
  stripJsonCodeFence,
} from "../../../shared/utils/llm-json";

export class ConversationSummarizer {
  constructor(
    private readonly llm: LlmClient
  ) {}

  async summarize(input: {
    previousSummary?: string;

    previousTopic?: string;

    messages: ConversationMessage[];
  }): Promise<ConversationSummaryResult> {
    const transcript = input.messages
      .map(
        (message) =>
          `${message.role}: ${message.content}`
      )
      .join("\n");

    const userPrompt = `
PREVIOUS SUMMARY:
${input.previousSummary ?? "None"}

PREVIOUS TOPIC:
${input.previousTopic ?? "None"}

NEW MESSAGES TO FOLD IN:
${transcript}

Return only JSON matching the required schema.
`;

    const response =
      await this.llm.generate({
        instructions:
          CONVERSATION_SUMMARIZER_SYSTEM_PROMPT,

        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],

        maxOutputTokens: 400,
      });

    let parsed: unknown;

    try {
      parsed = JSON.parse(
        stripJsonCodeFence(
          response.text
        )
      );
    } catch {
      throw new Error(
        "Summarizer returned invalid JSON"
      );
    }

    const result =
      conversationSummarySchema.safeParse(
        parsed
      );

    if (!result.success) {
      throw new Error(
        `Invalid summarizer output: ${result.error.message}`
      );
    }

    return result.data;
  }
}
