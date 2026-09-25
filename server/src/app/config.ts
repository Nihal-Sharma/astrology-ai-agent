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

/*
 * Read up front, before the frozen config below, so
 * GEMINI_API_KEY's requiredness can depend on them: it's only
 * actually needed if something is configured to use Gemini
 * (the default), not unconditionally — configuring every provider
 * back to "openai" (e.g. in a test env) shouldn't need a Gemini
 * key that's never used.
 */
const llmProvider = getEnv(
  "LLM_PROVIDER",
  "gemini"
);

const sttProvider = getEnv(
  "STT_PROVIDER",
  "gemini"
);

const ttsProvider = getEnv(
  "TTS_PROVIDER",
  "gemini"
);

const geminiApiKey =
  llmProvider === "gemini" ||
  sttProvider === "gemini" ||
  ttsProvider === "gemini"
    ? getEnv("GEMINI_API_KEY")
    : (process.env.GEMINI_API_KEY ??
      "");

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
    /**
     * "openai" or "gemini" — picks which LlmClient container.ts
     * constructs. Defaults to gemini per the move to Gemini for
     * chat/STT/TTS; embeddings (rag.embeddingModel) stay on OpenAI
     * unconditionally regardless of this setting — see
     * OpenAiEmbeddingClient's construction in container.ts.
     */
    provider: llmProvider,

    /** OpenAI key — used for embeddings always, and for LLM/STT/TTS only if their provider is "openai". */
    apiKey: getEnv("LLM_API_KEY"),

    model: getEnv(
      "LLM_MODEL",
      "gemini-3.8-flash"
    ),

    /**
     * Used for small, latency-sensitive helper calls that don't
     * need `model`'s full depth — e.g. translating a transcript
     * for display (see RealtimeService.translateForDisplay) and
     * the agent planner's routing decision (see PlannerService,
     * container.ts) — a fully sequential call that blocks the
     * whole turn, so its latency matters more than its quality.
     */
    fastModel: getEnv(
      "LLM_FAST_MODEL",
      "gemini-3.1-flash-lite"
    ),

    /**
     * Reasoning effort for the main conversational response
     * (ResponseService) — OpenAI-only: ignored entirely by
     * GeminiLlmClient, and even for OpenAI it's only meaningful if
     * `model` is a reasoning model (gpt-5/o-series) — OpenAI's
     * Responses API rejects the `reasoning` param outright for a
     * non-reasoning model like gpt-4o/gpt-4.1. Unset by default on
     * purpose, so nothing sends this param until explicitly
     * configured. Read directly rather than via getEnv, since
     * getEnv treats "" as "missing" and would throw on nothing
     * being set.
     */
    responseReasoningEffort:
      process.env
        .LLM_RESPONSE_REASONING_EFFORT as
        | "none"
        | "minimal"
        | "low"
        | "medium"
        | "high"
        | "xhigh"
        | "max"
        | undefined,
  },

  /**
   * Gemini (`@google/genai`) credential — separate from `llm.apiKey`
   * (OpenAI), since embeddings stay on OpenAI regardless of
   * `llm.provider`/`speech.*Provider`. Only actually required when
   * at least one of those three is "gemini" (see geminiApiKey
   * above) — the server won't start without it in that case.
   */
  gemini: {
    apiKey: geminiApiKey,
  },

  speech: {
    sttProvider,

    ttsProvider,

    /**
     * gemini-3.5-transcribe: Gemini's dedicated transcription
     * model. Unlike OpenAI's STT, this requires an upload-then-
     * transcribe round-trip (see GeminiSttClient) — a real latency
     * cost, accepted deliberately (see ROADMAP.md).
     */
    sttModel: getEnv(
      "STT_MODEL",
      "gemini-3.5-transcribe"
    ),

    /**
     * gemini-3.1-flash-tts-preview: the first Gemini TTS-tier
     * model with streaming support, matching this app's
     * sentence-by-sentence speculative synthesis.
     */
    ttsModel: getEnv(
      "TTS_MODEL",
      "gemini-3.1-flash-tts-preview"
    ),

    /**
     * A Gemini prebuilt voice name (e.g. Kore, Puck) — NOT an
     * OpenAI voice id, these don't carry over between providers.
     */
    ttsVoice: getEnv(
      "TTS_VOICE",
      "Kore"
    ),

    /**
     * Style/delivery guidance. Gemini TTS has no separate
     * `instructions` parameter like gpt-4o-mini-tts — style is
     * steered by prefixing natural-language direction onto the
     * text itself instead (see GeminiTtsClient.toStyledInput).
     * Untested against a live key; may need rephrasing once heard.
     */
    ttsInstructions: getEnv(
      "TTS_INSTRUCTIONS",
      "Speak as a warm, friendly Indian woman with a natural Indian English accent. Gentle, conversational pacing — like a trusted friend, not a formal announcer."
    ),

    /**
     * Playback rate — only honored by OpenAiTtsClient (OpenAI's
     * own range is 0.25 to 4.0, 1.0 is normal). No confirmed
     * numeric speed control in Gemini's TTS API, so GeminiTtsClient
     * silently ignores this.
     */
    ttsSpeed: getEnvNumber(
      "TTS_SPEED",
      1.2
    ),
  },

  /**
   * Diamond-tier only (ROADMAP.md's Phase D) — Gemini's Live
   * (speech-to-speech) API, a different serving surface from
   * `speech.*` above (no STT/TTS calls at all).
   */
  live: {
    /**
     * gemini-3.1-flash-live-preview: confirmed live via direct
     * `ListModels` query — the SDK's own doc-comment `@example`
     * blocks reference model names (`gemini-live-2.5-flash-preview`,
     * `gemini-2.0-flash-live-preview-04-09`) that don't exist for
     * this API version/account; both hang forever on connect (see
     * `GeminiLiveClient`'s `withConnectTimeout`) rather than
     * erroring, so this isn't a mistake that fails loudly if
     * copied from there again.
     */
    model: getEnv(
      "LIVE_MODEL",
      "gemini-3.1-flash-live-preview"
    ),

    /** A Gemini prebuilt voice name — same set as `speech.ttsVoice`. */
    voice: getEnv(
      "LIVE_VOICE",
      "Kore"
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

  auth: {
    /**
     * Required — there is no safe default for a signing
     * secret. Generate with:
     * node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     */
    jwtSecret: getEnv("JWT_SECRET"),

    jwtExpiresIn: getEnv(
      "JWT_EXPIRES_IN",
      "30d"
    ),
  },

  cors: {
    origin: getEnv("CORS_ORIGIN", "*"),
  },

  rateLimit: {
    /**
     * General REST API limit.
     */
    max: getEnvNumber(
      "RATE_LIMIT_MAX",
      100
    ),

    windowMs: getEnvNumber(
      "RATE_LIMIT_WINDOW_MS",
      60_000
    ),

    /**
     * Separate, stricter limit on LLM-backed chat/voice turns
     * over the realtime WebSocket (cost control) — REST-level
     * rate limiting doesn't apply there since it's not a normal
     * HTTP request per turn.
     */
    chatMaxPerMinute: getEnvNumber(
      "CHAT_RATE_LIMIT_PER_MINUTE",
      20
    ),
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