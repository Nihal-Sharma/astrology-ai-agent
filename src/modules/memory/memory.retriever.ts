import {
  EmbeddingClient,
} from "../../infrastructure/embeddings";

import {
  AppLogger,
} from "../../infrastructure/observability/logger";

import {
  cosineSimilarity,
} from "../../shared/utils/vector";

import {
  MemoryResult,
} from "../agent/agent.types";

import {
  MemoryRepository,
} from "./memory.repository";

import {
  MemoryConsolidator,
} from "./memory.consolidator";

/**
 * Real embedding-based semantic search, replacing the original
 * no-op stub — see §4 (Memory), item 3. Brute-force cosine
 * similarity over a user's memory candidates (see
 * shared/utils/vector.ts for why that's the right call at MVP
 * scale rather than a managed vector index).
 */
export class MemoryRetriever {
  constructor(
    private readonly repository: MemoryRepository,

    private readonly embeddingClient: EmbeddingClient,

    private readonly consolidator: MemoryConsolidator,

    private readonly logger: AppLogger
  ) {}

  /**
   * Best-effort: never throws. A failed retrieval just means the
   * turn proceeds with no memory context, same as having no
   * memories yet.
   */
  async retrieve(
    userId: string,
    query: string | string[],
    topK = 5
  ): Promise<MemoryResult[]> {
    if (topK <= 0) {
      return [];
    }

    const queryText = Array.isArray(
      query
    )
      ? query.join(". ")
      : query;

    if (!queryText.trim()) {
      return [];
    }

    try {
      const [
        candidates,
        queryEmbedding,
      ] = await Promise.all([
        this.repository.findByUserId(
          userId
        ),

        this.embeddingClient.generateEmbedding(
          queryText
        ),
      ]);

      if (candidates.length === 0) {
        return [];
      }

      const scored = candidates.map(
        (item) => {
          const similarity =
            cosineSimilarity(
              queryEmbedding,
              item.embedding
            );

          const decayedImportance =
            this.consolidator.decayedImportance(
              item
            );

          /*
           * Similarity dominates ranking; a small importance
           * boost breaks ties in favor of facts mentioned more
           * often / more recently.
           */
          const score =
            similarity *
            (1 +
              Math.min(
                decayedImportance,
                5
              ) *
                0.02);

          return {
            item,
            similarity,
            score,
          };
        }
      );

      scored.sort(
        (a, b) => b.score - a.score
      );

      return scored
        .slice(0, topK)
        .map(
          ({ item, similarity }) => ({
            id: item._id.toString(),

            content: item.fact,

            category: item.category,

            relevanceScore:
              Math.round(
                similarity * 1000
              ) / 1000,
          })
        );
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "memory",
          userId,
        },
        "Memory retrieval failed"
      );

      return [];
    }
  }
}
