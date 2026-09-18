import {
  AppLogger,
} from "../../../infrastructure/observability/logger";

import {
  ConversationService,
} from "../conversation.service";

import {
  ConversationSummarizer,
} from "../summarizer/conversation-summarizer.service";

import {
  ConversationMessage,
  ConversationPersonaMode,
  UpdateConversationInput,
} from "../conversation.types";

export interface ConversationWindowConfig {
  recentMessageKeepCount: number;

  summaryBatchSize: number;
}

/**
 * Write-side owner of conversation persistence and rolling
 * summarization.
 *
 * `AgentOrchestrator` calls this after every turn so the chat
 * pipeline actually remembers what was said, instead of only
 * the REST API persisting messages.
 */
export class ConversationWindowService {
  constructor(
    private readonly conversationService: ConversationService,

    private readonly summarizer: ConversationSummarizer,

    private readonly config: ConversationWindowConfig,

    private readonly logger: AppLogger
  ) {}

  async recordUserTurn(input: {
    conversationId: string;

    userId: string;

    message: string;
  }): Promise<ConversationMessage> {
    return this.conversationService.addMessage({
      conversationId:
        input.conversationId,

      userId: input.userId,

      role: "user",

      content: input.message,
    });
  }

  async recordAssistantTurn(input: {
    conversationId: string;

    userId: string;

    message: string;
  }): Promise<ConversationMessage | null> {
    if (!input.message.trim()) {
      return null;
    }

    return this.conversationService.addMessage({
      conversationId:
        input.conversationId,

      userId: input.userId,

      role: "assistant",

      content: input.message,
    });
  }

  /**
   * Persists the persona mode chosen for this turn, so the
   * next turn's planner has hysteresis input — see §3
   * (persona system). Best-effort, same as maybeSummarize.
   */
  async updatePersonaMode(
    conversationId: string,
    mode: ConversationPersonaMode
  ): Promise<void> {
    try {
      await this.conversationService.updateConversation(
        conversationId,
        {
          lastPersonaMode: mode,
        }
      );
    } catch (error) {
      this.logger.error(
        {
          err: error,

          module:
            "conversation-window",

          conversationId,
        },
        "Persona mode update failed"
      );
    }
  }

  /**
   * Best-effort rolling summarization.
   *
   * Never throws — this is called fire-and-forget after the
   * user has already received their response, so failures are
   * logged and swallowed rather than surfaced.
   */
  async maybeSummarize(
    conversationId: string
  ): Promise<void> {
    try {
      const backlog =
        await this.conversationService.getSummarizationBacklog(
          conversationId,
          this.config
            .recentMessageKeepCount
        );

      if (
        backlog.length <
        this.config.summaryBatchSize
      ) {
        return;
      }

      const conversation =
        await this.conversationService.getConversation(
          conversationId
        );

      if (!conversation) {
        return;
      }

      const result =
        await this.summarizer.summarize({
          previousSummary:
            conversation.summary,

          previousTopic:
            conversation.currentTopic,

          messages: backlog,
        });

      const update: UpdateConversationInput =
        {
          summary: result.summary,

          summarizedUntil:
            backlog[
              backlog.length - 1
            ].createdAt,
        };

      if (result.currentTopic) {
        update.currentTopic =
          result.currentTopic;
      }

      await this.conversationService.updateConversation(
        conversationId,
        update
      );

      this.logger.debug(
        {
          module:
            "conversation-window",

          conversationId,

          summarizedMessageCount:
            backlog.length,
        },
        "Rolling conversation summary updated"
      );
    } catch (error) {
      this.logger.error(
        {
          err: error,

          module:
            "conversation-window",

          conversationId,
        },
        "Rolling summarization failed"
      );
    }
  }
}
