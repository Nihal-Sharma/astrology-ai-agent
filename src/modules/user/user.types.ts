import { Types } from "mongoose";

export interface User {
  _id: Types.ObjectId;

  email: string;

  name?: string;

  avatarUrl?: string;

  isActive: boolean;

  /**
   * bcrypt hash — schema-level `select: false`, so ordinary
   * queries never return it; only UserRepository.findByEmail
   * explicitly selects it, for AuthService login/registration.
   * Never present on a `User` object returned to a controller.
   */
  passwordHash: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  name?: string;
  avatarUrl?: string;

  /**
   * Set only by AuthService (already bcrypt-hashed) — there is
   * no direct, unauthenticated user-creation path anymore, see
   * POST /auth/register.
   */
  passwordHash: string;
}

export interface UpdateUserInput {
  name?: string;
  avatarUrl?: string;
  isActive?: boolean;
}