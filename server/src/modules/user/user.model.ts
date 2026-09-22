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
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    /**
     * E.164-ish string (no strict parsing yet) — the primary
     * login identifier for the phone+OTP flow. `sparse` so
     * email-only accounts (none currently, kept for schema
     * symmetry) don't collide on a shared `null`.
     */
    phoneNumber: {
      type: String,
      unique: true,
      sparse: true,
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

    /**
     * Only set for email/password accounts (`POST
     * /auth/register`) — phone+OTP accounts have no password.
     */
    passwordHash: {
      type: String,
      select: false,
    },

    isActive: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },

    /**
     * See VoicePlan's doc comment (user.types.ts) — deliberately
     * absent from UpdateUserInput/the self-service PATCH endpoint,
     * only settable via scripts/set-user-plan.ts for now.
     */
    plan: {
      type: String,
      enum: ["free", "gold", "diamond"],
      required: true,
      default: "free",
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