import {
  EmbeddingClient,
} from "../../../infrastructure/embeddings";

import {
  KnowledgeCardRepository,
} from "./knowledge-card.repository";

import {
  KnowledgeCardDocument,
} from "./knowledge-card.model";

/**
 * Write-side entry point for knowledge content — not called
 * anywhere yet (no content has been sourced for MVP), but real
 * rather than a stub: whenever content does get authored, this
 * is the one place that embeds and persists it, ready for
 * scripts/seed-knowledge-cards.ts to call.
 */
export class KnowledgeCardService {
  constructor(
    private readonly repository: KnowledgeCardRepository,

    private readonly embeddingClient: EmbeddingClient
  ) {}

  async createCard(
    topic: string,
    content: string,
    tags: string[] = []
  ): Promise<KnowledgeCardDocument> {
    const embedding =
      await this.embeddingClient.generateEmbedding(
        `${topic}\n${content}`
      );

    return this.repository.create({
      topic,
      content,
      tags,
      embedding,
    });
  }
}
