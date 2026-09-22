import {
  AgentContext,
  AgentPriorConversation,
  AgentResumeInfo,
} from "../agent.types";

import {
  ContextBuilderDependencies,
} from "./context.types";

import type {
  ConversationContext,
} from "../../conversation";

import {
  formatDuration,
} from "../../../shared/utils/duration";

export interface ContextBuilderOptions {
  /**
   * Gap since the last message, in hours, after which a turn
   * is treated as a "resume" and gets a recap note.
   */
  resumeGapHours: number;
}

export class ContextBuilder {
  constructor(
    private readonly dependencies: ContextBuilderDependencies,

    private readonly options: ContextBuilderOptions
  ) {}

  async build(input: {
    userId: string;

    conversationId: string;

    /**
     * Omitted only by the Gold-tier pipeline's pre-transcript
     * context build (ROADMAP.md's Phase C) — audio hasn't been
     * transcribed yet at that point, so there's no text to embed
     * for memory search. Semantic memory retrieval is skipped
     * entirely in that case (returns `[]`) rather than guessed at;
     * the plan-driven retrieval that runs later in
     * AgentOrchestrator (once the transcript is known) is
     * unaffected — that's a separate, later lookup either way.
     */
    message?: string;

    inputType?: "voice" | "text";
  }): Promise<AgentContext> {
    /*
     * These are independent reads.
     *
     * Do them concurrently.
     */
    const [
      conversation,
      birthProfile,
      partnerProfile,
      memories,
    ] = await Promise.all([
      this.dependencies.conversationService
        .buildContext(
          input.conversationId,
          20
        ),

      this.dependencies.birthProfileService
        .getBirthProfile(
          input.userId
        ),

      this.dependencies.partnerProfileService
        .getPartnerProfile(
          input.conversationId
        ),

      input.message
        ? this.dependencies.memoryRetriever
            .retrieve(
              input.userId,
              input.message,
              5
            )
        : Promise.resolve([]),
    ]);

    if (!conversation) {
      throw new Error(
        "Conversation not found"
      );
    }

    const resume =
      this.buildResumeInfo(
        conversation
      );

    const priorConversation =
      conversation.recentMessages
        .length === 0
        ? await this.findPriorConversation(
            input.userId,
            input.conversationId
          )
        : undefined;

    return {
      userId: input.userId,

      conversationId:
        input.conversationId,

      currentMessage:
        input.message ?? "",

      conversation,

      birthProfile,

      partnerProfile,

      memories,

      inputType:
        input.inputType ?? "text",

      previousPersonaMode:
        conversation.conversation
          .lastPersonaMode,

      resume,

      priorConversation,
    };
  }

  private buildResumeInfo(
    conversation: ConversationContext
  ): AgentResumeInfo {
    const lastMessageAt =
      conversation.conversation
        .lastMessageAt;

    if (
      conversation.recentMessages
        .length === 0 ||
      !lastMessageAt
    ) {
      return {
        isResuming: false,
      };
    }

    const gapMs =
      Date.now() -
      new Date(
        lastMessageAt
      ).getTime();

    const thresholdMs =
      this.options
        .resumeGapHours *
      60 *
      60 *
      1000;

    if (gapMs < thresholdMs) {
      return {
        isResuming: false,
      };
    }

    return {
      isResuming: true,

      gapDescription:
        formatDuration(gapMs),
    };
  }

  private async findPriorConversation(
    userId: string,
    conversationId: string
  ): Promise<
    AgentPriorConversation | undefined
  > {
    const prior =
      await this.dependencies.conversationService.getLatestOtherConversation(
        userId,
        conversationId
      );

    if (!prior?.summary) {
      return undefined;
    }

    const gapDescription =
      prior.lastMessageAt
        ? formatDuration(
            Date.now() -
              new Date(
                prior.lastMessageAt
              ).getTime()
          )
        : undefined;

    return {
      summary: prior.summary,

      currentTopic:
        prior.currentTopic,

      lastMessageAt:
        prior.lastMessageAt,

      gapDescription,
    };
  }
}