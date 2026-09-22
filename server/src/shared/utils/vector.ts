/**
 * Cosine similarity between two equal-length embedding vectors,
 * in [-1, 1] (in practice [0, 1] for OpenAI embeddings).
 *
 * Used for brute-force in-application semantic search (Memory,
 * eventually RAG) instead of a managed vector index — see §4
 * (Memory) for why: at MVP scale (one user's memory count is in
 * the dozens/hundreds, not millions), scanning and ranking in
 * Node is effectively free and avoids the added complexity/
 * latency of provisioning and polling an Atlas Search vector
 * index for something this small.
 */
export function cosineSimilarity(
  a: number[],
  b: number[]
): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
