import {
  HydratedDocument,
  Model,
  Schema,
  model,
} from "mongoose";

import {
  KnowledgeCard,
} from "./knowledge-card.types";

export type KnowledgeCardDocument =
  HydratedDocument<KnowledgeCard>;

export type KnowledgeCardModelType =
  Model<KnowledgeCard>;

const knowledgeCardSchema =
  new Schema<KnowledgeCard>(
    {
      topic: {
        type: String,
        required: true,
        trim: true,
        index: true,
      },

      content: {
        type: String,
        required: true,
        trim: true,
      },

      tags: {
        type: [String],
        default: [],
        index: true,
      },

      embedding: {
        type: [Number],
        required: true,
      },
    },
    {
      timestamps: true,
      versionKey: false,
    }
  );

export const KnowledgeCardModel =
  model<KnowledgeCard>(
    "KnowledgeCard",
    knowledgeCardSchema
  );
