import OpenAI from "openai";

import {
  AppLogger,
} from "../observability/logger";

import {
  EmbeddingClient as EmbeddingClientInterface,
  EmbeddingOptions,
} from "./embedding.types";

export interface OpenAiEmbeddingClientOptions {
  apiKey: string;

  defaultModel: string;

  logger: AppLogger;
}

/**
 * Reuses the same OpenAI account/key as the LLM/STT/TTS clients
 * — no separate credential needed. Defaults to
 * `text-embedding-3-small`, the cheapest OpenAI embedding tier,
 * which is more than sufficient for matching short personal-fact
 * strings — see §4 (Memory) cost notes in ROADMAP.md.
 */
export class OpenAiEmbeddingClient
  implements EmbeddingClientInterface
{
  private readonly client: OpenAI;

  private readonly defaultModel: string;

  private readonly logger: AppLogger;

  constructor(
    options: OpenAiEmbeddingClientOptions
  ) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
    });

    this.defaultModel =
      options.defaultModel;

    this.logger = options.logger;
  }

  async generateEmbedding(
    text: string,
    options?: EmbeddingOptions
  ): Promise<number[]> {
    const [embedding] =
      await this.generateEmbeddings(
        [text],
        options
      );

    return embedding;
  }

  async generateEmbeddings(
    texts: string[],
    options?: EmbeddingOptions
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const model =
      options?.model ??
      this.defaultModel;

    const startedAt =
      performance.now();

    try {
      const response =
        await this.client.embeddings.create(
          {
            model,

            input: texts,

            dimensions:
              options?.dimensions,
          }
        );

      const durationMs = Math.round(
        performance.now() -
          startedAt
      );

      this.logger.debug(
        {
          module: "embeddings",
          provider: "openai",
          model,
          count: texts.length,
          durationMs,
        },
        "Embedding generation completed"
      );

      /*
       * The API returns entries with an `index`, but not
       * necessarily preserving input order in the array
       * itself per the spec — sort defensively.
       */
      return response.data
        .slice()
        .sort(
          (a, b) => a.index - b.index
        )
        .map(
          (entry) => entry.embedding
        );
    } catch (error) {
      const durationMs = Math.round(
        performance.now() -
          startedAt
      );

      this.logger.error(
        {
          err: error,
          module: "embeddings",
          provider: "openai",
          model,
          count: texts.length,
          durationMs,
        },
        "Embedding generation failed"
      );

      throw error;
    }
  }
}
