import {
  KnowledgeCardModel,
  KnowledgeCardDocument,
} from "./knowledge-card.model";

import {
  CreateKnowledgeCardInput,
} from "./knowledge-card.types";

/**
 * Real MongoDB-backed persistence, replacing the original
 * in-memory `Map` stub — see §5 (RAG), item 1. No content is
 * sourced/seeded yet (deliberately out of scope for MVP), so
 * this collection is expected to be empty until that happens;
 * the retrieval path below is fully real regardless.
 */
export class KnowledgeCardRepository {
  async create(
    input: CreateKnowledgeCardInput
  ): Promise<KnowledgeCardDocument> {
    return KnowledgeCardModel.create({
      topic: input.topic,

      content: input.content,

      tags: input.tags ?? [],

      embedding: input.embedding,
    });
  }

  async findByTopic(
    topic: string
  ): Promise<KnowledgeCardDocument[]> {
    return KnowledgeCardModel.find({
      topic,
    }).exec();
  }

  /**
   * Candidate set for brute-force similarity search — see
   * shared/utils/vector.ts for why this isn't a managed vector
   * index at MVP scale (same reasoning as MemoryRepository).
   */
  async findCandidates(
    limit = 500
  ): Promise<KnowledgeCardDocument[]> {
    return KnowledgeCardModel.find({})
      .limit(limit)
      .exec();
  }
}
