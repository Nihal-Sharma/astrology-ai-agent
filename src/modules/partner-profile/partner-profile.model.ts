import {
  HydratedDocument,
  Model,
  Schema,
  model,
} from "mongoose";

import { PartnerProfile } from "./partner-profile.types";

export type PartnerProfileDocument =
  HydratedDocument<PartnerProfile>;

export type PartnerProfileModel =
  Model<PartnerProfile>;

const partnerProfileSchema =
  new Schema<PartnerProfile>(
    {
      conversationId: {
        type: Schema.Types.ObjectId,
        ref: "Conversation",
        required: true,
        unique: true,
        index: true,
      },

      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      name: {
        type: String,
        trim: true,
        maxlength: 200,
      },

      dateOfBirth: {
        type: Date,
        required: true,
      },

      timeOfBirth: {
        type: String,
        required: true,
        trim: true,
      },

      placeOfBirth: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
      },

      latitude: {
        type: Number,
        required: true,
        min: -90,
        max: 90,
      },

      longitude: {
        type: Number,
        required: true,
        min: -180,
        max: 180,
      },

      timezone: {
        type: String,
        required: true,
        trim: true,
      },

      timeOfBirthVerified: {
        type: Boolean,
        required: true,
        default: false,
      },
    },
    {
      timestamps: true,
      versionKey: false,
    }
  );

export const PartnerProfileModel =
  model<PartnerProfile>(
    "PartnerProfile",
    partnerProfileSchema
  );
