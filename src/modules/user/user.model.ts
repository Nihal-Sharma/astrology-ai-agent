import {
  HydratedDocument,
  Model,
  Schema,
  model,
} from "mongoose";

import { User } from "./user.types";

export type UserDocument = HydratedDocument<User>;

export type UserModel = Model<User>;

const userSchema = new Schema<User>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    name: {
      type: String,
      trim: true,
      maxlength: 120,
    },

    avatarUrl: {
      type: String,
      trim: true,
    },

    isActive: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const UserModel = model<User>(
  "User",
  userSchema
);