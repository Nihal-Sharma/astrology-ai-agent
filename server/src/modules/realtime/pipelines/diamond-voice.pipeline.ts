import {
  AppLogger,
} from "../../../infrastructure/observability/logger";

import {
  LiveClient,
  LiveSession,
  LiveToolCallRequest,
  LiveToolDeclaration,
} from "../../../infrastructure/live";

import {
  decodeToPcm16,
} from "../../../shared/utils/audio-transcode";

import {
  wrapPcmAsWav,
} from "../../../shared/utils/wav";

import {
  AstrologyService,
  McpToolRegistry,
} from "../../astrology";

import {
  MemoryResult,
} from "../../agent";

import {
  ContextBuilder,
} from "../../agent/context/context.builder";

import {
  ContextWindowBuilder,
} from "../../agent/context/context-window.builder";

import {
  ConversationWindowService,
} from "../../conversation";

import {
  BirthProfile,
} from "../../birth-profile";

import {
  PartnerProfile,
} from "../../partner-profile";

import {
  RealtimeOutboundMessage,
  RealtimeSessionContext,
} from "../realtime.types";

import {
  buildDiamondSystemInstruction,
} from "./diamond-system-instruction";

import {
  VoicePipeline,
} from "./voice-pipeline.types";

/**
 * The Live API returns headerless raw PCM with no upfront length —
 * confirmed live it only advertises the true rate through the
 * `audio_chunk` event's own `mimeType` (24kHz observed), so this is
 * a fallback only, not the value actually used when present.
 */
const FALLBACK_OUTPUT_SAMPLE_RATE_HZ = 24000;

/**
 * How much audio to accumulate before flushing a playable segment
 * to the client — a tradeoff, not a correctness requirement.
 *
 * Confirmed live at 0.8s: audible cutting between segments. Root
 * cause is on the app side, not here — `useVoiceSession.ts`'s
 * `tryPlayNext` writes each segment to a new disk file and creates
 * a brand-new native player for it, and only starts that work
 * AFTER the previous segment finishes (no pre-buffering of the
 * next one while the current one plays). That per-segment setup
 * cost is real and roughly constant regardless of segment length,
 * so shorter segments just mean paying it more often. Free/Gold
 * don't show this because a TTS "sentence" is naturally a few
 * seconds long, so the same gap happens far less frequently.
 *
 * Raised to approximate a natural sentence length instead of a
 * fixed short window, to bring transition frequency back down to
 * roughly what Free/Gold already have. A proper fix (pre-buffer the
 * next segment's file+player while the current one is still
 * playing) belongs in `useVoiceSession.ts` and would help all three
 * tiers, not just this constant — not done yet.
 */
const SEGMENT_FLUSH_SECONDS = 3;

/**
 * The name the model calls to recall a saved memory — must match
 * the `LiveToolDeclaration.name` below exactly, since dispatch in
 * the `tool_call` handler checks against this same constant.
 * Diamond-only: Free/Gold get memory retrieval through the planner
 * (either a `plan.memory.required` targeted search or the upfront
 * `ContextBuilder` fallback — see gold-flow.md/free-flow.md), but
 * Diamond has no planner step at all, so there's nothing for a
 * fallback or a required-flag to hang off. Exposing retrieval as a
 * tool is the one mechanism that fits: the model decides at runtime
 * whether something's worth recalling, the same way it already
 * decides when to call an astrology tool.
 */
const MEMORY_TOOL_NAME = "recall_user_memory";

const MEMORY_TOOL_TOP_K = 5;

interface DiamondMemoryDependency {
  extractAndStore(input: {
    userId: string;

    conversationId: string;

    userMessage: string;

    assistantMessage: string;
  }): Promise<void>;

  retrieve(
    userId: string,
    query: string | string[],
    topK: number
  ): Promise<MemoryResult[]>;
}

export interface DiamondVoicePipelineDependencies {
  liveClient: LiveClient;

  liveModel: string;

  liveVoice: string;

  astrologyService: AstrologyService;

  astrologyToolRegistry: McpToolRegistry;

  contextBuilder: ContextBuilder;

  contextWindowBuilder: ContextWindowBuilder;

