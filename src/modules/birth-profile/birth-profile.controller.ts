import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { AppContainer } from "../../app/container";

import {
  CreateBirthProfileInput,
  UpdateBirthProfileInput,
} from "./birth-profile.types";

import {
  requireSelf,
} from "../auth";

interface UserIdParams {
  userId: string;
}

export async function registerBirthProfileController(
  app: FastifyInstance,
  container: AppContainer
): Promise<void> {
  const service =
    container.services.birthProfile;

  const guards = [
    app.authenticate,
    requireSelf("userId"),
  ];

  app.post<{
    Params: UserIdParams;
    Body: Omit<
      CreateBirthProfileInput,
      "userId"
    >;
  }>(
    "/users/:userId/birth-profile",
    {
      preHandler: guards,
    },
    async (
      request: FastifyRequest<{
        Params: UserIdParams;
        Body: Omit<
          CreateBirthProfileInput,
          "userId"
        >;
      }>,
      reply: FastifyReply
    ) => {
      const profile =
        await service.createBirthProfile({
          userId: request.params.userId,
          ...request.body,
        });

      return reply.status(201).send({
        success: true,
        data: profile,
      });
    }
  );

  app.get<{
    Params: UserIdParams;
  }>(
    "/users/:userId/birth-profile",
    {
      preHandler: guards,
    },
    async (
      request: FastifyRequest<{
        Params: UserIdParams;
      }>,
      reply: FastifyReply
    ) => {
      const profile =
        await service.getBirthProfile(
          request.params.userId
        );

      if (!profile) {
        return reply.status(404).send({
          success: false,
          error: {
            code: "BIRTH_PROFILE_NOT_FOUND",
            message: "Birth profile not found",
          },
        });
      }

      return reply.send({
        success: true,
        data: profile,
      });
    }
  );

  app.patch<{
    Params: UserIdParams;
    Body: UpdateBirthProfileInput;
  }>(
    "/users/:userId/birth-profile",
    {
      preHandler: guards,
    },
    async (
      request: FastifyRequest<{
        Params: UserIdParams;
        Body: UpdateBirthProfileInput;
      }>,
      reply: FastifyReply
    ) => {
      const profile =
        await service.updateBirthProfile(
          request.params.userId,
          request.body
        );

      if (!profile) {
        return reply.status(404).send({
          success: false,
          error: {
            code: "BIRTH_PROFILE_NOT_FOUND",
            message: "Birth profile not found",
          },
        });
      }

      return reply.send({
        success: true,
        data: profile,
      });
    }
  );
}