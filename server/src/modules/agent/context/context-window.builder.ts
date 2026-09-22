import {
  AgentContext,
  AgentPriorConversation,
} from "../agent.types";

import {
  countTokens,
  capTokens,
} from "../../../shared/utils/tokenizer";

export interface PromptContextWindow {
  userId: string;

  conversationId: string;

  currentMessage: string;

  inputType: "voice" | "text";

  /**
   * Set when the user is returning after a long gap — an
   * explicit note for the model to acknowledge it naturally.
   */
  resumeNote?: string;

  /**
   * Set when this is a brand-new conversation and the user
   * has an older conversation with a summary worth surfacing.
   */
  priorConversationNote?: string;

  conversationSummary?: string;

  currentTopic?: string;

  /**
   * Persona mode from the previous turn — hysteresis input for
   * the planner (see AgentContext.previousPersonaMode).
   */
  previousPersonaMode?:
    | "companion"
    | "astrologer"
    | "blended";

  recentMessages: Array<{
    role: string;

    content: string;
  }>;

  birthProfile?: {
    dateOfBirth: string;

    timeOfBirth: string;

    placeOfBirth: string;

    latitude: number;

    longitude: number;

    timezone: string;
  };

  /**
   * A second person attached to this conversation, for
   * synastry/matchmaking questions.
   */
  partnerProfile?: {
    name?: string;

    dateOfBirth: string;

    timeOfBirth: string;

    placeOfBirth: string;

    latitude: number;

    longitude: number;

    timezone: string;
  };

  memories: Array<{
    content: string;

    category?: string;
  }>;
}

export interface ContextWindowBuilderOptions {
  /**
   * Total token budget for the assembled context (everything
   * except the current message and results computed later,
   * like MCP/RAG, which are budgeted separately downstream).
   */
  totalTokens: number;
}

const NOTES_TOKEN_BUDGET = 500;

const MEMORIES_TOKEN_BUDGET = 400;

const MAX_MEMORIES = 5;

/**
 * Assembles a token-budgeted view of `AgentContext` for
 * prompting. Replaces the old (unused) `ContextPruner` —
 * shared by both the planner and the responder so history
 * trimming happens in exactly one place.
 */
export class ContextWindowBuilder {
  constructor(
    private readonly options: ContextWindowBuilderOptions
  ) {}

  build(
    context: AgentContext
  ): PromptContextWindow {
    const resumeNote =
      context.resume.isResuming
        ? `The user is returning after ${context.resume.gapDescription}. Acknowledge the gap briefly and naturally if it fits, then continue helpfully.`
        : undefined;

    const priorConversationNote =
      context.priorConversation
        ? capTokens(
            this.buildPriorConversationNote(
              context.priorConversation
            ),
            NOTES_TOKEN_BUDGET
          )
        : undefined;

    const conversationSummary =
      context.conversation.summary
        ? capTokens(
            context.conversation
              .summary,
            NOTES_TOKEN_BUDGET
          )
        : undefined;

    const birthProfile =
      context.birthProfile
        ? {
            dateOfBirth:
              context.birthProfile.dateOfBirth.toISOString(),

            timeOfBirth:
              context.birthProfile
                .timeOfBirth,

            placeOfBirth:
              context.birthProfile
                .placeOfBirth,

            latitude:
              context.birthProfile
                .latitude,

            longitude:
              context.birthProfile
                .longitude,

            timezone:
              context.birthProfile
                .timezone,
          }
        : undefined;

    const partnerProfile =
      context.partnerProfile
        ? {
            name:
              context.partnerProfile
                .name,

            dateOfBirth:
              context.partnerProfile.dateOfBirth.toISOString(),

            timeOfBirth:
              context.partnerProfile
                .timeOfBirth,

            placeOfBirth:
              context.partnerProfile
                .placeOfBirth,

            latitude:
              context.partnerProfile
                .latitude,

            longitude:
              context.partnerProfile
                .longitude,

            timezone:
              context.partnerProfile
                .timezone,
          }
        : undefined;

    const memories = context.memories
      .slice(0, MAX_MEMORIES)
      .map((memory) => ({
        content: capTokens(
          memory.content,
          Math.floor(
            MEMORIES_TOKEN_BUDGET /
              MAX_MEMORIES
          )
        ),

        category: memory.category,
      }));

    const fixedTokens =
      countTokens(resumeNote ?? "") +
      countTokens(
        priorConversationNote ?? ""
      ) +
      countTokens(
        conversationSummary ?? ""
      ) +
      countTokens(
        context.conversation
          .currentTopic ?? ""
      ) +
      countTokens(
        JSON.stringify(
          birthProfile ?? {}
        )
      ) +
      countTokens(
        JSON.stringify(
          partnerProfile ?? {}
        )
      ) +
      countTokens(
        JSON.stringify(memories)
      );

    const remainingBudget =
      Math.max(
        0,
        this.options.totalTokens -
          fixedTokens
      );

    const recentMessages =
      this.fitRecentMessages(
        context.conversation
          .recentMessages,
        context.currentMessage,
        remainingBudget
      );

    return {
      userId: context.userId,

      conversationId:
        context.conversationId,

      currentMessage:
        context.currentMessage,

      inputType:
        context.inputType,

      resumeNote,

      priorConversationNote,

      conversationSummary,

      currentTopic:
        context.conversation
          .currentTopic,

      previousPersonaMode:
        context.previousPersonaMode,

      recentMessages,

      birthProfile,

      partnerProfile,

      memories,
    };
  }

  private buildPriorConversationNote(
    prior: AgentPriorConversation
  ): string {
    const gap =
      prior.gapDescription
        ? ` (${prior.gapDescription} ago)`
        : "";

    const topic =
      prior.currentTopic
        ? ` Last topic: ${prior.currentTopic}.`
        : "";

    return `This is a new conversation, but the same user had an earlier conversation${gap}. Earlier summary: ${prior.summary}.${topic} Treat this only as light background — it is a different thread, not the current one.`;
  }

  private fitRecentMessages(
    messages: Array<{
      role: string;

      content: string;
    }>,

    currentMessage: string,

    budgetTokens: number
  ): Array<{
    role: string;

    content: string;
  }> {
    /*
     * The current turn's user message is already persisted
     * (and rendered separately as the "current message"), so
     * drop it from the transcript to avoid showing it twice.
     */
    const history =
      messages.length > 0 &&
      messages[messages.length - 1]
        .role === "user" &&
      messages[messages.length - 1]
        .content === currentMessage
        ? messages.slice(0, -1)
        : messages;

    const included: Array<{
      role: string;

      content: string;
    }> = [];

    let used = 0;

    for (
      let index = history.length - 1;
      index >= 0;
      index -= 1
    ) {
      const message = history[index];

      const cost = countTokens(
        `${message.role}: ${message.content}`
      );

      if (
        used + cost >
          budgetTokens &&
        included.length > 0
      ) {
        break;
      }

      if (
        cost > budgetTokens &&
        included.length === 0
      ) {
        /*
         * A single message alone exceeds the whole budget —
         * keep it but hard-truncate so we still return
         * something instead of nothing.
         */
        included.unshift({
          role: message.role,

          content: capTokens(
            message.content,
            budgetTokens
          ),
        });

        break;
      }

      included.unshift({
        role: message.role,

        content: message.content,
      });

      used += cost;

      if (used >= budgetTokens) {
        break;
      }
    }

    return included;
  }
}
