import { Types } from "mongoose";

export interface KnowledgeCard {
  _id: Types.ObjectId;

  topic: string;

  content: string;

  tags: string[];

  /**
   * OpenAI text-embedding-3-small vector (1536 dims) — same
   * embedding infra as §4 (Memory), applied here to knowledge
   * content instead of personal facts.
   */
  embedding: number[];

  createdAt: Date;

  updatedAt: Date;
}

export interface CreateKnowledgeCardInput {
  topic: string;

  content: string;

  tags?: string[];

  embedding: number[];
}
