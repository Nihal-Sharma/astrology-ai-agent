import { Types } from "mongoose";

export type ConversationStatus =
  | "active"
  | "archived";

export type MessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool";

export type MessageContentType =
  | "text"
  | "voice";

/**
 * Mirrors AgentPersonaMode in the agent module — duplicated
 * rather than imported to avoid a reverse module dependency
 * (agent already depends on conversation, not the other way).
 */
export type ConversationPersonaMode =
  | "companion"
  | "astrologer"
  | "blended";

export interface Conversation {
  _id: Types.ObjectId;

  userId: Types.ObjectId;

  title?: string;

  status: ConversationStatus;

  /**
   * Compact summary of the conversation.
   *
   * This is NOT the complete conversation history.
   */
  summary?: string;

  /**
   * Current topic being discussed.
   *
   * Useful for short follow-up messages such as:
   * "why?"
   * "tell me more"
   * "what about Jupiter?"
   */
  currentTopic?: string;

  /**
   * The persona mode picked for the most recent turn — feeds
   * back into the planner as light hysteresis so mode doesn't
   * flip-flop turn to turn on ambiguous messages.
   */
  lastPersonaMode?: ConversationPersonaMode;

  /**
   * Cursor marking which messages are already folded into
   * `summary`. Messages created after this point are still
   * raw/unsummarized.
   */
  summarizedUntil?: Date;

  lastMessageAt?: Date;

  createdAt: Date;

  updatedAt: Date;
}

export interface ConversationMessage {
  _id: Types.ObjectId;

  conversationId: Types.ObjectId;

  userId: Types.ObjectId;

  role: MessageRole;

  content: string;

  contentType: MessageContentType;

  /**
   * Optional metadata attached to the turn.
   *
   * Examples:
   * - voice duration
   * - model used
   * - tool calls
   * - latency
   */
  metadata?: Record<string, unknown>;

  createdAt: Date;
}

export interface CreateConversationInput {
  userId: string;

  title?: string;
}

export interface UpdateConversationInput {
  title?: string;

  status?: ConversationStatus;

  summary?: string;

  currentTopic?: string;

  lastPersonaMode?: ConversationPersonaMode;

  summarizedUntil?: Date;
}

export interface AddMessageInput {
  conversationId: string;

  userId: string;

  role: MessageRole;

  content: string;

  contentType?: MessageContentType;

  metadata?: Record<string, unknown>;
}

export interface ConversationContext {
  conversation: Conversation;

  recentMessages: ConversationMessage[];

  summary?: string;

  currentTopic?: string;
}