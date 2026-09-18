import "dotenv/config";

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getEnvNumber(name: string, fallback?: number): number {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue === "") {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new Error(`Missing required environment variable: ${name}`);
  }

  const value = Number(rawValue);

  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return value;
}

function getEnvBoolean(name: string, fallback = false): boolean {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return ["true", "1", "yes"].includes(value.toLowerCase());
}

export const config = Object.freeze({
  app: {
    name: getEnv("APP_NAME", "astrology-ai-agent"),
    env: getEnv("NODE_ENV", "development"),
    host: getEnv("HOST", "0.0.0.0"),
    port: getEnvNumber("PORT", 3000),
  },

  database: {
    mongoUri: getEnv("MONGO_URI"),
  },

  redis: {
    url: getEnv("REDIS_URL", "redis://localhost:6379"),
  },

  llm: {
    provider: getEnv("LLM_PROVIDER", "openai"),
    apiKey: getEnv("LLM_API_KEY"),
    model: getEnv("LLM_MODEL", "gpt-5"),
  },

  speech: {
    sttProvider: getEnv("STT_PROVIDER", "openai"),
    ttsProvider: getEnv("TTS_PROVIDER", "openai"),

    /**
     * gpt-4o-mini-transcribe: cheap, and (unlike whisper-1)
     * supports streaming partial transcripts.
     */
    sttModel: getEnv(
      "STT_MODEL",
      "gpt-4o-mini-transcribe"
    ),

    /**
     * gpt-4o-mini-tts: cheapest OpenAI TTS tier that still
     * supports streaming audio output.
     */
    ttsModel: getEnv(
      "TTS_MODEL",
      "gpt-4o-mini-tts"
    ),
  },

  rag: {
    embeddingProvider: getEnv("EMBEDDING_PROVIDER", "openai"),
    vectorStore: getEnv("VECTOR_STORE", "pgvector"),

    /**
     * text-embedding-3-small: cheapest OpenAI embedding tier —
     * more than sufficient for matching short personal-fact
     * strings (Memory) and knowledge-card snippets (RAG).
     */
    embeddingModel: getEnv(
      "EMBEDDING_MODEL",
      "text-embedding-3-small"
    ),
  },

  mcp: {
    astrologyServerUrl: getEnv(
      "ASTROLOGY_MCP_SERVER_URL",
      "http://localhost:4001"
    ),
    astrologyApiKey: getEnv(
    "ASTROLOGY_MCP_API_KEY"
  ),
    requestTimeoutMs: getEnvNumber("MCP_REQUEST_TIMEOUT_MS", 5000),
  },

  features: {
    enableMemory: getEnvBoolean("ENABLE_MEMORY", true),
    enableRag: getEnvBoolean("ENABLE_RAG", true),
    enableMcp: getEnvBoolean("ENABLE_MCP", true),
  },

  agent: {
    /**
     * Total token budget for assembled prompt context
     * (summary + memories + MCP + RAG + recent messages).
     *
     * Deliberately conservative for cost/latency — not a hard
     * model context limit.
     */
    contextTokenBudget: getEnvNumber(
      "CONTEXT_TOKEN_BUDGET",
      6000
    ),

    /**
     * Number of most-recent messages always kept in full,
     * never folded into the rolling summary.
     */
    recentMessageKeepCount: getEnvNumber(
      "CONTEXT_RECENT_MESSAGE_COUNT",
      20
    ),

    /**
     * Minimum number of backlog messages required before
     * triggering a rolling-summary update.
     */
    summaryBatchSize: getEnvNumber(
      "CONTEXT_SUMMARY_BATCH_SIZE",
      15
    ),

    /**
     * Gap since the last message, in hours, after which a
     * turn is treated as a "resume" and gets a recap note.
     */
    resumeGapHours: getEnvNumber(
      "CONTEXT_RESUME_GAP_HOURS",
      6
    ),
  },

  memory: {
    /**
     * Cosine-similarity threshold above which a newly
     * extracted fact is treated as reinforcing an existing
     * memory (bump importance/referenceCount) rather than
     * being stored as a new, separate one.
     */
    duplicateSimilarityThreshold: getEnvNumber(
      "MEMORY_DUPLICATE_SIMILARITY_THRESHOLD",
      0.88
    ),
  },
});

export type AppConfig = typeof config;