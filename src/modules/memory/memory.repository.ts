import { Types } from "mongoose";

import {
  MemoryItemModel,
  MemoryItemDocument,
} from "./memory.model";

import {
  CreateMemoryInput,
} from "./memory.types";

/**
 * Real MongoDB-backed persistence, replacing the original
 * in-memory `Map` stub — see §4 (Memory), item 1.
 */
export class MemoryRepository {
  async create(
    input: CreateMemoryInput
  ): Promise<MemoryItemDocument> {
    return MemoryItemModel.create({
      userId: new Types.ObjectId(
        input.userId
      ),

      fact: input.fact,

      category: input.category,

      embedding: input.embedding,

      importance:
        input.importance ?? 1,

      referenceCount: 1,

      sourceConversationId:
        input.sourceConversationId
          ? new Types.ObjectId(
              input.sourceConversationId
            )
          : undefined,

      lastReferencedAt: new Date(),
    });
  }

  /**
   * Candidate set for brute-force similarity search/dedup —
   * capped and ranked by importance/recency rather than fetching
   * a user's entire memory history unbounded.
   */
  async findByUserId(
    userId: string,
    limit = 300
  ): Promise<MemoryItemDocument[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }

    return MemoryItemModel.find({
      userId,
    })
      .sort({
        importance: -1,
        lastReferencedAt: -1,
      })
      .limit(limit)
      .exec();
  }

  /**
   * Marks an existing memory as re-mentioned: strengthens it
   * instead of storing a near-duplicate row, and resets its
   * decay clock.
   */
  async reinforce(
    id: Types.ObjectId,
    importanceDelta: number
  ): Promise<void> {
    await MemoryItemModel.updateOne(
      {
        _id: id,
      },
      {
        $inc: {
          importance:
            importanceDelta,

          referenceCount: 1,
        },

        $set: {
          lastReferencedAt: new Date(),
        },
      }
    ).exec();
  }
}
