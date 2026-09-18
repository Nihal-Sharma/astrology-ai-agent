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
   * Request cancellation.
   */
  signal?: AbortSignal;
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