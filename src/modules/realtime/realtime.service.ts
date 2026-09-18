import {
  AgentService,
} from "../agent";

import {
  STTClient,
  TTSClient,
  SttAudioFormat,
} from "../../infrastructure/speech";

import {
  AppLogger,
} from "../../infrastructure/observability/logger";

import {
  ServerEvent,
} from "./realtime.types";

/**
 * What a gateway loop actually sends over the socket: a JSON
 * control/status event, or a raw binary audio frame (see the
 * wire-format decision in realtime.types.ts). The gateway
 * checks `Buffer.isBuffer(message)` to pick `socket.send`
 * raw vs. `JSON.stringify` first.
 */
export type RealtimeOutboundMessage =
  | ServerEvent
  | Buffer;

const SENTENCE_END_PATTERN =
  /[.!?](?=\s|$)/;

const MIN_SENTENCE_LENGTH = 2;

/**
 * Pulls the first complete sentence off the front of a
 * streaming text buffer, for speculative/partial TTS: start
 * synthesizing what's ready instead of waiting for the whole
 * reply. Imperfect on abbreviations ("Mr. Smith") — acceptable
 * for spoken delivery, where a slightly-early split just reads
 * as a short pause.
 */
export function popReadySentence(
  buffer: string
):
  | {
      sentence: string;
      remainder: string;
    }
  | null {
  const match =
    SENTENCE_END_PATTERN.exec(
      buffer
    );

  if (!match) {
    return null;
  }

  const endIndex =
    match.index + match[0].length;

  const sentence = buffer
    .slice(0, endIndex)
    .trim();

  const remainder = buffer
    .slice(endIndex)
    .trimStart();

  if (
    sentence.length <
    MIN_SENTENCE_LENGTH
  ) {
    return null;
  }

  return { sentence, remainder };
}

export interface RealtimeSessionContext {
  sessionId: string;

  userId?: string;

  conversationId?: string;

  activeAbortController?: AbortController;

  /**
   * Which kind of turn `activeAbortController` belongs to, so
   * a `chat:cancel` mid-turn can ack with the correctly-typed
   * event (`chat:cancelled` vs `audio:cancelled`) — the client
   * needs to know which one to know whether to stop audio
   * playback.
   */
  activeTurnType?: "text" | "audio";

  /**
   * Raw audio chunks buffered between `audio:start` and
   * `audio:end` for the current turn.
   */
  audioChunks?: Buffer[];

  audioFormat?: string;
}

export class RealtimeService {
  constructor(
    private readonly agentService: AgentService,

    private readonly sttClient: STTClient,

    private readonly ttsClient: TTSClient,

    private readonly logger: AppLogger
  ) {}

  async *processText(
    session: RealtimeSessionContext,
    input: {
      requestId: string;

      message: string;
    }
  ): AsyncIterable<ServerEvent> {
    if (!session.userId) {
      throw new Error(
        "Session userId is required"
      );
    }

    if (!session.conversationId) {
      throw new Error(
        "Session conversationId is required"
      );
    }

    /*
     * Cancel any previous generation belonging
     * to this session.
     *
     * This becomes important for barge-in later.
     */
    session.activeAbortController?.abort();

    const abortController =
      new AbortController();

    session.activeAbortController =
      abortController;

    session.activeTurnType =
      "text";

    this.logger.debug(
      {
        module: "realtime",
        sessionId:
          session.sessionId,

        requestId:
          input.requestId,
      },
      "Starting realtime text turn"
    );

    yield {
      type: "chat:started",

      requestId:
        input.requestId,

      payload: {},

      timestamp:
        new Date().toISOString(),
    };

    try {
      for await (
        const event of this.agentService.streamTurn(
          {
            userId:
              session.userId,

            conversationId:
              session.conversationId,

            message:
              input.message,

            inputType:
              "text",

            signal:
              abortController.signal,
          }
        )
      ) {
        if (event.type === "plan") {
          yield {
            type: "turn:mode",

            requestId:
              input.requestId,

            payload: {
              personaMode:
                event.personaMode,

              responseMode:
                event.responseMode,
            },

            timestamp:
              new Date().toISOString(),
          };
        }

        if (
          event.type ===
          "text_delta"
        ) {
          yield {
            type:
              "chat:delta",

            requestId:
              input.requestId,

            payload: {
              text:
                event.text ??
                "",
            },

            timestamp:
              new Date().toISOString(),
          };
        }

        if (
          event.type ===
          "completed"
        ) {
          yield {
            type:
              "chat:completed",

            requestId:
              input.requestId,

            payload: {},

            timestamp:
              new Date().toISOString(),
          };
        }

        if (
          event.type ===
          "error"
        ) {
          yield {
            type:
              "chat:error",

            requestId:
              input.requestId,

            payload: {
              message:
                event.error
                  ?.message ??
                "Agent error",
            },

            timestamp:
              new Date().toISOString(),
          };
        }
      }
    } catch (error) {
      if (
        abortController.signal
          .aborted
      ) {
        yield {
          type:
            "chat:cancelled",

          requestId:
            input.requestId,

          payload: {},

          timestamp:
            new Date().toISOString(),
        };

        return;
      }

      this.logger.error(
        {
          err: error,

          module: "realtime",

          sessionId:
            session.sessionId,

          requestId:
            input.requestId,
        },
        "Realtime text processing failed"
      );

      yield {
        type:
          "chat:error",

        requestId:
          input.requestId,

        payload: {
          message:
            error instanceof Error
              ? error.message
              : "Unknown error",
        },

        timestamp:
          new Date().toISOString(),
      };
    } finally {
      if (
        session.activeAbortController ===
        abortController
      ) {
        session.activeAbortController =
          undefined;

        session.activeTurnType =
          undefined;
      }
    }
  }