  conversationWindowService: ConversationWindowService;

  memory: DiamondMemoryDependency;

  logger: AppLogger;
}

/**
 * Per-connection Live session state — created lazily on a
 * connection's first turn, reused across every subsequent
 * `audio:start`/`audio:end` turn on that same WebSocket connection
 * so conversation context stays inside the Live session itself
 * (its whole point — no per-turn context rebuild), and torn down on
 * disconnect via `dispose()`.
 */
interface DiamondSessionState {
  liveSession: LiveSession;

  conversationId: string;

  birthProfile: BirthProfile | null;

  partnerProfile: PartnerProfile | null;
}

/**
 * The Diamond-tier cascade (ROADMAP.md's Phase D): one persistent
 * Gemini Live session per WebSocket connection instead of a fresh
 * planner→MCP→response→TTS cascade per turn. The model listens,
 * decides when to call astrology tools itself, and speaks its own
 * reply — there's no separate STT, planner, response-generation, or
 * TTS step here at all, unlike Free/Gold which share
 * `SentenceSynthesizer`/`DisplayTranslator`.
 *
 * Reuses the SAME push-to-talk `audio:start`/chunks/`audio:end`
 * gateway protocol Free/Gold already use (confirmed live:
 * `LiveSession.endAudioTurn()` closes out a turn on demand, so
 * true continuous streaming + auto-VAD isn't required) — no
 * gateway/app protocol changes needed for this tier.
 */
