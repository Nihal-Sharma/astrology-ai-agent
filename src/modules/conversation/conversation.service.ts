import {
  ConversationRepository,
} from "./conversation.repository";

import {
  Conversation,
  ConversationContext,
  ConversationMessage,
  CreateConversationInput,
  UpdateConversationInput,
  AddMessageInput,
} from "./conversation.types";

import { UserService } from "../user";

export class ConversationService {
  constructor(
    private readonly repository: ConversationRepository,

    private readonly userService: UserService
  ) {}

  async createConversation(
    input: CreateConversationInput
  ): Promise<Conversation> {
    const user =
      await this.userService.getUserById(
        input.userId
      );

    if (!user) {
      throw new Error(
        "Cannot create conversation for a user that does not exist"
      );
    }

    const conversation =
      await this.repository.createConversation(
        input
      );

    return conversation.toObject();
  }

  async getConversation(
    conversationId: string
  ): Promise<Conversation | null> {
    const conversation =
      await this.repository.findConversationById(
        conversationId
      );

    return conversation?.toObject() ?? null;
  }

  async getUserConversations(
    userId: string,
    limit = 20,
    skip = 0
  ): Promise<Conversation[]> {
    const conversations =
      await this.repository.findUserConversations(
        userId,
        limit,
        skip
      );

    return conversations.map((conversation) =>
      conversation.toObject()
    );
  }

  async updateConversation(
    conversationId: string,
    input: UpdateConversationInput
  ): Promise<Conversation | null> {
    const conversation =
      await this.repository.updateConversation(
        conversationId,
        input
      );

    return conversation?.toObject() ?? null;
  }

  async addMessage(
    input: AddMessageInput
  ): Promise<ConversationMessage> {
    const conversation =
      await this.repository.findConversationById(
        input.conversationId
      );

    if (!conversation) {
      throw new Error(
        "Conversation not found"
      );
    }

    if (
      conversation.userId.toString() !==
      input.userId
    ) {
      throw new Error(
        "Conversation does not belong to this user"
      );
    }

    const message =
      await this.repository.addMessage(
        input
      );

    await this.repository.touchConversation(
      input.conversationId,
      message.createdAt
    );

    return message.toObject();
  }

  async getRecentMessages(
    conversationId: string,
    limit = 20
  ): Promise<ConversationMessage[]> {
    const messages =
      await this.repository.getRecentMessages(
        conversationId,
        limit
      );

    return messages.map((message) =>
      message.toObject()
    );
  }

  /**
   * Backlog of messages not yet folded into the rolling
   * summary, and older than the raw "always keep" window.
   *
   * Returns an empty array when there isn't enough backlog
   * yet — callers decide the batch-size threshold.
   */
  async getSummarizationBacklog(
    conversationId: string,
    keepRecentCount: number
  ): Promise<ConversationMessage[]> {
    const conversation =
      await this.repository.findConversationById(
        conversationId
      );

    if (!conversation) {
      return [];
    }

    const recentMessages =
      await this.repository.getRecentMessages(
        conversationId,
        keepRecentCount
      );

    if (recentMessages.length < keepRecentCount) {
      /*
       * Not even enough messages to fill the
       * always-keep-raw window yet — nothing to
       * summarize.
       */
      return [];
    }

    const keepBoundary =
      recentMessages[0].createdAt;

    const backlog =
      await this.repository.getMessagesBetween(
        conversationId,
        conversation.summarizedUntil,
        keepBoundary
      );

    return backlog.map((message) =>
      message.toObject()
    );
  }

  async getLatestOtherConversation(
    userId: string,
    excludeConversationId: string
  ): Promise<Conversation | null> {
    const conversation =
      await this.repository.findLatestOtherConversation(
        userId,
        excludeConversationId
      );

    return conversation?.toObject() ?? null;
  }

  async buildContext(
    conversationId: string,
    recentMessageLimit = 20
  ): Promise<ConversationContext | null> {
    const conversation =
      await this.getConversation(
        conversationId
      );

    if (!conversation) {
      return null;
    }

    const recentMessages =
      await this.getRecentMessages(
        conversationId,
        recentMessageLimit
      );

    return {
      conversation,
      recentMessages,

      summary:
        conversation.summary,

      currentTopic:
        conversation.currentTopic,
    };
  }
}