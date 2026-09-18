import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { AppContainer } from "../../app/container";
import {
  CreateUserInput,
  UpdateUserInput,
} from "./user.types";

interface UserIdParams {
  userId: string;
}

export async function registerUserController(
  app: FastifyInstance,
  container: AppContainer
): Promise<void> {
  const userService = container.services.user;

  app.post(
    "/users",
    async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      const input =
        request.body as CreateUserInput;

      const user =
        await userService.createUser(input);

      return reply.status(201).send({
        success: true,
        data: user,
      });
    }
  );

  app.get(
    "/users/:userId",
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

  app.patch(
    "/users/:userId",
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
}