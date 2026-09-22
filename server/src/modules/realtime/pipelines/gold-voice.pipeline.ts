import {
  AgentService,
} from "../../agent";

import {
  TTSClient,
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
  resolveAudioMimeType,
} from "../../../shared/utils/audio-mime";

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
 * The Gold-tier cascade (ROADMAP.md's Phase C): skips the Free
 * tier's separate STT call entirely — raw audio goes straight into
 * the planner call (`AgentService.streamTurnWithAudio`), which
 * transcribes it and produces its routing decision in one shot
 * (see PlannerService.createPlan / AgentOrchestrator.runAudioTurn).
 * Everything from there (MCP/RAG execution, response generation,
 * speculative sentence-by-sentence TTS) is identical to Free tier —
 * only the transcription step changes, so this shares
 * `SentenceSynthesizer`/`DisplayTranslator` with `FreeVoicePipeline`
 * rather than duplicating them.
 */
export class GoldVoicePipeline
  implements VoicePipeline
{
  private readonly sentenceSynthesizer: SentenceSynthesizer;

  private readonly displayTranslator: DisplayTranslator;

  constructor(
    private readonly agentService: AgentService,

    ttsClient: TTSClient,

    private readonly logger: AppLogger,

    llmClient: LlmClient,

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
      const agentIterator =
        this.agentService
          .streamTurnWithAudio({
            userId:
              session.userId as string,

            conversationId:
              session.conversationId as string,

            audio: input.audio,

            mimeType:
              resolveAudioMimeType(
                input.format
              ),

            signal:
              abortController.signal,
          })
          [
            Symbol.asyncIterator
          ]();

      let agentResult =
        await agentIterator.next();

      /*
       * The very first event out of streamTurnWithAudio is always
       * "transcript" (AgentOrchestrator.runAudioTurn's contract) —
       * there's nothing else this pipeline can meaningfully do
       * before that's known, unlike Free tier where STT already
       * ran as its own separate call before the agent turn started.
       */
      if (
        agentResult.done ||
        agentResult.value.type ===
          "error"
      ) {
        yield {
          type: "audio:error",

          requestId:
            input.requestId,

          payload: {
            message:
              !agentResult.done &&
              agentResult.value
                .type === "error"
                ? (agentResult.value
                    .error
                    ?.message ??
                  "Agent error")
                : "The agent turn ended before producing a transcript",
          },

          timestamp:
            new Date().toISOString(),
        };

        return;
      }

      if (
        agentResult.value.type !==
        "transcript"
      ) {
        throw new Error(
          `Expected a "transcript" event first from streamTurnWithAudio, got "${agentResult.value.type}"`
        );
      }

      const transcript =
        agentResult.value.text;

      const transcribedAt =
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

      /*
       * Same concurrency trick as FreeVoicePipeline: kick off
       * display-translation and keep driving the agent turn
       * forward (MCP/RAG execution, response generation already
       * starting) at the same time, rather than paying
       * translation's latency before any of that begins.
       */
      const translationPromise =
        this.displayTranslator.translateForDisplay(
          transcript
        );

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

      agentResult =
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

          /*
           * No separate sttMs here — transcription and planning
           * happened in the same call, so this is the combined
           * cost of both, not just transcription. That's the whole
           * point of this tier (see ROADMAP.md's Phase C): compare
           * this against Free tier's sttMs + planner span duration
           * to see whether merging them actually won anything.
           */
          transcribeAndPlanMs:
            Math.round(
              transcribedAt -
                turnStartedAt
            ),

          timeToFirstTextDeltaMs:
            firstTextDeltaAt
              ? Math.round(
                  firstTextDeltaAt -
                    transcribedAt
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
        "Realtime audio turn latency (gold)"
      );

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
        "Realtime audio processing failed (gold)"
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
