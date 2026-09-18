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
  RagResult,
} from "../agent/agent.types";

import {
  KnowledgeCardRepository,
} from "./knowledge-card/knowledge-card.repository";

/**
 * Real embedding-based semantic search over knowledge cards,
 * replacing the original no-op stub — see §5 (RAG), item 1.
 * Same brute-force cosine-similarity approach as
 * MemoryRetriever, reusing the same embedding client.
 *
 * No knowledge content has been sourced/seeded yet (deliberately
 * out of scope for MVP), so this returns `[]` in practice today
 * — that's the knowledge-card collection being empty, not a
 * limitation of the retrieval path itself.
 */
export class RAGRetriever {
  constructor(
    private readonly repository: KnowledgeCardRepository,

    private readonly embeddingClient: EmbeddingClient,

    private readonly logger: AppLogger
  ) {}

  /**
   * Best-effort: never throws. A failed retrieval just means the
   * turn proceeds with no RAG context, same as having no
   * knowledge cards yet.
   */
  async retrieve(
    queries: string[],
    topK = 5
  ): Promise<RagResult[]> {
    if (topK <= 0 || queries.length === 0) {
      return [];
    }

    const queryText = queries
      .join(". ")
      .trim();

    if (!queryText) {
      return [];
    }

    try {
      const [
        candidates,
        queryEmbedding,
      ] = await Promise.all([
        this.repository.findCandidates(),

        this.embeddingClient.generateEmbedding(
          queryText
        ),
      ]);

      if (candidates.length === 0) {
        return [];
      }

      const scored = candidates.map(
        (card) => ({
          card,

          score: cosineSimilarity(
            queryEmbedding,
            card.embedding
          ),
        })
      );

      scored.sort(
        (a, b) => b.score - a.score
      );

      return scored
        .slice(0, topK)
        .map(({ card, score }) => ({
          query: queryText,

          content: card.content,

          score:
            Math.round(
              score * 1000
            ) / 1000,

          metadata: {
            topic: card.topic,
            tags: card.tags,
          },
        }));
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "rag",
        },
        "RAG retrieval failed"
      );

      return [];
    }
  }
}
