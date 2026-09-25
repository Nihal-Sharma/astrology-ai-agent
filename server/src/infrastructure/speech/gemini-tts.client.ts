import {
  GoogleGenAI,
} from "@google/genai";

import {
  AppLogger,
} from "../observability/logger";

import {
  TTSClient,
  TTSOptions,
  TTSStreamChunk,
} from "./speech.types";

import {
  wrapPcmAsWav,
} from "../../shared/utils/wav";

export interface GeminiTtsClientOptions {
  apiKey: string;

  /** Defaults to gemini-3.1-flash-tts-preview — the first TTS-tier model with streaming support. */
  defaultModel?: string;

  /** A Gemini prebuilt voice name (e.g. "Kore", "Puck") — not an OpenAI voice id. */
  defaultVoice?: string;

  /**
   * Style/delivery guidance. Unlike OpenAI's gpt-4o-mini-tts,
   * Gemini TTS has no separate `instructions` parameter — style is
   * steered by prefixing natural-language direction onto the text
   * itself (Google's own example: "Say cheerfully: Have a
   * wonderful day!"). This gets prepended to every synthesis call
   * that doesn't override it. Untested against a live key — the
   * exact phrasing/placement may need adjusting once heard.
   */
  defaultInstructions?: string;

  logger: AppLogger;
}

const DEFAULT_TTS_MODEL =
  "gemini-3.1-flash-tts-preview";

const DEFAULT_VOICE = "Kore";

/*
 * gemini-3.1-flash-tts-preview rejects every `mime_type` tried in
 * `response_format` — "audio/mp3", "audio/wav", and "audio/l16"
 * were all rejected live ("Audio MIME type AUDIO_MP3/AUDIO_WAV/
 * AUDIO_L16 is not supported for models/gemini-3.1-flash-tts-
 * preview"). Three different values all failing means this model
 * doesn't accept a client-specified mime_type override at all —
 * `response_format` is sent as just `{ type: "audio" }` below, and
 * the model always returns raw 16-bit PCM regardless. The
 * fallbacks right below are what's used if a response ever omits
 * sample_rate/channels; wrapPcmAsWav is what turns that raw PCM
 * into a real, self-contained file the app can just play.
 */

/**
 * Gemini's documented TTS output characteristics when the API
 * response doesn't say otherwise (it's supposed to echo back the
 * real sample_rate/channels on every audio part, but this is the
 * fallback if a field is ever missing).
 */
const DEFAULT_SAMPLE_RATE_HZ = 24000;

const DEFAULT_CHANNELS = 1;

function base64ToBuffer(
  base64: string
): Buffer {
  return Buffer.from(base64, "base64");
}

/**
 * Gemini implementation of `TTSClient`, using
 * `interactions.create()` (the path Gemini's speech-generation
 * guide documents) rather than `models.generateContent` with
 * `responseModalities` (that shape appears in the SDK's shared
 * types but is documented for the Live API session, not one-shot
 * synthesis).
 *
 * Sends `response_format: { type: "audio" }` with no `mime_type` —
 * gemini-3.1-flash-tts-preview rejects a client-specified
 * mime_type outright (mp3, wav, and l16 were each tried and each
 * rejected live) and always returns raw 16-bit PCM regardless of
 * what's requested. This wraps that PCM in a WAV header itself
 * (see wrapPcmAsWav) before returning/yielding it, so callers
 * still get a normal, independently-playable audio file — same
 * contract as OpenAiTtsClient, just assembled here instead of by
 * the provider.
 *
 * Has no numeric playback-speed control confirmed in this SDK
 * (unlike OpenAI's `speed` param) — `TTSOptions.speed`/`TTS_SPEED`
 * are accepted but silently unused here.
 */
