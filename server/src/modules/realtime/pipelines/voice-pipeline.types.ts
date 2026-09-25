import {
  RealtimeOutboundMessage,
  RealtimeSessionContext,
} from "../realtime.types";

/**
 * One tier's audio-turn cascade — see ROADMAP.md's Phase A/B/C/D.
 * `RealtimeService.processAudio` owns everything session/protocol-
 * level (validation, rate limiting, `activeAbortController`
 * lifecycle, which pipeline to invoke for `session.plan`) and hands
 * off to a `VoicePipeline` for the actual turn: STT/reasoning/TTS,
 * whatever shape that takes for this tier. `FreeVoicePipeline` is
 * the only real implementation today; Gold/Diamond are still a
 * fallback to it (Phase C/D).
 */
export interface VoicePipeline {
  processAudio(
    session: RealtimeSessionContext,

    input: {
      requestId: string;

      audio: Buffer;

      format?: string;
    },

    abortController: AbortController
  ): AsyncIterable<RealtimeOutboundMessage>;

  /**
   * Called once, when the underlying WebSocket connection closes —
   * only meaningful for a pipeline that keeps per-connection state
   * across turns (Diamond's persistent Live session; see
   * `DiamondVoicePipeline`). Free/Gold are stateless per turn and
   * don't implement this.
   */
  dispose?(
    session: RealtimeSessionContext
  ): void;
}
