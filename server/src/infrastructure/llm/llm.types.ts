export type LlmRole =
  | "system"
  | "user"
  | "assistant";

export interface LlmMessage {
  role: LlmRole;

  content: string;
}

export interface LlmGenerateInput {
  /**
   * System/developer instructions for the model.
   */
  instructions?: string;

  /**
   * Conversation/input messages.
   */
  messages: LlmMessage[];

  /**
   * Optional model override.
   */
  model?: string;

  /**
   * Maximum output tokens.
   */
  maxOutputTokens?: number;

  /**
   * Temperature.
   *
   * Keep undefined unless a specific provider/model
   * supports and benefits from it.
   */
  temperature?: number;

  /**
   * Reasoning effort, for reasoning models only (e.g. gpt-5) —
   * ignored by non-reasoning models. Lower effort trades some
   * depth for a faster time-to-first-token, without switching
   * away from the model's underlying knowledge/quality the way
   * swapping to a smaller model would. See OpenAiLlmClient.
   */
  reasoningEffort?:
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";

  /**
   * Request cancellation.
   */
  signal?: AbortSignal;

  /**
   * Inline audio attached alongside the text prompt — used by the
   * Gold-tier voice pipeline (ROADMAP.md's Phase C) to skip a
   * separate STT call: the planner call itself transcribes the
   * audio and produces its routing decision in one shot. Only
   * `GeminiLlmClient` honors this today (`OpenAiLlmClient` ignores
   * it — no current caller needs audio input on the OpenAI path,
   * since Gold/Diamond are Gemini-only tiers).
   */
  audio?: {
    data: Buffer;

    mimeType: string;
  };
}

export interface LlmUsage {
  inputTokens?: number;

  outputTokens?: number;

  totalTokens?: number;
}

export interface LlmResponse {
  text: string;

  model: string;

  usage?: LlmUsage;

  providerRequestId?: string;
}

export interface LlmStreamChunk {
  type:
    | "text_delta"
    | "completed"
    | "error";

  text?: string;

  response?: LlmResponse;

  error?: Error;
}

/**
 * Provider-independent LLM interface.
 *
 * The Agent should depend on this interface,
 * never directly on OpenAI.
 */
export interface LlmClient {
  generate(
    input: LlmGenerateInput
  ): Promise<LlmResponse>;

  stream(
    input: LlmGenerateInput
  ): AsyncIterable<LlmStreamChunk>;
}