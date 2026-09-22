import {
  RagResult,
} from "../agent/agent.types";

import {
  RAGRetriever,
} from "./rag.retriever";

import {
  RAGReranker,
} from "./rag.reranker";

/**
 * Public façade for the RAG module, mirroring MemoryService:
 * the single class other modules (the container, the agent
 * orchestrator) depend on. Method is named `retrieve` (not
 * `search`) to match the `queries: string[], topK: number`
 * shape AgentOrchestratorDependencies.rag already expects.
 */
export class RAGService {
  constructor(
    private readonly retriever: RAGRetriever,

    private readonly reranker: RAGReranker
  ) {}

  async retrieve(
    queries: string[],
    topK = 5
  ): Promise<RagResult[]> {
    const results =
      await this.retriever.retrieve(
        queries,
        topK
      );

    return this.reranker.rerank(
      results
    );
  }
}
