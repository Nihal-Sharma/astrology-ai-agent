import {
  HydratedDocument,
  Model,
  Schema,
  model,
} from "mongoose";

import {
  Conversation,
} from "./conversation.types";

export type ConversationDocument =
  HydratedDocument<Conversation>;

export type ConversationModel =
  Model<Conversation>;

const conversationSchema =
  new Schema<Conversation>(
    {
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      title: {
        type: String,
        trim: true,
        maxlength: 200,
      },

      status: {
        type: String,
        enum: ["active", "archived"],
        default: "active",
        required: true,
        index: true,
      },

      summary: {
        type: String,
        trim: true,
      },

      currentTopic: {
        type: String,
        trim: true,
        maxlength: 300,
      },

      lastPersonaMode: {
        type: String,
        enum: [
          "companion",
          "astrologer",
          "blended",
        ],
      },

      summarizedUntil: {
        type: Date,
      },

      lastMessageAt: {
        type: Date,
        index: true,
      },
    },
    {
      timestamps: true,
      versionKey: false,
    }
  );

conversationSchema.index({
  userId: 1,
  status: 1,
  lastMessageAt: -1,
});

export const ConversationModel =
  model<Conversation>(
    "Conversation",
    conversationSchema
  );

