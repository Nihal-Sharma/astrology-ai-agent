import OpenAI from "openai";

import {
  AppLogger,
} from "../observability/logger";

import {
  LlmClient,
  LlmGenerateInput,
  LlmResponse,
  LlmMessage,
  LlmStreamChunk,
} from "./llm.types";

import {
  llmRequestDurationMs,
} from "../observability/metrics";

export interface OpenAiLlmClientOptions {
  apiKey: string;

  defaultModel: string;

  logger: AppLogger;
}

export class OpenAiLlmClient
  implements LlmClient
{
  private readonly client: OpenAI;

  private readonly defaultModel: string;

  private readonly logger: AppLogger;

  constructor(
    options: OpenAiLlmClientOptions
  ) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
    });

    this.defaultModel =
      options.defaultModel;

    this.logger = options.logger;
  }

  async generate(
    input: LlmGenerateInput
  ): Promise<LlmResponse> {
    const model =
      input.model ??
      this.defaultModel;

    const messages =
      this.normalizeMessages(
        input.messages
      );

    const startedAt =
      performance.now();

    try {
      const response =
        await this.client.responses.create(
          {
            model,

            instructions:
              input.instructions,

            input: messages,

            max_output_tokens:
              input.maxOutputTokens,

            temperature:
              input.temperature,

            reasoning:
              input.reasoningEffort
                ? {
                    effort:
                      input.reasoningEffort,
                  }
                : undefined,
          },
          {
            signal: input.signal,
          }
        );

      const durationMs = Math.round(
        performance.now() -
          startedAt
      );

      this.logger.debug(
        {
          module: "llm",
          provider: "openai",
          model,
          durationMs,
          requestId:
            response._request_id ?? undefined,
        },
        "LLM generation completed"
      );

      llmRequestDurationMs.observe(
        {
          provider: "openai",
          model,
          operation: "generate",
          status: "success",
        },
        durationMs
      );

      return {
        text: response.output_text,

        model,

        providerRequestId:
          response._request_id ?? undefined,
      };
    } catch (error) {
      const durationMs = Math.round(
        performance.now() -
          startedAt
      );

      this.logger.error(
        {
          err: error,
          module: "llm",
          provider: "openai",
          model,
          durationMs,
        },
        "LLM generation failed"
      );

      llmRequestDurationMs.observe(
        {
          provider: "openai",
          model,
          operation: "generate",
          status: "error",
        },
        durationMs
      );

      throw error;
    }
  }

  async *stream(
    input: LlmGenerateInput
  ): AsyncIterable<LlmStreamChunk> {
    const model =
      input.model ??
      this.defaultModel;

    const messages =
      this.normalizeMessages(
        input.messages
      );

    const startedAt =
      performance.now();

    let accumulatedText = "";

    try {
      const stream =
        await this.client.responses.create(
          {
            model,

            instructions:
              input.instructions,

            input: messages,

            max_output_tokens:
              input.maxOutputTokens,

            temperature:
              input.temperature,

            reasoning:
              input.reasoningEffort
                ? {
                    effort:
                      input.reasoningEffort,
                  }
                : undefined,

            stream: true,
          },
          {
            signal: input.signal,
          }
        );

      for await (const event of stream) {
        if (
          event.type ===
          "response.output_text.delta"
        ) {
          const delta =
            event.delta;

          accumulatedText += delta;

          yield {
            type: "text_delta",
            text: delta,
          };

          continue;
        }

        if (
          event.type ===
          "response.completed"
        ) {
          const response =
            event.response as { id?: string; _request_id?: string };

          const durationMs = Math.round(
            performance.now() -
              startedAt
          );

          const requestId =
            response._request_id ?? response.id ?? undefined;

          this.logger.debug(
            {
              module: "llm",
              provider: "openai",
              model,
              durationMs,
              requestId,
              outputChars:
                accumulatedText.length,
            },
            "LLM stream completed"
          );

          llmRequestDurationMs.observe(
            {
              provider: "openai",
              model,
              operation: "stream",
              status: "success",
            },
            durationMs
          );

          yield {
            type: "completed",

            response: {
              text: accumulatedText,

              model,

              providerRequestId: requestId,
            },
          };

          continue;
        }
      }
    } catch (error) {
      const durationMs = Math.round(
        performance.now() -
          startedAt
      );

      this.logger.error(
        {
          err: error,
          module: "llm",
          provider: "openai",
          model,
          durationMs,
        },
        "LLM stream failed"
      );

      llmRequestDurationMs.observe(
        {
          provider: "openai",
          model,
          operation: "stream",
          status: "error",
        },
        durationMs
      );

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

  private normalizeMessages(
    messages: LlmMessage[]
  ): Array<{
    role: "user" | "assistant";
    content: string;
  }> {
    /*
     * The Responses API accepts message-style input.
     *
     * System instructions are handled through the
     * dedicated `instructions` field.
     */
    return messages
      .filter(
        (
          message
        ): message is LlmMessage & {
          role:
            | "user"
            | "assistant";
        } =>
          message.role === "user" ||
          message.role ===
            "assistant"
      )
      .map((message) => ({
        role: message.role,

        content:
          message.content,
      }));
  }
}