import OpenAI from "openai";

import {
  AppLogger,
} from "../observability/logger";

import {
  TTSOptions,
  TTSStreamChunk,
} from "./speech.types";

export interface TTSClientOptions {
  apiKey: string;

  /**
   * Defaults to gpt-4o-mini-tts — the cheapest tier that still
   * supports streaming (stream_format: "audio") and delivery
   * `instructions`.
   */
  defaultModel?: string;

  logger: AppLogger;
}

const DEFAULT_TTS_MODEL =
  "gpt-4o-mini-tts";

const DEFAULT_VOICE = "alloy";

const DEFAULT_FORMAT = "mp3";

export class TTSClient {
  private readonly client: OpenAI;

  private readonly defaultModel: string;

  private readonly logger: AppLogger;

  constructor(
    options: TTSClientOptions
  ) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
    });

    this.defaultModel =
      options.defaultModel ??
      DEFAULT_TTS_MODEL;

    this.logger = options.logger;
  }

  /**
   * Full audio buffer, once synthesis completes. Simpler than
   * `synthesizeStream`, but nothing plays until it's all done.
   */
  async synthesize(
    text: string,
    options?: TTSOptions
  ): Promise<Buffer> {
    const startedAt =
      performance.now();

    try {
      const response =
        await this.client.audio.speech.create(
          {
            model:
              this.defaultModel,

            voice:
              options?.voice ??
              DEFAULT_VOICE,

            input: text,

            speed: options?.speed,

            instructions:
              options?.instructions,

            response_format:
              options?.format ??
              DEFAULT_FORMAT,
          }
        );

      const audio = Buffer.from(
        await response.arrayBuffer()
      );

      this.logger.debug(
        {
          module: "tts",
          provider: "openai",
          model:
            this.defaultModel,
          textLength: text.length,
          audioBytes:
            audio.length,
          durationMs:
            Math.round(
              performance.now() -
                startedAt
            ),
        },
        "TTS synthesis completed"
      );

      return audio;
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "tts",
          provider: "openai",
          model:
            this.defaultModel,
        },
        "TTS synthesis failed"
      );

      throw error;
    }
  }

  /**
   * Streams audio bytes as they're generated, so playback can
   * start before the full reply has been synthesized — the
   * point of this over `synthesize()` for a live voice
   * conversation.
   */
  async *synthesizeStream(
    text: string,
    options?: TTSOptions
  ): AsyncIterable<TTSStreamChunk> {
    const startedAt =
      performance.now();

    let totalBytes = 0;

    try {
      const response =
        await this.client.audio.speech.create(
          {
            model:
              this.defaultModel,

            voice:
              options?.voice ??
              DEFAULT_VOICE,

            input: text,

            speed: options?.speed,

            instructions:
              options?.instructions,

            response_format:
              options?.format ??
              DEFAULT_FORMAT,

            stream_format: "audio",
          }
        );

      if (!response.body) {
        throw new Error(
          "TTS response had no body to stream"
        );
      }

      const reader =
        response.body.getReader();

      while (true) {
        const {
          done,
          value,
        } = await reader.read();

        if (done) {
          break;
        }

        if (value) {
          totalBytes +=
            value.byteLength;

          yield {
            type: "audio_chunk",

            audio:
              Buffer.from(value),
          };
        }
      }

      this.logger.debug(
        {
          module: "tts",
          provider: "openai",
          model:
            this.defaultModel,
          textLength: text.length,
          audioBytes: totalBytes,
          durationMs:
            Math.round(
              performance.now() -
                startedAt
            ),
        },
        "TTS streaming synthesis completed"
      );

      yield {
        type: "completed",
      };
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "tts",
          provider: "openai",
          model:
            this.defaultModel,
        },
        "TTS streaming synthesis failed"
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
}
