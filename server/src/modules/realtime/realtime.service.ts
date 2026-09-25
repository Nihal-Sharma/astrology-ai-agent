import {
  AgentService,
} from "../agent";

import {
  AppLogger,
} from "../../infrastructure/observability/logger";

import {
  ServerEvent,
  RealtimeOutboundMessage,
  RealtimeSessionContext,
} from "./realtime.types";

import {
  rateLimitedTurnsTotal,
} from "../../infrastructure/observability/metrics";

import {
  VoicePipeline,
} from "./pipelines/voice-pipeline.types";

export type {
  RealtimeOutboundMessage,
  RealtimeSessionContext,
} from "./realtime.types";

export class RealtimeService {
  /**
   * Per-user sliding-window turn timestamps — a lightweight,
   * in-process rate limit on the LLM-backed chat/voice path
   * (cost control, see §6 Auth/Platform). `@fastify/rate-limit`
   * covers plain REST endpoints in app.ts, but a chat turn isn't
   * one HTTP request per turn, so it needs its own check here.
   */
  private readonly turnTimestampsByUser =
    new Map<string, number[]>();

  constructor(
    private readonly agentService: AgentService,

    private readonly logger: AppLogger,

    private readonly chatMaxPerMinute: number,

    /**
     * The Free-tier voice cascade (STT → agent → TTS) — see
     * ROADMAP.md's Phase A/B and `VoicePipeline`'s doc comment.
     * `RealtimeService` owns session/protocol concerns (validation,
     * rate limiting, `activeAbortController` lifecycle, which
     * pipeline to invoke) and hands off to this for the actual
     * turn. Also the fallback for Diamond (Phase D — no dedicated
     * pipeline yet), logged in `resolvePipeline` below.
     */
    private readonly freeVoicePipeline: VoicePipeline,

    /**
     * The Gold-tier voice cascade (ROADMAP.md's Phase C) — audio
     * goes straight into the planner call instead of a separate
     * STT step first.
     */
    private readonly goldVoicePipeline: VoicePipeline,

    /**
     * The Diamond-tier cascade (ROADMAP.md's Phase D) — a
     * persistent Gemini Live session per connection instead of a
     * per-turn cascade. Unlike Free/Gold, this pipeline keeps
     * state across turns, so its `dispose()` must be called on
     * disconnect (see `disposeSession` below).
     */
    private readonly diamondVoicePipeline: VoicePipeline
  ) {}

  /**
   * Returns false if `userId` has exceeded
   * `chatMaxPerMinute` turns in the last 60s, recording this
   * attempt as consumed if it hasn't.
   */
  private checkRateLimit(
    userId: string
  ): boolean {
    const now = Date.now();

    const windowMs = 60_000;

    const recent = (
      this.turnTimestampsByUser.get(
        userId
      ) ?? []
    ).filter(
      (timestamp) =>
        now - timestamp < windowMs
    );

    if (
      recent.length >=
      this.chatMaxPerMinute
    ) {
      this.turnTimestampsByUser.set(
        userId,
        recent
      );

      return false;
    }

    recent.push(now);

    this.turnTimestampsByUser.set(
      userId,
      recent
    );

    return true;
  }

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

    if (
      !this.checkRateLimit(
        session.userId
      )
    ) {
      rateLimitedTurnsTotal.inc();

      yield {
        type: "chat:error",

        requestId: input.requestId,

        payload: {
          message:
            "Rate limit exceeded — please slow down.",
        },

        timestamp:
          new Date().toISOString(),
      };

      return;
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
   * One voice turn. Session/protocol-level work only —
   * validation, rate limiting, the `activeAbortController`
   * lifecycle, and picking which pipeline runs the actual
   * cascade (see `VoicePipeline`'s doc comment and ROADMAP.md's
   * Phase A/B/C/D) — the turn itself (STT/reasoning/TTS) is that
   * pipeline's job, delegated to below.
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

    if (
      !this.checkRateLimit(
        session.userId
      )
    ) {
      rateLimitedTurnsTotal.inc();

      yield {
        type: "audio:error",

        requestId: input.requestId,

        payload: {
          message:
            "Rate limit exceeded — please slow down.",
        },

        timestamp:
          new Date().toISOString(),
      };

      return;
    }

    session.activeAbortController?.abort();

    const abortController =
      new AbortController();

    session.activeAbortController =
      abortController;

    session.activeTurnType =
      "audio";

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

    const pipeline =
      this.resolvePipeline(
        session,
        input.requestId
      );

    try {
      yield* pipeline.processAudio(
        session,
        input,
        abortController
      );
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
   * Picks the voice pipeline for this session's plan — see
   * ROADMAP.md's Phase A/B/C/D.
   */
  private resolvePipeline(
    session: RealtimeSessionContext,
    _requestId: string
  ): VoicePipeline {
    if (session.plan === "gold") {
      return this.goldVoicePipeline;
    }

    if (session.plan === "diamond") {
      return this.diamondVoicePipeline;
    }

    return this.freeVoicePipeline;
  }

  /**
   * Called once, when the underlying WebSocket connection closes —
   * gives whichever pipeline was in use a chance to tear down any
   * per-connection state (only Diamond's persistent Live session
   * needs this; Free/Gold are stateless per turn and don't
   * implement `dispose`).
   */
  disposeSession(
    session: RealtimeSessionContext
  ): void {
    this.resolvePipeline(
      session,
      "dispose"
    ).dispose?.(session);
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
