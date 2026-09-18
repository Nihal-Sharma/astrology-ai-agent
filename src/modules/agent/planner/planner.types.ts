export type AgentResponseMode =
  | "direct"
  | "mcp"
  | "rag"
  | "mcp_rag";

/**
 * companion  = casual, emotionally present, friend-like.
 * astrologer = structured, technical-but-accessible chart
 *              interpretation.
 * blended    = a natural mix of both — the common case for
 *              most real conversations (e.g. "I'm anxious
 *              about my job interview" gets an empathetic
 *              response grounded in a relevant transit).
 */
export type AgentPersonaMode =
  | "companion"
  | "astrologer"
  | "blended";

export interface AgentPlan {
  responseMode: AgentResponseMode;

  personaMode: AgentPersonaMode;

  reasoning: string;

  mcp: {
    required: boolean;

    tools: string[];

    parallel: boolean;

    /**
     * ISO date (YYYY-MM-DD) the user's question is centered
     * on, when it's about a specific date/period or
     * transits/predictions rather than their fixed birth
     * chart (e.g. "what does my week look like" -> today;
     * "when is my next Saturn transit" -> today). Null when
     * the question is about the natal chart itself.
     */
    targetDate: string | null;

    /**
     * Span of days from targetDate for period-style questions
     * ("this week" -> 7, "this month" -> 30). Null for a
     * single-date question.
     */
    targetRangeDays: number | null;
  };

  rag: {
    required: boolean;

    queries: string[];

    topK: number;
  };

  memory: {
    required: boolean;

    queries: string[];

    topK: number;
  };
}