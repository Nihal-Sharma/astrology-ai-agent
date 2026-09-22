import { Types } from "mongoose";

export type MemoryCategory =
  | "identity"
  | "preference"
  | "relationship"
  | "life_event"
  | "recurring_topic"
  | "other";

export interface MemoryItem {
  _id: Types.ObjectId;

  userId: Types.ObjectId;

  fact: string;

  category: MemoryCategory;

  /**
   * OpenAI text-embedding-3-small vector (1536 dims), used for
   * brute-force cosine-similarity search — see
   * shared/utils/vector.ts for why this isn't a managed vector
   * index at MVP scale.
   */
  embedding: number[];

  /**
   * How strongly this fact should influence future turns.
   * Bumped each time a similar fact is re-extracted (see
   * MemoryConsolidator.findDuplicate / MemoryRepository.reinforce),
   * and decays over time since `lastReferencedAt` when ranked
   * (see MemoryConsolidator.decayedImportance).
   */
  importance: number;

  referenceCount: number;

  sourceConversationId?: Types.ObjectId;

  lastReferencedAt: Date;

  createdAt: Date;

  updatedAt: Date;
}

export interface CreateMemoryInput {
  userId: string;

  fact: string;

  category: MemoryCategory;

  embedding: number[];

  importance?: number;

  sourceConversationId?: string;
}
