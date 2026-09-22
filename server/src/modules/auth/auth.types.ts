import {
  FastifyReply,
  FastifyRequest,
} from "fastify";

/*
 * Imported from the leaf types file, not the user module's
 * barrel (`../user`) — that barrel also exports the user
 * controller, which imports `requireSelf` from this module.
 * Going through the barrel here would create a runtime import
 * cycle between the two modules.
 */
import {
  User,
} from "../user/user.types";

export interface RegisterInput {
  email: string;

  password: string;

  name?: string;
}

export interface LoginInput {
  email: string;

  password: string;
}

export interface RequestOtpInput {
  phoneNumber: string;
}

export interface VerifyOtpInput {
  phoneNumber: string;

  otp: string;
}

export interface AuthTokenPayload {
  userId: string;

  email?: string;
}

export interface AuthResult {
  user: User;

  token: string;
}

export interface VerifyOtpResult extends AuthResult {
  /**
   * True when this call created the account — the app uses this
   * to decide whether to run onboarding (name + birth profile)
   * right after verification.
   */
  isNewUser: boolean;
}

/**
 * Module augmentation: makes `request.user` a typed
 * `AuthTokenPayload` after `request.jwtVerify()` (via the
 * `authenticate` preHandler), instead of `any`.
 */
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthTokenPayload;

    user: AuthTokenPayload;
  }
}

/**
 * `app.authenticate` is registered once in auth.plugin.ts and
 * used as a `preHandler` across every protected controller.
 */
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}
