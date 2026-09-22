import { Types } from "mongoose";

/**
 * Subscription tier — picks which voice pipeline a session uses
 * (see RealtimeSessionContext.plan and ROADMAP.md's Phase A/B/C/D).
 * Deliberately not settable through UpdateUserInput/the self-service
 * PATCH /users/:userId endpoint — there's no billing/payment gate
 * yet, so exposing this as self-service would let anyone grant
 * themselves Gold/Diamond for free. For now it's only settable via
 * `scripts/set-user-plan.ts`, a direct DB operation — see that
 * script's own comment for why, and ROADMAP.md's Phase A note on
 * this being an explicit placeholder pending real billing.
 */
export type VoicePlan =
  | "free"
  | "gold"
  | "diamond";

export interface User {
  _id: Types.ObjectId;

  /**
   * Set for email/password accounts (`POST /auth/register`).
   */
  email?: string;

  /**
   * Set for phone+OTP accounts (`POST /auth/otp/verify`) — the
   * primary login identifier for the app.
   */
  phoneNumber?: string;

  name?: string;

  avatarUrl?: string;

  isActive: boolean;

  /** Defaults to "free" — see VoicePlan's own doc comment. */
  plan: VoicePlan;

  /**
   * bcrypt hash — schema-level `select: false`, so ordinary
   * queries never return it; only UserRepository.findByEmail
   * explicitly selects it, for AuthService login/registration.
   * Never present on a `User` object returned to a controller.
   * Absent entirely for phone+OTP accounts.
   */
  passwordHash?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email?: string;
  phoneNumber?: string;
  name?: string;
  avatarUrl?: string;

  /**
   * Set only by AuthService's email/password register path
   * (already bcrypt-hashed) — absent for phone+OTP accounts.
   */
  passwordHash?: string;
}

export interface UpdateUserInput {
  name?: string;
  avatarUrl?: string;
  isActive?: boolean;
}