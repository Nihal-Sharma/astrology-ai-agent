import {
  RagResult,
} from "../agent/agent.types";

/**
 * Real but intentionally simple, replacing the original
 * pass-through stub — see §5 (RAG), item 1: dedupe by content,
 * then sort by similarity score.
 *
 * A learned/LLM-based reranker is deliberately deferred: with
 * zero-to-a-handful of knowledge cards (no content sourced yet
 * for MVP, per this section's own scope), there's nothing
 * meaningful for a heavier reranker to reorder, and it would
 * add an extra paid LLM call to every RAG-required turn for no
 * benefit yet. Revisit once real content is seeded and result
 * sets are large enough for ranking quality to matter.
 */
export class RAGReranker {
  rerank(results: RagResult[]): RagResult[] {
    const seenContent = new Set<string>();

    const deduped: RagResult[] = [];

    for (const result of results) {
      if (
        seenContent.has(
          result.content
        )
      ) {
        continue;
      }

      seenContent.add(result.content);

      deduped.push(result);
    }

    return deduped.sort(
      (a, b) =>
        (b.score ?? 0) -
        (a.score ?? 0)
    );
  }
}
