import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { AppContainer } from "../../app/container";
import {
  UpdateUserInput,
} from "./user.types";

import {
  requireSelf,
} from "../auth";

interface UserIdParams {
  userId: string;
}

/**
 * User creation now happens via POST /auth/register (needs a
 * password) — see §6 (Auth). Both routes here are protected and
 * scoped to the authenticated user's own record.
 */
export async function registerUserController(
  app: FastifyInstance,
  container: AppContainer
): Promise<void> {
  const userService = container.services.user;

  app.get<{
    Params: UserIdParams;
  }>(
    "/users/:userId",
    {
      preHandler: [
        app.authenticate,
        requireSelf("userId"),
      ],
    },
    async (
      request: FastifyRequest<{
        Params: UserIdParams;
      }>,
      reply: FastifyReply
    ) => {
      const user =
        await userService.getUserById(
          request.params.userId
        );

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      return reply.send({
        success: true,
        data: user,
      });
    }
  );

  app.patch<{
    Params: UserIdParams;
    Body: UpdateUserInput;
  }>(
    "/users/:userId",
    {
      preHandler: [
        app.authenticate,
        requireSelf("userId"),
      ],
    },
    async (
      request: FastifyRequest<{
        Params: UserIdParams;
        Body: UpdateUserInput;
      }>,
      reply: FastifyReply
    ) => {
      const user =
        await userService.updateUser(
          request.params.userId,
          request.body
        );

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      return reply.send({
        success: true,
        data: user,
      });
    }
  );

  /*
   * Cascade-deletes birth profile, partner profiles, all
   * conversations + messages, and memories, then the account
   * itself — see container.deleteUserAccount and PRIVACY.md.
   */
  app.delete<{
    Params: UserIdParams;
  }>(
    "/users/:userId",
    {
      preHandler: [
        app.authenticate,
        requireSelf("userId"),
      ],
    },
    async (
      request: FastifyRequest<{
        Params: UserIdParams;
      }>,
      reply: FastifyReply
    ) => {
      const deleted =
        await container.deleteUserAccount(
          request.params.userId
        );

      if (!deleted) {
        return reply.status(404).send({
          success: false,
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      return reply.status(204).send();
    }
  );
}