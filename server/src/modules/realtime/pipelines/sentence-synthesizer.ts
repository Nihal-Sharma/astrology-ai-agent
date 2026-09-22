import {
  TTSClient,
} from "../../../infrastructure/speech";

import {
  AppLogger,
} from "../../../infrastructure/observability/logger";

import {
  ServerEvent,
  RealtimeOutboundMessage,
} from "../realtime.types";

import {
  isEnglishOrHindi,
} from "../../../shared/utils/language";

/**
 * Sentence-by-sentence speculative TTS — shared by every voice
 * pipeline (Free today, Gold as of this change) so the
 * English/Hindi enforcement and sentence-framing protocol only
 * exist in one place. A bug fix here fixes it for every tier at
 * once instead of needing to be repeated per pipeline.
 */
export class SentenceSynthesizer {
  constructor(
    private readonly ttsClient: TTSClient,

    private readonly logger: AppLogger
  ) {}

  /**
   * Wraps a sentence's audio with `audio:sentence_start`/
   * `audio:sentence_end` markers, so the client can treat each
   * sentence as an independently-playable clip and start playback
   * after the first one instead of buffering the whole reply — see
   * the wire-format note in realtime.types.ts.
   *
   * `sentence_end` is yielded even when the sentence produced no
   * audio (skipped by the language check) or the turn is about to
   * stop — an empty segment is harmless for the client to receive,
   * and every `sentence_start` must be closed so the client isn't
   * left waiting on a segment that will never arrive.
   */
  async *synthesizeSentenceFramed(
    text: string,

    index: number,

    abortController: AbortController,

    requestId: string,

    onAudioChunk?: () => void
  ): AsyncGenerator<
    RealtimeOutboundMessage,
    boolean
  > {
    yield {
      type: "audio:sentence_start",

      requestId,

      payload: { index },

      timestamp:
        new Date().toISOString(),
    };

    const shouldContinue =
      yield* this.synthesizeSentence(
        text,
        abortController,
        requestId,
        onAudioChunk
      );

    yield {
      type: "audio:sentence_end",

      requestId,

      payload: { index },

      timestamp:
        new Date().toISOString(),
    };

    return shouldContinue;
  }

  cancelledEvent(
    type:
      | "chat:cancelled"
      | "audio:cancelled",
    requestId: string
  ): ServerEvent {
    return {
      type,

      requestId,

      payload: {},

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * Synthesizes one chunk of text (a sentence, or the tail end
   * of a reply) and yields its audio as it streams in. The
   * `yield*` return value (`true`/`false`) tells the caller
   * whether to keep going or stop — `false` means an
   * error/cancellation event was already yielded and the
   * caller should return immediately without yielding
   * `audio:completed`.
   */
  private async *synthesizeSentence(
    text: string,

    abortController: AbortController,

    requestId: string,

    onAudioChunk?: () => void
  ): AsyncGenerator<
    RealtimeOutboundMessage,
    boolean
  > {
    /*
     * Defense in depth: the response prompt already instructs
     * English/Hindi only, but this is the actual enforcement
     * point for output — TTS itself just speaks whatever text
     * it's given, with no language restriction of its own.
     * Skips just this sentence rather than aborting the whole
     * turn, since one bad sentence shouldn't kill an otherwise-
     * compliant reply.
     */
    if (!isEnglishOrHindi(text)) {
      this.logger.warn(
        {
          module: "realtime",
          requestId,
          textSample: text.slice(0, 80),
        },
        "Skipped synthesizing a non-English/Hindi sentence"
      );

      return true;
    }

    for await (
      const chunk of this.ttsClient.synthesizeStream(
        text
      )
    ) {
      if (
        abortController.signal
          .aborted
      ) {
        yield this.cancelledEvent(
          "audio:cancelled",
          requestId
        );

        return false;
      }

      if (
        chunk.type ===
          "audio_chunk" &&
        chunk.audio
      ) {
        onAudioChunk?.();

        /*
         * Raw binary frame, not a JSON ServerEvent — see the
         * wire-format decision in realtime.types.ts.
         */
        yield chunk.audio;
      }

      if (chunk.type === "error") {
        yield {
          type: "audio:error",

          requestId,

          payload: {
            message:
              chunk.error
                ?.message ??
              "TTS error",
          },

          timestamp:
            new Date().toISOString(),
        };

        return false;
      }
    }

    return true;
  }
}
