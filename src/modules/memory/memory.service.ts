import {
  EmbeddingClient,
} from "../../infrastructure/embeddings";

import {
  AppLogger,
} from "../../infrastructure/observability/logger";

import {
  MemoryResult,
} from "../agent/agent.types";

import {
  MemoryRepository,
} from "./memory.repository";

import {
  MemoryExtractor,
} from "./memory.extractor";

import {
  MemoryRetriever,
} from "./memory.retriever";

import {
  MemoryConsolidator,
} from "./memory.consolidator";

import {
  MemoryItemDocument,
} from "./memory.model";

/**
 * Public façade for the Memory module, mirroring the
 * ConversationWindowService pattern: the single class other
 * modules (the container, the agent orchestrator) depend on,
 * composing the repository/extractor/retriever/consolidator
 * internally.
 */
export class MemoryService {
  constructor(
    private readonly repository: MemoryRepository,

    private readonly extractor: MemoryExtractor,

    private readonly retriever: MemoryRetriever,

    private readonly consolidator: MemoryConsolidator,

    private readonly embeddingClient: EmbeddingClient,

    private readonly logger: AppLogger
  ) {}

  async retrieve(
    userId: string,
    query: string | string[],
    topK = 5
  ): Promise<MemoryResult[]> {
    return this.retriever.retrieve(
      userId,
      query,
      topK
    );
  }

  async getUserMemories(
    userId: string
  ): Promise<MemoryItemDocument[]> {
    return this.repository.findByUserId(
      userId,
      500
    );
  }

  /**
   * Extract durable facts from one turn, dedupe/reinforce
   * against existing memories, and store the rest.
   *
   * Best-effort and fire-and-forget by design (same pattern as
   * ConversationWindowService.maybeSummarize) — called after the
   * user has already received their response, so failures are
   * logged and swallowed rather than surfaced.
   */
  async extractAndStore(input: {
    userId: string;

    conversationId: string;

    userMessage: string;

    assistantMessage: string;
  }): Promise<void> {
    try {
      const facts =
        await this.extractor.extractFacts(
          {
            userMessage:
              input.userMessage,

            assistantMessage:
              input.assistantMessage,
          }
        );

      if (facts.length === 0) {
        return;
      }

      const [existing, embeddings] =
        await Promise.all([
          this.repository.findByUserId(
            input.userId
          ),

          this.embeddingClient.generateEmbeddings(
            facts.map(
              (fact) => fact.fact
            )
          ),
        ]);

      let storedCount = 0;

      let reinforcedCount = 0;

      for (
        let i = 0;
        i < facts.length;
        i++
      ) {
        const fact = facts[i];

        const embedding =
          embeddings[i];

        const duplicate =
          this.consolidator.findDuplicate(
            embedding,
            existing
          );

        if (duplicate) {
          await this.repository.reinforce(
            duplicate._id,
            1
          );

          reinforcedCount++;

          continue;
        }

        const created =
          await this.repository.create(
            {
              userId: input.userId,

              fact: fact.fact,

              category:
                fact.category,

              embedding,

              importance:
                fact.importance,

              sourceConversationId:
                input.conversationId,
            }
          );

        storedCount++;

        /*
         * So a second near-duplicate fact within this SAME
         * batch also dedupes against it, not just against
         * memories that existed before this turn.
         */
        existing.push(created);
      }

      this.logger.debug(
        {
          module: "memory",
          userId: input.userId,
          extractedCount:
            facts.length,
          storedCount,
          reinforcedCount,
        },
        "Memory extraction stored"
      );
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "memory",
          userId: input.userId,
        },
        "Memory extraction failed"
      );
    }
  }
}
