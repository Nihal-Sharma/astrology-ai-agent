import { Types } from "mongoose";
import {
  ConversationModel,
  ConversationDocument,
} from "./conversation.model";

import {
  ConversationMessageModel,
  ConversationMessageDocument,
} from "./conversation-message.model";

import {
  AddMessageInput,
  CreateConversationInput,
  UpdateConversationInput,
} from "./conversation.types";

export class ConversationRepository {
  async createConversation(
    input: CreateConversationInput
  ): Promise<ConversationDocument> {
    return ConversationModel.create({
      userId: new Types.ObjectId(input.userId),
      title: input.title,
    });
  }

  async findConversationById(
    conversationId: string
  ): Promise<ConversationDocument | null> {
    if (
      !Types.ObjectId.isValid(conversationId)
    ) {
      return null;
    }

    return ConversationModel
      .findById(conversationId)
      .exec();
  }

  async findUserConversations(
    userId: string,
    limit = 20,
    skip = 0
  ): Promise<ConversationDocument[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }

    return ConversationModel
      .find({
        userId,
      })
      .sort({
        lastMessageAt: -1,
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  async updateConversation(
    conversationId: string,
    input: UpdateConversationInput
  ): Promise<ConversationDocument | null> {
    if (
      !Types.ObjectId.isValid(conversationId)
    ) {
      return null;
    }

    return ConversationModel.findByIdAndUpdate(
      conversationId,
      {
        $set: input,
      },
      {
        new: true,
        runValidators: true,
      }
    ).exec();
  }

  async touchConversation(
    conversationId: string,
    date: Date
  ): Promise<void> {
    if (
      !Types.ObjectId.isValid(conversationId)
    ) {
      return;
    }

    await ConversationModel.updateOne(
      {
        _id: conversationId,
      },
      {
        $set: {
          lastMessageAt: date,
        },
      }
    ).exec();
  }

  async addMessage(
    input: AddMessageInput
  ): Promise<ConversationMessageDocument> {
    return ConversationMessageModel.create({
      conversationId:
        new Types.ObjectId(
          input.conversationId
        ),

      userId:
        new Types.ObjectId(
          input.userId
        ),

      role: input.role,

      content: input.content,

      contentType:
        input.contentType ?? "text",

      metadata: input.metadata,
    });
  }

  async getRecentMessages(
    conversationId: string,
    limit = 20
  ): Promise<ConversationMessageDocument[]> {
    if (
      !Types.ObjectId.isValid(
        conversationId
      )
    ) {
      return [];
    }

    const messages =
      await ConversationMessageModel
        .find({
          conversationId,
        })
        .sort({
          createdAt: -1,
        })
        .limit(limit)
        .exec();

    /*
     * Query in descending order for performance,
     * then reverse so the caller receives chronological
     * conversation order.
     */
    return messages.reverse();
  }

  async getMessagesBefore(
    conversationId: string,
    before: Date,
    limit = 50
  ): Promise<ConversationMessageDocument[]> {
    if (
      !Types.ObjectId.isValid(
        conversationId
      )
    ) {
      return [];
    }

    const messages =
      await ConversationMessageModel
        .find({
          conversationId,
          createdAt: {
            $lt: before,
          },
        })
        .sort({
          createdAt: -1,
        })
        .limit(limit)
        .exec();

    return messages.reverse();
  }

  /**
   * Messages strictly after `after` (exclusive) and strictly
   * before `before` (exclusive), chronological order.
   *
   * Used to find the backlog that still needs to be folded
   * into the rolling conversation summary.
   */
  async getMessagesBetween(
    conversationId: string,
    after: Date | undefined,
    before: Date,
    limit = 200
  ): Promise<ConversationMessageDocument[]> {
    if (
      !Types.ObjectId.isValid(
        conversationId
      )
    ) {
      return [];
    }

    const messages =
      await ConversationMessageModel
        .find({
          conversationId,
          createdAt: {
            ...(after
              ? { $gt: after }
              : {}),
            $lt: before,
          },
        })
        .sort({
          createdAt: 1,
        })
        .limit(limit)
        .exec();

    return messages;
  }

  /**
   * Most recently active conversation for a user, excluding
   * a specific conversation id. Used to surface a summary of
   * an older thread when the user starts a brand-new one.
   */
  async findLatestOtherConversation(
    userId: string,
    excludeConversationId: string
  ): Promise<ConversationDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }

    return ConversationModel
      .findOne({
        userId,
        ...(Types.ObjectId.isValid(
          excludeConversationId
        )
          ? {
              _id: {
                $ne: excludeConversationId,
              },
            }
          : {}),
        summary: {
          $exists: true,
          $ne: null,
        },
      })
      .sort({
        lastMessageAt: -1,
        createdAt: -1,
      })
      .exec();
  }
}