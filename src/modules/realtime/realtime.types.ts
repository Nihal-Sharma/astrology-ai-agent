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