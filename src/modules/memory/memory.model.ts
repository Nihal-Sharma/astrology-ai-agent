import {
  HydratedDocument,
  Model,
  Schema,
  model,
} from "mongoose";

import {
  MemoryItem,
} from "./memory.types";

export type MemoryItemDocument =
  HydratedDocument<MemoryItem>;

export type MemoryItemModelType =
  Model<MemoryItem>;

const memoryItemSchema =
  new Schema<MemoryItem>(
    {
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      fact: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500,
      },

      category: {
        type: String,
        enum: [
          "identity",
          "preference",
          "relationship",
          "life_event",
          "recurring_topic",
          "other",
        ],
        required: true,
        default: "other",
      },

      embedding: {
        type: [Number],
        required: true,
      },

      importance: {
        type: Number,
        required: true,
        default: 1,
      },

      referenceCount: {
        type: Number,
        required: true,
        default: 1,
      },

      sourceConversationId: {
        type: Schema.Types.ObjectId,
        ref: "Conversation",
      },

      lastReferencedAt: {
        type: Date,
        required: true,
        default: Date.now,
      },
    },
    {
      timestamps: true,
      versionKey: false,
    }
  );

memoryItemSchema.index({
  userId: 1,
  importance: -1,
  lastReferencedAt: -1,
});

export const MemoryItemModel =
  model<MemoryItem>(
    "MemoryItem",
    memoryItemSchema
  );
