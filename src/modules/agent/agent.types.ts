import { ConversationContext } from "../conversation";
import { BirthProfile } from "../birth-profile";
import { PartnerProfile } from "../partner-profile";

export interface AgentTurnInput {
  userId: string;

  conversationId: string;

  message: string;

  /**
   * voice = request originated from microphone
   * text  = normal text chat
   */
  inputType?: "voice" | "text";

  signal?: AbortSignal;
}

export interface AstrologyToolResult {
  toolName: string;

  success: boolean;

  data?: unknown;

  error?: string;

  executionTimeMs?: number;
}

export interface RagResult {
  query: string;

  content: string;

  score?: number;

  metadata?: Record<string, unknown>;
}

export interface MemoryResult {
  id: string;

  content: string;

  category?: string;

  relevanceScore?: number;
}

export interface AgentExecutionResults {
  mcp: AstrologyToolResult[];

  rag: RagResult[];

  memories: MemoryResult[];
}

export interface AgentResumeInfo {
  /**
   * True when there's prior history in this conversation and
   * the gap since the last message exceeds the configured
   * resume threshold.
   */
  isResuming: boolean;

  /**
   * Human-readable elapsed time since the last message,
   * e.g. "3 days", "about a month". Only set when isResuming.
   */
  gapDescription?: string;
}

export interface AgentPriorConversation {
  summary?: string;

  currentTopic?: string;

  lastMessageAt?: Date;

  gapDescription?: string;
}

export interface AgentContext {
  userId: string;

  conversationId: string;

  currentMessage: string;

  conversation: ConversationContext;

  birthProfile: BirthProfile | null;

  /**
   * A second person's birth details attached to this
   * conversation, for synastry/matchmaking questions.
   */
  partnerProfile: PartnerProfile | null;

  memories: MemoryResult[];

  /**
   * Threaded through from AgentTurnInput so the response
   * prompt can tell voice and text turns apart — previously
   * this field existed on the input but nothing downstream
   * ever read it.
   */
  inputType: "voice" | "text";

  /**
   * The persona mode picked for the previous turn in this
   * conversation, if any — light hysteresis input for the
   * planner so mode doesn't flip-flop on ambiguous messages.
   */
  previousPersonaMode?:
    | "companion"
    | "astrologer"
    | "blended";

  resume: AgentResumeInfo;

  /**
   * Set when the current conversation is brand new (no
   * messages yet) and the user has an older conversation with
   * a summary — lets the assistant carry context across
   * separate conversation threads.
   */
  priorConversation?: AgentPriorConversation;
}

export interface AgentResponse {
  text: string;

  model?: string;

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}