  /**
   * One voice turn: transcribe the buffered audio, run it
   * through the same agent pipeline as text (`inputType:
   * "voice"`), then synthesize the reply and stream it back.
   *
   * Synthesizes speculatively, sentence by sentence, as the
   * agent's response streams in — not the whole reply at once
   * — so the first audio reaches the client after the first
   * sentence is ready, not after the full response finishes
   * generating. Logs per-stage timing (STT / time-to-first-
   * text / time-to-first-audio / total) for measuring this.
   */
  async *processAudio(
    session: RealtimeSessionContext,
    input: {
      requestId: string;

      audio: Buffer;

      format?: string;
    }
  ): AsyncIterable<RealtimeOutboundMessage> {
    if (!session.userId) {
      throw new Error(
        "Session userId is required"
      );
    }

    if (!session.conversationId) {
      throw new Error(
        "Session conversationId is required"
      );
    }

    session.activeAbortController?.abort();

    const abortController =
      new AbortController();

    session.activeAbortController =
      abortController;

    session.activeTurnType =
      "audio";

    const turnStartedAt =
      performance.now();

    this.logger.debug(
      {
        module: "realtime",
        sessionId:
          session.sessionId,
        requestId:
          input.requestId,
        audioBytes:
          input.audio.length,
      },
      "Starting realtime audio turn"
    );

    try {
      const transcript =
        await this.sttClient.transcribe(
          input.audio,
          {
            format:
              (input.format as
                | SttAudioFormat
                | undefined) ??
              "wav",
          }
        );

      const sttDoneAt =
        performance.now();

      if (
        abortController.signal
          .aborted
      ) {
        yield this.cancelledEvent(
          "audio:cancelled",
          input.requestId
        );

        return;
      }

      yield {
        type: "audio:transcribed",

        requestId:
          input.requestId,

        payload: {
          text: transcript,
        },

        timestamp:
          new Date().toISOString(),
      };

      if (!transcript.trim()) {
        yield {
          type: "audio:completed",

          requestId:
            input.requestId,

          payload: {},

          timestamp:
            new Date().toISOString(),
        };

        return;
      }

      let fullText = "";

      let pendingText = "";

      let firstTextDeltaAt:
        | number
        | undefined;

      let firstAudioChunkAt:
        | number
        | undefined;

      const markFirstAudioChunk =
        () => {
          if (
            firstAudioChunkAt ===
            undefined
          ) {
            firstAudioChunkAt =
              performance.now();
          }
        };

      for await (
        const event of this.agentService.streamTurn(
          {
            userId:
              session.userId,

            conversationId:
              session.conversationId,

            message: transcript,

            inputType: "voice",

            signal:
              abortController.signal,
          }
        )
      ) {
        if (event.type === "plan") {
          yield {
            type: "turn:mode",

            requestId:
              input.requestId,

            payload: {
              personaMode:
                event.personaMode,

              responseMode:
                event.responseMode,
            },

            timestamp:
              new Date().toISOString(),
          };
        }

        if (
          event.type ===
          "text_delta"
        ) {
          if (
            firstTextDeltaAt ===
            undefined
          ) {
            firstTextDeltaAt =
              performance.now();
          }

          const delta =
            event.text ?? "";

          fullText += delta;
          pendingText += delta;

          /*
           * Speculative/partial synthesis: as soon as a
           * complete sentence is ready, synthesize and stream
           * it immediately rather than waiting for the whole
           * reply — this is what actually moves
           * time-to-first-audio, since it no longer includes
           * the full remaining generation time.
           */
          let ready =
            popReadySentence(
              pendingText
            );

          while (ready) {
            pendingText =
              ready.remainder;

            const shouldContinue =
              yield* this.synthesizeSentence(
                ready.sentence,
                abortController,
                input.requestId,
                markFirstAudioChunk
              );

            if (!shouldContinue) {
              return;
            }

            ready =
              popReadySentence(
                pendingText
              );
          }
        }

        if (
          event.type === "error"
        ) {
          yield {
            type: "audio:error",

            requestId:
              input.requestId,

            payload: {
              message:
                event.error
                  ?.message ??
                "Agent error",
            },

            timestamp:
              new Date().toISOString(),
          };

          return;
        }
      }

      if (
        abortController.signal
          .aborted
      ) {
        yield this.cancelledEvent(
          "audio:cancelled",
          input.requestId
        );

        return;
      }

      /*
       * Whatever's left in pendingText is the tail of the
       * reply that never hit a sentence-ending punctuation
       * mark (or the whole reply, if it was short enough to
       * never trigger the speculative path above).
       */
      if (pendingText.trim()) {
        const shouldContinue =
          yield* this.synthesizeSentence(
            pendingText.trim(),
            abortController,
            input.requestId,
            markFirstAudioChunk
          );

        if (!shouldContinue) {
          return;
        }
      }

      if (!fullText.trim()) {
        yield {
          type: "audio:completed",

          requestId:
            input.requestId,

          payload: {},

          timestamp:
            new Date().toISOString(),
        };

        return;
      }

      const turnCompletedAt =
        performance.now();

      this.logger.debug(
        {
          module: "realtime",
          sessionId:
            session.sessionId,
          requestId:
            input.requestId,

          sttMs: Math.round(
            sttDoneAt -
              turnStartedAt
          ),

          timeToFirstTextDeltaMs:
            firstTextDeltaAt
              ? Math.round(
                  firstTextDeltaAt -
                    sttDoneAt
                )
              : undefined,

          timeToFirstAudioChunkMs:
            firstAudioChunkAt
              ? Math.round(
                  firstAudioChunkAt -
                    turnStartedAt
                )
              : undefined,

          totalTurnMs: Math.round(
            turnCompletedAt -
              turnStartedAt
          ),
        },
        "Realtime audio turn latency"
      );

      yield {
        type: "audio:completed",

        requestId:
          input.requestId,

        payload: {},

        timestamp:
          new Date().toISOString(),
      };
    } catch (error) {
      if (
        abortController.signal
          .aborted
      ) {
        yield this.cancelledEvent(
          "audio:cancelled",
          input.requestId
        );

        return;
      }

      this.logger.error(
        {
          err: error,

          module: "realtime",

          sessionId:
            session.sessionId,

          requestId:
            input.requestId,
        },
        "Realtime audio processing failed"
      );

      yield {
        type: "audio:error",

        requestId:
          input.requestId,

        payload: {
          message:
            error instanceof Error
              ? error.message
              : "Unknown error",
        },

        timestamp:
          new Date().toISOString(),
      };
    } finally {
      if (
        session.activeAbortController ===
        abortController
      ) {
        session.activeAbortController =
          undefined;

        session.activeTurnType =
          undefined;
      }
    }
  }

  private cancelledEvent(
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

  /**
   * Aborts whatever's in flight and reports what kind of turn
   * it was, so the gateway can ack with the correctly-typed
   * cancellation event (`chat:cancelled` vs `audio:cancelled`)
   * — the client needs to know which one to know whether to
   * stop audio playback.
   */
  cancel(
    session: RealtimeSessionContext
  ): "text" | "audio" | undefined {
    const turnType =
      session.activeTurnType;

    session.activeAbortController?.abort();

    session.activeAbortController =
      undefined;

    session.activeTurnType =
      undefined;

    return turnType;
  }
}