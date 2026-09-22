import { Types } from "mongoose";

/**
 * A second person's birth details attached to a conversation,
 * for synastry/matchmaking/compatibility tools (`match_*`,
 * composite/synastry charts) — see McpArgumentResolver's
 * `partner` context.
 *
 * Scoped 1:1 to a conversation (not the user's own account,
 * unlike BirthProfile) — the partner isn't a user of this
 * system, just data the user supplies about someone else.
 */
export interface PartnerProfile {
  _id: Types.ObjectId;

  conversationId: Types.ObjectId;

  userId: Types.ObjectId;

  name?: string;

  dateOfBirth: Date;

  /**
   * Store the original user-provided time.
   *
   * Examples:
   * "13:02"
   * "1:02 PM"
   */
  timeOfBirth: string;

  placeOfBirth: string;

  latitude: number;

  longitude: number;

  timezone: string;

  timeOfBirthVerified: boolean;

  createdAt: Date;

  updatedAt: Date;
}

export interface CreatePartnerProfileInput {
  conversationId: string;

  userId: string;

  name?: string;

  dateOfBirth: Date;

  timeOfBirth: string;

  placeOfBirth: string;

  latitude: number;

  longitude: number;

  timezone: string;

  timeOfBirthVerified?: boolean;
}

export interface UpdatePartnerProfileInput {
  name?: string;

  dateOfBirth?: Date;

  timeOfBirth?: string;

  placeOfBirth?: string;

  latitude?: number;

  longitude?: number;

  timezone?: string;

  timeOfBirthVerified?: boolean;
}
