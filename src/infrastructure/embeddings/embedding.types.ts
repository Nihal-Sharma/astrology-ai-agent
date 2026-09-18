export interface EmbeddingOptions {
  model?: string;

  dimensions?: number;
}

export interface EmbeddingClient {
  generateEmbedding(
    text: string,
    options?: EmbeddingOptions
  ): Promise<number[]>;

  /**
   * Batch form — a single OpenAI request embeds every input
   * string, cheaper and faster than N separate calls.
   */
  generateEmbeddings(
    texts: string[],
    options?: EmbeddingOptions
  ): Promise<number[][]>;
}
