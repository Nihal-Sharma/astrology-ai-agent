import {
  GoogleGenAI,
} from "@google/genai";

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

export interface GeminiLlmClientOptions {
  apiKey: string;

  defaultModel: string;

  logger: AppLogger;
}

/**
 * Gemini (`@google/genai`) implementation of `LlmClient` — see
 * `OpenAiLlmClient` for the provider this mirrors. Uses the SDK's
 * `models.generateContent`/`generateContentStream` (not the newer
 * `interactions` API): that surface is the one actually documented
 * for plain multi-turn text generation, while `interactions` is
 * what Gemini's TTS/transcription guides use (see
 * GeminiSttClient/GeminiTtsClient).
 *
 * `reasoningEffort` (OpenAI's `reasoning.effort`) has no Gemini
 * equivalent wired here — left unmapped rather than guessing at a
 * `thinkingConfig` shape untested against a live key.
 */
export class GeminiLlmClient
  implements LlmClient
{
  private readonly client: GoogleGenAI;

  private readonly defaultModel: string;

  private readonly logger: AppLogger;

  constructor(
    options: GeminiLlmClientOptions
  ) {
    this.client = new GoogleGenAI({
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

    const startedAt =
      performance.now();

    try {
      const response =
        await this.client.models.generateContent(
          {
            model,

            contents:
              this.toContents(
                input.messages,
                input.audio
              ),

            config: {
              systemInstruction:
                input.instructions,

              maxOutputTokens:
                input.maxOutputTokens,

              temperature:
                input.temperature,

              abortSignal:
                input.signal,
            },
          }
        );

      const durationMs = Math.round(
        performance.now() -
          startedAt
      );

      this.logger.debug(
        {
          module: "llm",
          provider: "gemini",
          model,
          durationMs,
          hasAudio:
            Boolean(input.audio),
        },
        "LLM generation completed"
      );

      llmRequestDurationMs.observe(
        {
          provider: "gemini",
          model,
          operation: "generate",
          status: "success",
        },
        durationMs
      );

      return {
        text:
          response.text ?? "",

        model,
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
          provider: "gemini",
          model,
          durationMs,
        },
        "LLM generation failed"
      );

      llmRequestDurationMs.observe(
        {
          provider: "gemini",
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

    const startedAt =
      performance.now();

    let accumulatedText = "";

    try {
      const stream =
        await this.client.models.generateContentStream(
          {
            model,

            contents:
              this.toContents(
                input.messages,
                input.audio
              ),

            config: {
              systemInstruction:
                input.instructions,

              maxOutputTokens:
                input.maxOutputTokens,

              temperature:
                input.temperature,

              abortSignal:
                input.signal,
            },
          }
        );

      for await (
        const chunk of stream
      ) {
        const delta =
          chunk.text ?? "";

        if (delta) {
          accumulatedText += delta;

          yield {
            type: "text_delta",
            text: delta,
          };
        }
      }

      const durationMs = Math.round(
        performance.now() -
          startedAt
      );

      this.logger.debug(
        {
          module: "llm",
          provider: "gemini",
          model,
          durationMs,
          outputChars:
            accumulatedText.length,
        },
        "LLM stream completed"
      );

      llmRequestDurationMs.observe(
        {
          provider: "gemini",
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
        },
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
          provider: "gemini",
          model,
          durationMs,
        },
        "LLM stream failed"
      );

      llmRequestDurationMs.observe(
        {
          provider: "gemini",
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

  /**
   * Gemini's `contents` array uses `"user"`/`"model"` roles, not
   * OpenAI's `"user"`/`"assistant"` — the only real shape
   * difference from `OpenAiLlmClient.normalizeMessages`.
   *
   * When `audio` is given, it's attached as an extra `inlineData`
   * part on the last message (expected to be the `user` turn) —
   * standard Gemini multimodal-content shape: a `parts` array can
   * mix independent text/inlineData entries in one message. This is
   * what lets the planner call transcribe audio and reason about it
   * in the same request (see ROADMAP.md's Phase C / PlannerService.
   * createPlan).
   */
  private toContents(
    messages: LlmMessage[],

    audio?: {
      data: Buffer;
      mimeType: string;
    }
  ): Array<{
    role: "user" | "model";
    parts: Array<
      | { text: string }
      | {
          inlineData: {
            data: string;
            mimeType: string;
          };
        }
    >;
  }> {
    const contents = messages
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
        role:
          message.role === "user"
            ? ("user" as const)
            : ("model" as const),

        parts: [
          { text: message.content },
        ] as Array<
          | { text: string }
          | {
              inlineData: {
                data: string;
                mimeType: string;
              };
            }
        >,
      }));

    const lastContent =
      contents[contents.length - 1];

    if (audio && lastContent) {
      lastContent.parts.push({
        inlineData: {
          data: audio.data.toString(
            "base64"
          ),

          mimeType:
            audio.mimeType,
        },
      });
    }

    return contents;
  }
}
