import OpenAI, {
  toFile,
} from "openai";

import {
  AppLogger,
} from "../observability/logger";

import {
  STTClient,
  STTOptions,
  STTStreamEvent,
} from "./speech.types";

export interface OpenAiSttClientOptions {
  apiKey: string;

  /**
   * Defaults to gpt-4o-mini-transcribe — cheap and, unlike
   * whisper-1, supports streaming partial transcripts.
   */
  defaultModel?: string;

  logger: AppLogger;
}

const DEFAULT_STT_MODEL =
  "gpt-4o-mini-transcribe";

const DEFAULT_FORMAT = "wav";

export class OpenAiSttClient
  implements STTClient
{
  private readonly client: OpenAI;

  private readonly defaultModel: string;

  private readonly logger: AppLogger;

  constructor(
    options: OpenAiSttClientOptions
  ) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
    });

    this.defaultModel =
      options.defaultModel ??
      DEFAULT_STT_MODEL;

    this.logger = options.logger;
  }

  async transcribe(
    audioBuffer: Buffer,
    options?: STTOptions
  ): Promise<string> {
    const startedAt =
      performance.now();

    const format =
      options?.format ??
      DEFAULT_FORMAT;

    try {
      const file =
        await this.toAudioFile(
          audioBuffer,
          format
        );

      const result =
        await this.client.audio.transcriptions.create(
          {
            file,

            model:
              this.defaultModel,

            language:
              options?.language,

            prompt:
              options?.prompt,
          }
        );

      this.logger.debug(
        {
          module: "stt",
          provider: "openai",
          model:
            this.defaultModel,
          bytes:
            audioBuffer.length,
          durationMs:
            Math.round(
              performance.now() -
                startedAt
            ),
        },
        "STT transcription completed"
      );

      return result.text;
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "stt",
          provider: "openai",
          model:
            this.defaultModel,
        },
        "STT transcription failed"
      );

      throw error;
    }
  }

  async *transcribeStream(
    audioBuffer: Buffer,
    options?: STTOptions
  ): AsyncIterable<STTStreamEvent> {
    const format =
      options?.format ??
      DEFAULT_FORMAT;

    try {
      const file =
        await this.toAudioFile(
          audioBuffer,
          format
        );

      const stream =
        await this.client.audio.transcriptions.create(
          {
            file,

            model:
              this.defaultModel,

            language:
              options?.language,

            prompt:
              options?.prompt,

            stream: true,
          }
        );

      for await (
        const event of stream
      ) {
        if (
          event.type ===
          "transcript.text.delta"
        ) {
          yield {
            type: "transcript_delta",

            text: event.delta,
          };

          continue;
        }

        if (
          event.type ===
          "transcript.text.done"
        ) {
          yield {
            type: "completed",

            text: event.text,
          };
        }
      }
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "stt",
          provider: "openai",
          model:
            this.defaultModel,
        },
        "STT streaming transcription failed"
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

  private async toAudioFile(
    audioBuffer: Buffer,
    format: string
  ) {
    return toFile(
      audioBuffer,
      `audio.${format}`,
      {
        type: `audio/${format}`,
      }
    );
  }
}
