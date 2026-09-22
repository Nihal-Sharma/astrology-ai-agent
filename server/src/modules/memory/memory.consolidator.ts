import {
  cosineSimilarity,
} from "../../shared/utils/vector";

import {
  MemoryItem,
} from "./memory.types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Merge/dedupe + decay, replacing the original pass-through
 * stub — see §4 (Memory), item 5.
 *
 * Two responsibilities, both driven by the same embedding
 * comparison / time math:
 * - Write path (`findDuplicate`): a newly extracted fact that's
 *   near-identical to an existing memory reinforces it instead
 *   of creating a near-duplicate row — "you mentioned this 3
 *   times" strengthens importance rather than cluttering memory.
 * - Read path (`decayedImportance`): a fact's influence on
 *   ranking fades the longer it's gone unmentioned, so stale
 *   facts naturally lose to fresher/more-repeated ones without
 *   any batch cleanup job.
 */
export class MemoryConsolidator {
  constructor(
    private readonly duplicateSimilarityThreshold: number
  ) {}

  findDuplicate(
    embedding: number[],
    existing: MemoryItem[]
  ): MemoryItem | null {
    let best: {
      item: MemoryItem;
      score: number;
    } | null = null;

    for (const item of existing) {
      const score = cosineSimilarity(
        embedding,
        item.embedding
      );

      if (
        score >=
          this
            .duplicateSimilarityThreshold &&
        (!best || score > best.score)
      ) {
        best = { item, score };
      }
    }

    return best?.item ?? null;
  }

  /**
   * Exponential decay with a 60-day half-life. Referencing a
   * memory again (MemoryRepository.reinforce) resets its
   * `lastReferencedAt` clock, so actively recurring facts never
   * decay in practice — only ones that genuinely stop coming up.
   */
  decayedImportance(
    item: MemoryItem,
    now: Date = new Date()
  ): number {
    const halfLifeDays = 60;

    const daysSinceReferenced =
      Math.max(
        0,
        (now.getTime() -
          item.lastReferencedAt.getTime()) /
          DAY_MS
      );

    const decayFactor = Math.pow(
      0.5,
      daysSinceReferenced /
        halfLifeDays
    );

    return (
      item.importance * decayFactor
    );
  }
}
