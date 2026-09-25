/**
 * Provider-independent Live (speech-to-speech) session interface —
 * mirrors the LlmClient/STTClient/TTSClient pattern in the other
 * infrastructure/ modules on purpose: Diamond-tier code (ROADMAP.md's
 * Phase D) depends on THESE types, never on `@google/genai`'s Live
 * API shapes directly. If the SDK's event/config shapes change, or
 * we ever swap providers, only `gemini-live.client.ts` changes —
 * nothing in the realtime/agent layers has to.
 */

export interface LiveToolDeclaration {
  name: string;

  description: string;

  /** JSON Schema (OpenAPI-style) — the same shape MCP tools already declare. */
  parameters?: unknown;
}

export interface LiveSessionOptions {
  model: string;

  systemInstruction: string;

  tools?: LiveToolDeclaration[];

  /** A provider voice name (e.g. Gemini's "Kore", "Puck") — not an OpenAI voice id. */
  voiceName?: string;

  signal?: AbortSignal;
}

export interface LiveToolCallRequest {
  id: string;

  name: string;

  args: Record<string, unknown>;
}

/**
 * One session's worth of events, in arrival order. Transcripts and
 * audio are independent of each other (the provider doesn't
 * guarantee ordering between them — see `LiveServerContent`'s own
 * doc comment in the SDK), so callers key off `type`, not position.
 */
export type LiveSessionEvent =
  | {
      type: "input_transcript";

      /** What the user said, per this delta — accumulate across events until `final`. */
      text: string;

      final: boolean;
    }
  | {
      type: "output_transcript";

      /** What the model is saying, per this delta — accumulate across events until `final`. */
      text: string;

      final: boolean;
    }
  | {
      type: "audio_chunk";

      data: Buffer;

      mimeType: string;
    }
  | {
      type: "tool_call";

      calls: LiveToolCallRequest[];
    }
  | {
      /**
       * The model finished generating this turn — a good point to
       * consider the reply "complete" for persistence purposes.
       */
      type: "turn_complete";
    }
  | {
      /**
       * The user started talking over the model's reply — stop
       * local playback immediately if this arrives.
       */
      type: "interrupted";
    }
  | {
      type: "error";

      error: Error;
    }
  | {
      type: "closed";
    };

export interface LiveSession {
  /**
   * Streams one chunk of the user's microphone audio to the model.
   * Input audio must be 16-bit PCM, mono, 16kHz — confirmed live
   * (the API silently produces zero response to any other rate; it
   * does not error).
   */
  sendAudioChunk(
    data: Buffer,
    mimeType: string
  ): void;

  /**
   * Signals that the current push-to-talk turn's audio is fully
   * sent (mirrors the existing `audio:end` gateway event Free/Gold
   * already use) — confirmed live to be what reliably closes out
   * voice-activity-detection and produces a reply; without it the
   * model can sit silently well past a minute of real audio.
   */
  endAudioTurn(): void;

  /** Replies to a `tool_call` event with that call's result. */
  sendToolResult(
    id: string,
    name: string,
    output: unknown
  ): void;

  /** All session events, in arrival order, until the session closes. */
  events(): AsyncIterable<LiveSessionEvent>;

  close(): void;
}

export interface LiveClient {
  connect(
    options: LiveSessionOptions
  ): Promise<LiveSession>;
}