export class DiamondVoicePipeline
  implements VoicePipeline
{
  private readonly sessions =
    new Map<
      RealtimeSessionContext,
      DiamondSessionState
    >();

  constructor(
    private readonly dependencies: DiamondVoicePipelineDependencies
  ) {}

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

    let state:
      | DiamondSessionState
      | undefined;

    try {
      state =
        await this.getOrCreateSession(
          session
        );

      const pcm16 =
        await decodeToPcm16(
          input.audio
        );

      if (
        abortController.signal
          .aborted
      ) {
        yield this.cancelledEvent(
          input.requestId
        );

        return;
      }

      await this.sendAudioPaced(
        state.liveSession,
        pcm16
      );

      state.liveSession.endAudioTurn();

      let inputText = "";

      let outputText = "";

      let transcribedYielded =
        false;

      /**
       * Audio is streamed to the client in flushed segments as it
       * arrives, NOT buffered for the whole turn and sent once at
       * the end — confirmed live that buffering the whole turn made
       * `firstAudioChunkAt` (below) meaningless: it measured when
       * Gemini's SDK internally produced the first delta, not when
       * the client actually received any audio, since nothing was
       * sent until `turn_complete`. Same `audio:sentence_start`/
       * binary/`audio:sentence_end` framing Free/Gold already use,
       * just size-boxed instead of sentence-text-boxed (Diamond has
       * no text to find sentence breaks in).
       */
      let segmentIndex = 0;

      let segmentChunks: Buffer[] =
        [];

      let segmentBytes = 0;

      let segmentOpen = false;

      let anyAudioSent = false;

      let firstAudioChunkAt:
        | number
        | undefined;

      let outputSampleRate =
        FALLBACK_OUTPUT_SAMPLE_RATE_HZ;

      let turnCompleted = false;

      for await (const event of state
        .liveSession
        .events()) {
        if (
          abortController.signal
            .aborted
        ) {
          yield this.cancelledEvent(
            input.requestId
          );

          return;
        }

        if (
          event.type ===
          "input_transcript"
        ) {
          inputText += event.text;

          if (
            event.final &&
            !transcribedYielded
          ) {
            transcribedYielded =
              true;

            yield {
              type: "audio:transcribed",

              requestId:
                input.requestId,

              payload: {
                text: inputText,
              },

              timestamp:
                new Date().toISOString(),
            };
          }
        }

        if (
          event.type ===
          "output_transcript"
        ) {
          outputText += event.text;
        }

        if (
          event.type ===
          "audio_chunk"
        ) {
          if (!segmentOpen) {
            segmentOpen = true;

            anyAudioSent = true;

            if (
              firstAudioChunkAt ===
              undefined
            ) {
              firstAudioChunkAt =
                performance.now();
            }

            const rateMatch =
              event.mimeType.match(
                /rate=(\d+)/
              );

            if (rateMatch) {
              outputSampleRate =
                Number(
                  rateMatch[1]
                );
            }

            yield {
              type: "audio:sentence_start",

              requestId:
                input.requestId,

              payload: {
                index:
                  segmentIndex,
              },

              timestamp:
                new Date().toISOString(),
            };
          }

          segmentChunks.push(
            event.data
          );

          segmentBytes +=
            event.data.length;

          const flushThresholdBytes =
            outputSampleRate *
            2 *
            SEGMENT_FLUSH_SECONDS;

          if (
            segmentBytes >=
            flushThresholdBytes
          ) {
            yield* this.flushAudioSegment(
              input.requestId,
              segmentIndex,
              segmentChunks,
              outputSampleRate
            );

            segmentIndex += 1;

            segmentChunks = [];

            segmentBytes = 0;

            segmentOpen = false;
          }
        }

        if (
          event.type === "tool_call"
        ) {
          for (const call of event.calls) {
            const result =
              call.name ===
              MEMORY_TOOL_NAME
                ? await this.executeMemorySearch(
                    call,
                    session
                  )
                : await this.executeToolCall(
                    call,
                    state,
                    session,
                    inputText,
                    abortController
                  );

            state.liveSession.sendToolResult(
              call.id,
              call.name,
              result
            );
          }
        }

        if (event.type === "error") {
          this.invalidateSession(
            session
          );

          yield {
            type: "audio:error",

            requestId:
              input.requestId,

            payload: {
              message:
                event.error
                  .message,
            },

            timestamp:
              new Date().toISOString(),
          };

          return;
        }

        if (
          event.type === "closed"
        ) {
          this.invalidateSession(
            session
          );

          break;
        }

        if (
          event.type ===
          "turn_complete"
        ) {
          turnCompleted = true;

          break;
        }
      }

      if (segmentOpen) {
        yield* this.flushAudioSegment(
          input.requestId,
          segmentIndex,
          segmentChunks,
          outputSampleRate
        );
      }

      if (!turnCompleted) {
        yield {
          type: "audio:error",

          requestId:
            input.requestId,

          payload: {
            message:
              "The Live session closed before this turn finished.",
          },

          timestamp:
            new Date().toISOString(),
        };

        return;
      }

      if (!anyAudioSent) {
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

      yield {
        type: "audio:completed",

        requestId:
          input.requestId,

        payload: {},

        timestamp:
          new Date().toISOString(),
      };

      const turnCompletedAt =
        performance.now();

      this.dependencies.logger.debug(
        {
          module: "realtime",
          sessionId:
            session.sessionId,
          requestId:
            input.requestId,

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
        "Realtime audio turn latency (diamond)"
      );

      if (
        inputText.trim() &&
        outputText.trim()
      ) {
        const conversationId =
          session.conversationId as string;

        const userId =
          session.userId as string;

        await this.dependencies.conversationWindowService.recordUserTurn(
          {
            conversationId,
            userId,
            message: inputText,
          }
        );

        await this.dependencies.conversationWindowService.recordAssistantTurn(
          {
            conversationId,
            userId,
            message: outputText,
          }
        );

        void this.dependencies.conversationWindowService
          .maybeSummarize(
            conversationId
          )
          .catch(
            (error: unknown) => {
              this.dependencies.logger.error(
                {
                  err: error,
                  module:
                    "realtime",
                  conversationId,
                },
                "Fire-and-forget summarization failed (diamond)"
              );
            }
          );

        void this.dependencies.memory
          .extractAndStore({
            userId,
            conversationId,
            userMessage:
              inputText,
            assistantMessage:
              outputText,
          })
          .catch(
            (error: unknown) => {
              this.dependencies.logger.error(
                {
                  err: error,
                  module:
                    "realtime",
                  conversationId,
                },
                "Fire-and-forget memory extraction failed (diamond)"
              );
            }
          );
      }
    } catch (error) {
      if (
        abortController.signal
          .aborted
      ) {
        yield this.cancelledEvent(
          input.requestId
        );

        return;
      }

      this.invalidateSession(
        session
      );

      this.dependencies.logger.error(
        {
          err: error,
          module: "realtime",
          sessionId:
            session.sessionId,
          requestId:
            input.requestId,
        },
        "Realtime audio processing failed (diamond)"
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

  dispose(
    session: RealtimeSessionContext
  ): void {
    const state =
      this.sessions.get(session);

    if (state) {
      state.liveSession.close();

      this.sessions.delete(
        session
      );
    }
  }

  private invalidateSession(
    session: RealtimeSessionContext
  ): void {
    this.sessions.delete(session);
  }

  /**
   * Sending every chunk back-to-back in one synchronous burst
   * (no `await` between `sendAudioChunk` calls at all) reproduces
   * live: the Live API accepts the connection fine but then never
   * emits a single event for the rest of the turn — no
   * transcript, no error, nothing, confirmed by isolating this
   * exact variable against both the raw SDK and this wrapper.
   * A small delay between chunks (proven live) avoids it — some
   * server-side ingestion/VAD state doesn't tolerate an entire
   * turn's audio landing in one burst with no pacing at all.
   */
  private async sendAudioPaced(
    liveSession: LiveSession,
    pcm16: Buffer
  ): Promise<void> {
    const chunkSize = 4096;

    for (
      let i = 0;
      i < pcm16.length;
      i += chunkSize
    ) {
      liveSession.sendAudioChunk(
        pcm16.subarray(
          i,
          i + chunkSize
        ),
        "audio/pcm;rate=16000"
      );

      await new Promise((resolve) =>
        setTimeout(resolve, 20)
      );
    }
  }

  private cancelledEvent(
    requestId: string
  ): RealtimeOutboundMessage {
    return {
      type: "audio:cancelled",

      requestId,

      payload: {},

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * Wraps one accumulated audio segment as a self-contained WAV
   * file and closes it out — mirrors
   * `SentenceSynthesizer.synthesizeSentenceFramed`'s start/data/end
   * shape, just called mid-turn at a size threshold instead of at
   * an actual sentence boundary.
   */
  private async *flushAudioSegment(
    requestId: string,
    index: number,
    chunks: Buffer[],
    sampleRate: number
  ): AsyncGenerator<RealtimeOutboundMessage> {
    yield wrapPcmAsWav(
      Buffer.concat(chunks),
      sampleRate,
      1
    );

    yield {
      type: "audio:sentence_end",

      requestId,

      payload: { index },

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * One Live session per WebSocket connection, created on that
   * connection's first turn and reused for every later turn — see
   * `DiamondSessionState`'s doc comment. Recreated if
   * `conversationId` ever changes mid-connection (a `session:start`
   * with a different conversation), since the system instruction
   * and Live session's own context are conversation-specific.
   */
  private async getOrCreateSession(
    session: RealtimeSessionContext
  ): Promise<DiamondSessionState> {
    const conversationId =
      session.conversationId as string;

    const existing =
      this.sessions.get(session);

    if (
      existing &&
      existing.conversationId ===
        conversationId
    ) {
      return existing;
    }

    if (existing) {
      existing.liveSession.close();
    }

    const context =
      await this.dependencies.contextBuilder.build(
        {
          userId:
            session.userId as string,

          conversationId,

          inputType: "voice",
        }
      );

    const window =
      this.dependencies.contextWindowBuilder.build(
        context
      );

    const personaMode =
      context.previousPersonaMode ??
      "blended";

    const systemInstruction =
      buildDiamondSystemInstruction(
        window,
        personaMode
      );

    const liveSession =
      await this.dependencies.liveClient.connect(
        {
          model:
            this.dependencies
              .liveModel,

          systemInstruction,

          tools:
            this.buildToolDeclarations(),

          voiceName:
            this.dependencies
              .liveVoice,
        }
      );

    const state: DiamondSessionState =
      {
        liveSession,
        conversationId,
        birthProfile:
          context.birthProfile,
        partnerProfile:
          context.partnerProfile,
      };

    this.sessions.set(
      session,
      state
    );

    return state;
  }

  /**
   * Deliberately permissive/empty schemas, not each tool's real
   * `inputSchema` — the real schemas require birth-profile fields
   * (day/month/year/lat/lon/tzone) that the model has no business
   * filling in itself (the resolver derives them server-side from
   * the user's stored birth profile regardless of what's passed —
   * see `executeToolCall`). Showing the model that schema risks it
   * hallucinating astronomical values instead of just calling the
   * tool by name. Revisit if a real need for model-supplied args
   * (e.g. an explicit target date) shows up in live testing.
   */
  private buildToolDeclarations(): LiveToolDeclaration[] {
    const astrologyTools =
      this.dependencies.astrologyToolRegistry
        .getEnabled()
        .map((tool) => ({
          name: tool.name,

          description:
            tool.description ?? "",

          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        }));

    /*
     * Unlike the astrology tools above, this one genuinely needs a
     * model-supplied argument — there's no server-derivable "real"
     * value to protect (a search query isn't a birth-profile field
     * the model could hallucinate incorrectly; a vague query just
     * returns weak results, same as it would for Free/Gold's own
     * planner-chosen queries).
     */
    const memoryTool: LiveToolDeclaration =
      {
        name: MEMORY_TOOL_NAME,

        description:
          "Searches the user's saved personal memories from past conversations (preferences, life events, relationships, things they've told you before). Call this when the user references something you might already know about them, or when recalling their history would make your answer more personal and relevant.",

        parameters: {
          type: "object",

          properties: {
            query: {
              type: "string",

              description:
                "A short description of what to recall, e.g. \"user's job\" or \"past relationship questions\".",
            },
          },

          required: ["query"],
        },
      };

    return [
      ...astrologyTools,
      memoryTool,
    ];
  }

  private async executeToolCall(
    call: LiveToolCallRequest,
    state: DiamondSessionState,
    session: RealtimeSessionContext,
    inputTextSoFar: string,
    abortController: AbortController
  ): Promise<unknown> {
    try {
      const results =
        await this.dependencies.astrologyService.executeTools(
          [call.name],
          {
            userId:
              session.userId as string,

            conversationId:
              session.conversationId as string,

            message:
              inputTextSoFar,

            birthProfile:
              state.birthProfile,

            partner:
              state.partnerProfile
                ? {
                    birthProfile:
                      state.partnerProfile,

                    name: state
                      .partnerProfile
                      .name,
                  }
                : undefined,

            extras: call.args,

            signal:
              abortController.signal,
          }
        );

      const result = results[0];

      return result
        ? {
            success:
              result.success,
            content:
              result.content,
            error: result.error,
          }
        : {
            success: false,
            error:
              "Tool produced no result",
          };
    } catch (error) {
      this.dependencies.logger.error(
        {
          err: error,
          module: "realtime",
          sessionId:
            session.sessionId,
          toolName: call.name,
        },
        "Diamond tool call execution failed"
      );

      return {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Tool execution failed",
      };
    }
  }

  /**
   * Backs the `recall_user_memory` tool — Diamond's dedicated
   * memory-retrieval mechanism (see `MEMORY_TOOL_NAME`'s doc
   * comment for why this exists as a tool rather than reusing
   * Free/Gold's planner-driven approach).
   */
  private async executeMemorySearch(
    call: LiveToolCallRequest,
    session: RealtimeSessionContext
  ): Promise<unknown> {
    const query =
      typeof call.args.query ===
      "string"
        ? call.args.query.trim()
        : "";

    if (!query) {
      return {
        memories: [],
        error:
          "No query supplied",
      };
    }

    try {
      const results: MemoryResult[] =
        await this.dependencies.memory.retrieve(
          session.userId as string,
          query,
          MEMORY_TOOL_TOP_K
        );

      return {
        memories: results.map(
          (memory) => ({
            content:
              memory.content,
            category:
              memory.category,
          })
        ),
      };
    } catch (error) {
      this.dependencies.logger.error(
        {
          err: error,
          module: "realtime",
          sessionId:
            session.sessionId,
        },
        "Diamond memory search failed"
      );

      return {
        memories: [],

        error:
          error instanceof Error
            ? error.message
            : "Memory search failed",
      };
    }
  }
}
