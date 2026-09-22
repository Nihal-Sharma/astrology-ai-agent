import { Types } from "mongoose";

export interface BirthProfile {
  _id: Types.ObjectId;

  userId: Types.ObjectId;

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

  /**
   * Whether the birth time has been verified by
   * the user or another trusted source.
   */
  timeOfBirthVerified: boolean;

  createdAt: Date;

  updatedAt: Date;
}

export interface CreateBirthProfileInput {
  userId: string;

  dateOfBirth: Date;

  timeOfBirth: string;

  placeOfBirth: string;

  latitude: number;

  longitude: number;

  timezone: string;

  timeOfBirthVerified?: boolean;
}

export interface UpdateBirthProfileInput {
  dateOfBirth?: Date;

  timeOfBirth?: string;

  placeOfBirth?: string;

  latitude?: number;

  longitude?: number;

  timezone?: string;

  timeOfBirthVerified?: boolean;
}