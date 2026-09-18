import {
  LlmClient,
  LlmGenerateInput,
  LlmResponse,
} from "./llm.types";

export interface StreamCallbacks {
  onText?: (
    text: string
  ) => Promise<void> | void;

  onComplete?: (
    response: LlmResponse
  ) => Promise<void> | void;

  onError?: (
    error: Error
  ) => Promise<void> | void;
}

export async function consumeLlmStream(
  client: LlmClient,
  input: LlmGenerateInput,
  callbacks: StreamCallbacks
): Promise<void> {
  try {
    for await (
      const chunk of client.stream(input)
    ) {
      switch (chunk.type) {
        case "text_delta": {
          if (
            chunk.text !== undefined
          ) {
            await callbacks.onText?.(
              chunk.text
            );
          }

          break;
        }

        case "completed": {
          if (chunk.response) {
            await callbacks.onComplete?.(
              chunk.response
            );
          }

          break;
        }

        case "error": {
          if (chunk.error) {
            await callbacks.onError?.(
              chunk.error
            );
          }

          break;
        }
      }
    }
  } catch (error) {
    const normalizedError =
      error instanceof Error
        ? error
        : new Error(
            String(error)
          );

    await callbacks.onError?.(
      normalizedError
    );

    throw normalizedError;
  }
}