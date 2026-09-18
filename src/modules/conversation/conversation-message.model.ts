import {
  HydratedDocument,
  Model,
  Schema,
  model,
} from "mongoose";

import {
  ConversationMessage,
} from "./conversation.types";

export type ConversationMessageDocument =
  HydratedDocument<ConversationMessage>;

export type ConversationMessageModel =
  Model<ConversationMessage>;

const conversationMessageSchema =
  new Schema<ConversationMessage>(
    {
      conversationId: {
        type: Schema.Types.ObjectId,
        ref: "Conversation",
        required: true,
        index: true,
      },

      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      role: {
        type: String,
        enum: [
          "user",
          "assistant",
          "system",
          "tool",
        ],
        required: true,
        index: true,
      },

      content: {
        type: String,
        required: true,
      },

      contentType: {
        type: String,
        enum: ["text", "voice"],
        default: "text",
        required: true,
      },

      metadata: {
        type: Schema.Types.Mixed,
      },
    },
    {
      timestamps: {
        createdAt: true,
        updatedAt: false,
      },
      versionKey: false,
    }
  );

conversationMessageSchema.index({
  conversationId: 1,
  createdAt: -1,
});

export const ConversationMessageModel =
  model<ConversationMessage>(
    "ConversationMessage",
    conversationMessageSchema
  );