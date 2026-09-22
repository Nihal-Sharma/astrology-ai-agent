/**
 * Mirrors server/src/modules/realtime/realtime.types.ts — see that
 * file for the full wire-format rationale (binary frames for
 * audio, JSON for everything else).
 */

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

/** Payload for both `audio:sentence_start` and `audio:sentence_end`. */
export interface AudioSentencePayload {
  index: number;
}

export interface TurnModePayload {
  personaMode: "companion" | "astrologer" | "blended";
  responseMode: "direct" | "mcp" | "rag" | "mcp_rag";
}
