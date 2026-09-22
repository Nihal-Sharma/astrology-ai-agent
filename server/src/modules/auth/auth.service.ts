import bcrypt from "bcryptjs";

import {
  UserRepository,
} from "../user/user.repository";

import {
  User,
} from "../user/user.types";

import {
  AppError,
} from "../../shared/errors/app-error";

import {
  AuthResult,
  AuthTokenPayload,
  LoginInput,
  RegisterInput,
  RequestOtpInput,
  VerifyOtpInput,
  VerifyOtpResult,
} from "./auth.types";

const SALT_ROUNDS = 10;

/**
 * No SMS provider wired up yet — every phone number accepts
 * this one OTP. Swap `verifyOtp`'s comparison for a real
 * provider (Twilio/MSG91/etc.) before this goes anywhere near
 * production; see ROADMAP.md.
 */
const STATIC_OTP = "1234";

/**
 * Loose E.164-ish check: optional leading `+`, 7-15 digits.
 * Not full phone-number validation — good enough to reject
 * obvious junk before "sending" an OTP.
 */
const PHONE_NUMBER_PATTERN = /^\+?[1-9]\d{6,14}$/;

function normalizePhoneNumber(
  raw: string
): string {
  return raw.replace(/[\s()-]/g, "").trim();
}

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,

    /**
     * Injected rather than imported directly — token
     * signing/verification is owned by the `@fastify/jwt`
     * plugin registered on the Fastify app, which doesn't exist
     * yet when the container (and this service) is constructed.
     * See auth.controller.ts for where this gets wired.
     */
    private readonly signToken: (
      payload: AuthTokenPayload
    ) => string
  ) {}

  async register(
    input: RegisterInput
  ): Promise<AuthResult> {
    const existing =
      await this.userRepository.findByEmail(
        input.email
      );

    if (existing) {
      throw new AppError(
        "A user with this email already exists",
        409
      );
    }

    const passwordHash =
      await bcrypt.hash(
        input.password,
        SALT_ROUNDS
      );

    const created =
      await this.userRepository.create({
        email: input.email,
        name: input.name,
        passwordHash,
      });

    const user = this.sanitize(
      created.toObject()
    );

    return {
      user,

      token: this.signToken({
        userId: user._id.toString(),
        email: user.email,
      }),
    };
  }

  async login(
    input: LoginInput
  ): Promise<AuthResult> {
    const found =
      await this.userRepository.findByEmail(
        input.email
      );

    /*
     * Same generic error for "no such user" and "wrong
     * password" — don't let a login attempt reveal whether an
     * email is registered.
     */
    /*
     * `!found.passwordHash` covers a phone-only account with no
     * password set — same generic error, not a 500.
     */
    if (!found || !found.passwordHash) {
      throw new AppError(
        "Invalid email or password",
        401
      );
    }

    const passwordMatches =
      await bcrypt.compare(
        input.password,
        found.passwordHash
      );

    if (!passwordMatches) {
      throw new AppError(
        "Invalid email or password",
        401
      );
    }

    const user = this.sanitize(
      found.toObject()
    );

    return {
      user,

      token: this.signToken({
        userId: user._id.toString(),
        email: user.email,
      }),
    };
  }

  async requestOtp(
    input: RequestOtpInput
  ): Promise<{ message: string }> {
    const phoneNumber = normalizePhoneNumber(
      input.phoneNumber ?? ""
    );

    if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) {
      throw new AppError(
        "A valid phone number is required",
        400
      );
    }

    /*
     * No SMS provider wired up yet — the OTP is static
     * (STATIC_OTP) for every phone number, so there's nothing to
     * actually send. Kept as a real request/response step so the
     * app's flow (and a future provider swap) doesn't change.
     */
    return {
      message: "OTP sent",
    };
  }

  async verifyOtp(
    input: VerifyOtpInput
  ): Promise<VerifyOtpResult> {
    const phoneNumber = normalizePhoneNumber(
      input.phoneNumber ?? ""
    );

    if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) {
      throw new AppError(
        "A valid phone number is required",
        400
      );
    }

    if (input.otp !== STATIC_OTP) {
      throw new AppError(
        "Invalid OTP",
        401
      );
    }

    const existing =
      await this.userRepository.findByPhoneNumber(
        phoneNumber
      );

    const isNewUser = !existing;

    const found =
      existing ??
      (await this.userRepository.create({
        phoneNumber,
      }));

    const user = this.sanitize(
      found.toObject()
    );

    return {
      user,
      isNewUser,

      token: this.signToken({
        userId: user._id.toString(),
      }),
    };
  }

  private sanitize(user: User): User {
    const {
      passwordHash: _passwordHash,
      ...rest
    } = user;

    return rest as User;
  }
}
