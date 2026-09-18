import {
  HydratedDocument,
  Model,
  Schema,
  Types,
  model,
} from "mongoose";

import { BirthProfile } from "./birth-profile.types";

export type BirthProfileDocument =
  HydratedDocument<BirthProfile>;

export type BirthProfileModel =
  Model<BirthProfile>;

const birthProfileSchema =
  new Schema<BirthProfile>(
    {
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        unique: true,
        index: true,
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

export const BirthProfileModel =
  model<BirthProfile>(
    "BirthProfile",
    birthProfileSchema
  );