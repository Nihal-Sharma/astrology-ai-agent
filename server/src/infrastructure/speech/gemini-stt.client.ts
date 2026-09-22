import {
  GoogleGenAI,
  FileState,
} from "@google/genai";

import {
  AppLogger,
} from "../observability/logger";

import {
  STTClient,
  STTOptions,
  STTStreamEvent,
} from "./speech.types";

import {
  resolveAudioMimeType,
} from "../../shared/utils/audio-mime";

export interface GeminiSttClientOptions {
  apiKey: string;

  /** Defaults to gemini-3.5-transcribe — Gemini's dedicated transcription model. */
  defaultModel?: string;

  logger: AppLogger;
}

const DEFAULT_STT_MODEL =
  "gemini-3.5-transcribe";

const FILE_ACTIVE_POLL_ATTEMPTS = 5;

const FILE_ACTIVE_POLL_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

/**
 * Gemini implementation of `STTClient`, using the Files API +
 * `interactions.create()` — this is the path Gemini's own
 * transcription guide documents (no inline-base64 option for the
 * dedicated transcribe model), unlike OpenAI's single-call
 * `audio.transcriptions.create`. That means every transcription
 * here costs an extra network round-trip (upload, then transcribe)
 * that OpenAI's STT doesn't have — a real latency cost, accepted
 * deliberately per an explicit choice to move STT to Gemini anyway
 * despite the parallel voice-latency work in ROADMAP.md.
 */
export class GeminiSttClient
  implements STTClient
{
  private readonly client: GoogleGenAI;

  private readonly defaultModel: string;

  private readonly logger: AppLogger;

  constructor(
    options: GeminiSttClientOptions
  ) {
    this.client = new GoogleGenAI({
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

    try {
      const uploaded =
        await this.uploadAndWaitActive(
          audioBuffer,
          options
        );

      const result =
        await this.client.interactions.create(
          {
            model:
              this.defaultModel,

            input: [
              {
                type: "audio",
                uri: uploaded.uri,
                mime_type:
                  uploaded.mimeType,
              },
            ],
          }
        );

      const text =
        result.output_text ?? "";

      this.logger.debug(
        {
          module: "stt",
          provider: "gemini",
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

      return text;
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "stt",
          provider: "gemini",
          model:
            this.defaultModel,
        },
        "STT transcription failed"
      );

      throw error;
    }
  }

  /**
   * No genuine streaming transcription documented for the
   * dedicated Gemini transcribe model outside the separate
   * real-time Live API (a different, much bigger integration —
   * see ROADMAP.md). This yields the same result as `transcribe()`
   * as a single "completed" event, so callers using the streaming
   * interface still get a correct (if non-incremental) result
   * rather than an unimplemented method.
   */
  async *transcribeStream(
    audioBuffer: Buffer,
    options?: STTOptions
  ): AsyncIterable<STTStreamEvent> {
    try {
      const text =
        await this.transcribe(
          audioBuffer,
          options
        );

      yield {
        type: "completed",
        text,
      };
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

  private async uploadAndWaitActive(
    audioBuffer: Buffer,
    options?: STTOptions
  ): Promise<{
    uri: string;
    mimeType: string;
  }> {
    const mimeType =
      resolveAudioMimeType(
        options?.format
      );

    const blob = new Blob(
      [new Uint8Array(audioBuffer)],
      { type: mimeType }
    );

    let file =
      await this.client.files.upload(
        {
          file: blob,
          config: { mimeType },
        }
      );

    for (
      let attempt = 0;
      file.state ===
        FileState.PROCESSING &&
      attempt <
        FILE_ACTIVE_POLL_ATTEMPTS;
      attempt++
    ) {
      await delay(
        FILE_ACTIVE_POLL_DELAY_MS
      );

      if (!file.name) {
        break;
      }

      file =
        await this.client.files.get(
          { name: file.name }
        );
    }

    if (
      !file.uri ||
      file.state ===
        FileState.FAILED
    ) {
      throw new Error(
        `Gemini file upload did not become ready for transcription (state: ${file.state ?? "unknown"})`
      );
    }

    return {
      uri: file.uri,

      mimeType:
        file.mimeType ?? mimeType,
    };
  }
}
