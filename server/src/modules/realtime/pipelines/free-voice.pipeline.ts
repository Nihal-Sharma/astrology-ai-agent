import {
  AgentService,
} from "../../agent";

import {
  STTClient,
  TTSClient,
  SttAudioFormat,
} from "../../../infrastructure/speech";

import {
  LlmClient,
} from "../../../infrastructure/llm";

import {
  AppLogger,
} from "../../../infrastructure/observability/logger";

import {
  RealtimeOutboundMessage,
  RealtimeSessionContext,
} from "../realtime.types";

import {
  popReadySentence,
} from "./sentence";

import {
  SentenceSynthesizer,
} from "./sentence-synthesizer";

import {
  DisplayTranslator,
} from "./display-translator";

import {
  VoicePipeline,
} from "./voice-pipeline.types";

/**
 * The Free-tier cascade — extracted verbatim from what used to be
 * `RealtimeService.processAudio` (see ROADMAP.md's Phase B): STT →
 * agent turn (planner → MCP/RAG → response) → speculative
 * sentence-by-sentence TTS. `RealtimeService` still owns session/
 * protocol-level concerns (validation, rate limiting,
 * `activeAbortController` lifecycle) and hands off to this for the
 * actual turn — see `VoicePipeline`'s doc comment.
 */
export class FreeVoicePipeline
  implements VoicePipeline
{
  private readonly sentenceSynthesizer: SentenceSynthesizer;

  private readonly displayTranslator: DisplayTranslator;

  constructor(
    private readonly agentService: AgentService,

    private readonly sttClient: STTClient,

    ttsClient: TTSClient,

    private readonly logger: AppLogger,

    llmClient: LlmClient,

    /**
     * Model used for display-translation specifically — a small
     * helper call that doesn't need the main agent model's
     * reasoning depth. Keeping it on the default model added
     * 5-10s of pure model latency to every non-Hindi voice turn.
     */
    displayTranslationModel: string
  ) {
    this.sentenceSynthesizer =
      new SentenceSynthesizer(
        ttsClient,
        logger
      );

    this.displayTranslator =
      new DisplayTranslator(
        llmClient,
        displayTranslationModel,
        logger
      );
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
    },
    abortController: AbortController
  ): AsyncIterable<RealtimeOutboundMessage> {
    const turnStartedAt =
      performance.now();

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
        yield this.sentenceSynthesizer.cancelledEvent(
          "audio:cancelled",
          input.requestId
        );

        return;
      }

      if (!transcript.trim()) {
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

      /*
       * Kick off the display translation and the agent turn
       * concurrently rather than awaiting translation first —
       * translateForDisplay used to sit fully before the agent
       * turn even started, adding its ~1-1.5s directly to
       * time-to-first-audio rather than just to when the
       * transcript displays. Priming the agent generator's first
       * `.next()` here starts its real work (context build,
       * planner, ...) immediately; translation runs alongside it
       * and is normally long finished by the time that first
       * event resolves, so this costs nothing extra.
       */
      const translationPromise =
        this.displayTranslator.translateForDisplay(
          transcript
        );

      const agentIterator =
        this.agentService
          .streamTurn({
            userId:
              session.userId as string,

            conversationId:
              session.conversationId as string,

            message: transcript,

            inputType: "voice",

            signal:
              abortController.signal,
          })
          [
            Symbol.asyncIterator
          ]();

      const nextAgentEvent =
        agentIterator.next();

      const displayTranscript =
        await translationPromise;

      yield {
        type: "audio:transcribed",

        requestId:
          input.requestId,

        payload: {
          text: displayTranscript,
        },

        timestamp:
          new Date().toISOString(),
      };

      let fullText = "";

      let pendingText = "";

      let firstTextDeltaAt:
        | number
        | undefined;

      let firstAudioChunkAt:
        | number
        | undefined;

      let sentenceIndex = 0;

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

      let agentResult =
        await nextAgentEvent;

      while (!agentResult.done) {
        const event =
          agentResult.value;

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
              yield* this.sentenceSynthesizer.synthesizeSentenceFramed(
                ready.sentence,
                sentenceIndex++,
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

        agentResult =
          await agentIterator.next();
      }

      if (
        abortController.signal
          .aborted
      ) {
        yield this.sentenceSynthesizer.cancelledEvent(
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
          yield* this.sentenceSynthesizer.synthesizeSentenceFramed(
            pendingText.trim(),
            sentenceIndex++,
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

      /*
       * The LLM generated a reply (fullText is non-empty, past
       * the check above), but every sentence of it got skipped
       * by the English/Hindi check in synthesizeSentence — e.g.
       * the model replied in a third language despite the
       * prompt rule against it. Without this, the client would
       * see audio:completed with zero audio chunks — silence,
       * with no explanation — instead of a clear error.
       */
      if (firstAudioChunkAt === undefined) {
        yield {
          type: "audio:error",

          requestId:
            input.requestId,

          payload: {
            message:
              "Sorry, I couldn't generate a spoken reply for that — please try again.",
          },

          timestamp:
            new Date().toISOString(),
        };

        return;
      }

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
        yield this.sentenceSynthesizer.cancelledEvent(
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
    }
  }
}
