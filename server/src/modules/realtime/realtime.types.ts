import {
  VoicePlan,
} from "../user/user.types";

export type ClientEventType =
  | "session:start"
  | "chat:send"
  | "chat:cancel"
  | "session:end"
  | "audio:start"
  | "audio:end";

export type ServerEventType =
  | "session:ready"
  | "chat:started"
  | "chat:delta"
  | "chat:completed"
  | "chat:error"
  | "chat:cancelled"
  | "audio:transcribed"
  | "audio:sentence_start"
  | "audio:sentence_end"
  | "audio:completed"
  | "audio:error"
  | "audio:cancelled"
  | "turn:mode";

export interface ClientEvent {
  type: ClientEventType;

  requestId: string;

  payload?: unknown;
}

export interface ServerEvent {
  type: ServerEventType;

  requestId: string;

  payload?: unknown;

  timestamp: string;
}

/*
 * ------------------------------------------------------------
 * Audio wire format — decided: raw binary WebSocket frames for
 * audio data, JSON text frames for everything else (control
 * events + lifecycle markers around the audio stream).
 *
 * WebRTC was the alternative on the table but is a much bigger
 * lift (ICE/STUN/TURN, SDP negotiation, browser-specific APIs)
 * for a marginal latency win at MVP stage — not worth it yet.
 * Raw binary WS frames were chosen over the initial
 * base64-in-JSON approach because it's a small, contained
 * change with a real, measurable win: no ~33% base64 overhead
 * and no JSON stringify/parse cost on every audio chunk, which
 * matters since these are the highest-frequency messages on
 * the socket by far.
 *
 * Client → server: after `audio:start`, every binary WS frame
 * (`isBinary` in `ws`'s `message` event) is raw audio bytes,
 * appended to the buffer for the current turn — no JSON
 * envelope. `audio:end` (JSON) closes the turn and triggers
 * processing.
 *
 * Server → client: synthesized audio is sent as raw binary WS
 * frames directly (see `RealtimeOutboundMessage` in
 * realtime.service.ts) — no `audio:delta` JSON event exists.
 * `audio:transcribed`/`completed`/`error`/`cancelled` remain
 * JSON since they're infrequent, structured status markers,
 * not high-frequency data.
 *
 * Sentence boundaries: `audio:sentence_start` (JSON) opens each
 * sentence's audio segment, then that sentence's binary frames
 * follow, then `audio:sentence_end` (JSON) closes it — before
 * the next sentence's `audio:sentence_start` or, for the last
 * sentence, before `audio:completed`. This lets the client treat
 * each sentence as an independently-playable clip and start
 * playback as soon as the FIRST one is ready, instead of
 * buffering the entire reply. `index` is 0-based and increments
 * per sentence within a turn — informational only, since events
 * arrive in order on a single connection.
 * ------------------------------------------------------------
 */

export interface AudioStartPayload {
  /** e.g. "pcm", "webm" — matches STTOptions.format. */
  format?: string;

  sampleRate?: number;
}

export interface AudioTranscribedPayload {
  text: string;
}

/** Payload for both `audio:sentence_start` and `audio:sentence_end`. */
export interface AudioSentencePayload {
  index: number;
}

/**
 * Sent once per turn, as soon as the planner has decided the
 * persona mode — before response generation starts, for either
 * a text or a voice turn (same shape, one shared event rather
 * than separate chat:mode/audio:mode variants, since this is
 * purely informational metadata with no channel-specific
 * behavior). See §3 (persona system) "expose current mode to
 * the client".
 */
export interface TurnModePayload {
  personaMode:
    | "companion"
    | "astrologer"
    | "blended";

  responseMode:
    | "direct"
    | "mcp"
    | "rag"
    | "mcp_rag";
}

/**
 * What a gateway loop actually sends over the socket: a JSON
 * control/status event, or a raw binary audio frame (see the
 * wire-format decision above). The gateway checks
 * `Buffer.isBuffer(message)` to pick `socket.send` raw vs.
 * `JSON.stringify` first.
 */
export type RealtimeOutboundMessage =
  | ServerEvent
  | Buffer;

export interface RealtimeSessionContext {
  sessionId: string;

  userId?: string;

  /**
   * Which voice pipeline this session should use (see ROADMAP.md's
   * Phase A/B/C/D) — resolved once at connect time from the user's
   * stored plan (realtime.gateway.ts), not re-checked mid-session.
   * A plan upgrade takes effect on the user's next reconnect, not
   * instantly — an accepted, bounded staleness window, not a gap
   * (the app already reconnects automatically on drop). Only
   * "free" has an implemented pipeline today (FreeVoicePipeline);
   * "gold"/"diamond" fall back to it with a log line until Phase
   * C/D build their own (see RealtimeService.processAudio).
   */
  plan: VoicePlan;

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