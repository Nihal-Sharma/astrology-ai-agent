import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  AppContainer,
} from "../../app/container";

import {
  AppError,
} from "../../shared/errors/app-error";

import {
  AuthService,
} from "./auth.service";

import {
  LoginInput,
  RegisterInput,
  RequestOtpInput,
  VerifyOtpInput,
} from "./auth.types";

function sendAppError(
  reply: FastifyReply,
  error: unknown
) {
  if (error instanceof AppError) {
    return reply
      .status(error.statusCode)
      .send({
        success: false,

        error: {
          code: "AUTH_ERROR",
          message: error.message,
        },
      });
  }

  throw error;
}

/**
 * Registers `app.authenticate` first (see auth.plugin.ts), then
 * the unauthenticated, user-facing write endpoints: email/
 * password register+login, and phone+OTP request/verify (the
 * app's primary auth flow — see README.md's "Auth" section).
 */
export async function registerAuthController(
  app: FastifyInstance,
  container: AppContainer
): Promise<void> {
  const authService = new AuthService(
    container.repositories.user,

    (payload) => app.jwt.sign(payload)
  );

  app.post(
    "/auth/register",
    async (
      request: FastifyRequest<{
        Body: RegisterInput;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const result =
          await authService.register(
            request.body
          );

        return reply
          .status(201)
          .send({
            success: true,
            data: result,
          });
      } catch (error) {
        return sendAppError(
          reply,
          error
        );
      }
    }
  );

  app.post(
    "/auth/login",
    async (
      request: FastifyRequest<{
        Body: LoginInput;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const result =
          await authService.login(
            request.body
          );

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        return sendAppError(
          reply,
          error
        );
      }
    }
  );

  app.post(
    "/auth/otp/request",
    async (
      request: FastifyRequest<{
        Body: RequestOtpInput;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const result =
          await authService.requestOtp(
            request.body
          );

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        return sendAppError(
          reply,
          error
        );
      }
    }
  );

  app.post(
    "/auth/otp/verify",
    async (
      request: FastifyRequest<{
        Body: VerifyOtpInput;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const result =
          await authService.verifyOtp(
            request.body
          );

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        return sendAppError(
          reply,
          error
        );
      }
    }
  );
}
