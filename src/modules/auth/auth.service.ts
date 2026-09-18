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
} from "./auth.types";

const SALT_ROUNDS = 10;

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
    if (!found) {
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

  private sanitize(user: User): User {
    const {
      passwordHash: _passwordHash,
      ...rest
    } = user;

    return rest as User;
  }
}