export class GeminiTtsClient
  implements TTSClient
{
  private readonly client: GoogleGenAI;

  private readonly defaultModel: string;

  private readonly defaultVoice: string;

  private readonly defaultInstructions?: string;

  private readonly logger: AppLogger;

  constructor(
    options: GeminiTtsClientOptions
  ) {
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
    });

    this.defaultModel =
      options.defaultModel ??
      DEFAULT_TTS_MODEL;

    this.defaultVoice =
      options.defaultVoice ??
      DEFAULT_VOICE;

    this.defaultInstructions =
      options.defaultInstructions;

    this.logger = options.logger;
  }

  async synthesize(
    text: string,
    options?: TTSOptions
  ): Promise<Buffer> {
    const startedAt =
      performance.now();

    try {
      const result =
        await this.client.interactions.create(
          {
            model:
              this.defaultModel,

            input:
              this.toStyledInput(
                text,
                options
              ),

            generation_config: {
              speech_config: [
                {
                  voice:
                    options?.voice ??
                    this.defaultVoice,
                },
              ],
            },

            response_format: {
              type: "audio",
            },
          }
        );

      const data =
        result.output_audio?.data;

      if (!data) {
        throw new Error(
          "Gemini TTS response had no audio data"
        );
      }

      const audio = wrapPcmAsWav(
        base64ToBuffer(data),

        result.output_audio
          ?.sample_rate ??
          DEFAULT_SAMPLE_RATE_HZ,

        result.output_audio
          ?.channels ??
          DEFAULT_CHANNELS
      );

      this.logger.debug(
        {
          module: "tts",
          provider: "gemini",
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
          provider: "gemini",
          model:
            this.defaultModel,
        },
        "TTS synthesis failed"
      );

      throw error;
    }
  }

  async *synthesizeStream(
    text: string,
    options?: TTSOptions
  ): AsyncIterable<TTSStreamChunk> {
    const startedAt =
      performance.now();

    /*
     * Buffered, not forwarded per-fragment: a WAV header needs the
     * total PCM length upfront, so individual deltas can't each be
     * wrapped into their own valid file the way MP3 fragments
     * could be. This still preserves the sentence-level speculative
     * latency win end to end — the client (useVoiceSession.ts)
     * already buffers every chunk between audio:sentence_start/end
     * before playing anything, so nothing here plays any later
     * than it already would have.
     */
    const pcmChunks: Buffer[] = [];

    let sampleRate =
      DEFAULT_SAMPLE_RATE_HZ;

    let channels = DEFAULT_CHANNELS;

    try {
      const stream =
        await this.client.interactions.create(
          {
            model:
              this.defaultModel,

            input:
              this.toStyledInput(
                text,
                options
              ),

            generation_config: {
              speech_config: [
                {
                  voice:
                    options?.voice ??
                    this.defaultVoice,
                },
              ],
            },

            response_format: {
              type: "audio",
            },

            stream: true,
          }
        );

      for await (
        const event of stream
      ) {
        if (
          event.event_type ===
          "step.delta"
        ) {
          const delta =
            event.delta;

          if (
            delta.type ===
              "audio" &&
            delta.data
          ) {
            pcmChunks.push(
              base64ToBuffer(
                delta.data
              )
            );

            sampleRate =
              delta.sample_rate ??
              sampleRate;

            channels =
              delta.channels ??
              channels;
          }

          continue;
        }

        if (
          event.event_type ===
          "error"
        ) {
          throw new Error(
            event.error
              ?.message ??
              "Gemini TTS stream error"
          );
        }
      }

      const audio = wrapPcmAsWav(
        Buffer.concat(pcmChunks),
        sampleRate,
        channels
      );

      this.logger.debug(
        {
          module: "tts",
          provider: "gemini",
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
        "TTS streaming synthesis completed"
      );

      yield {
        type: "audio_chunk",
        audio,
      };

      yield {
        type: "completed",
      };
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "tts",
          provider: "gemini",
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

  private toStyledInput(
    text: string,
    options?: TTSOptions
  ): string {
    const instructions =
      options?.instructions ??
      this.defaultInstructions;

    return instructions
      ? `${instructions} Say: ${text}`
      : text;
  }
}
