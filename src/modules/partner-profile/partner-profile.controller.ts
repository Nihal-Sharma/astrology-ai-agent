import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { AppContainer } from "../../app/container";

import {
  CreatePartnerProfileInput,
  UpdatePartnerProfileInput,
} from "./partner-profile.types";

import {
  requireConversationOwnership,
} from "../auth";

interface ConversationIdParams {
  conversationId: string;
}

export async function registerPartnerProfileController(
  app: FastifyInstance,
  container: AppContainer
): Promise<void> {
  const service =
    container.services.partnerProfile;

  const guards = [
    app.authenticate,
    requireConversationOwnership(
      container
    ),
  ];

  app.post<{
    Params: ConversationIdParams;
    Body: Omit<
      CreatePartnerProfileInput,
      "conversationId" | "userId"
    >;
  }>(
    "/conversations/:conversationId/partner-profile",
    {
      preHandler: guards,
    },
    async (
      request: FastifyRequest<{
        Params: ConversationIdParams;
        Body: Omit<
          CreatePartnerProfileInput,
          "conversationId" | "userId"
        >;
      }>,
      reply: FastifyReply
    ) => {
      /*
       * userId comes from the verified token, not the request
       * body — see the same fix on conversation messages. See
       * §6 (Auth).
       */
      const profile =
        await service.createPartnerProfile({
          conversationId:
            request.params.conversationId,

          userId:
            request.user.userId,

          ...request.body,
        });

      return reply.status(201).send({
        success: true,
        data: profile,
      });
    }
  );

  app.get<{
    Params: ConversationIdParams;
  }>(
    "/conversations/:conversationId/partner-profile",
    {
      preHandler: guards,
    },
    async (
      request: FastifyRequest<{
        Params: ConversationIdParams;
      }>,
      reply: FastifyReply
    ) => {
      const profile =
        await service.getPartnerProfile(
          request.params.conversationId
        );

      if (!profile) {
        return reply.status(404).send({
          success: false,
          error: {
            code: "PARTNER_PROFILE_NOT_FOUND",
            message: "Partner profile not found",
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
    Params: ConversationIdParams;
    Body: UpdatePartnerProfileInput;
  }>(
    "/conversations/:conversationId/partner-profile",
    {
      preHandler: guards,
    },
    async (
      request: FastifyRequest<{
        Params: ConversationIdParams;
        Body: UpdatePartnerProfileInput;
      }>,
      reply: FastifyReply
    ) => {
      const profile =
        await service.updatePartnerProfile(
          request.params.conversationId,
          request.body
        );

      if (!profile) {
        return reply.status(404).send({
          success: false,
          error: {
            code: "PARTNER_PROFILE_NOT_FOUND",
            message: "Partner profile not found",
          },
        });
      }

      return reply.send({
        success: true,
        data: profile,
      });
    }
  );

  app.delete<{
    Params: ConversationIdParams;
  }>(
    "/conversations/:conversationId/partner-profile",
    {
      preHandler: guards,
    },
    async (
      request: FastifyRequest<{
        Params: ConversationIdParams;
      }>,
      reply: FastifyReply
    ) => {
      const deleted =
        await service.deletePartnerProfile(
          request.params.conversationId
        );

      if (!deleted) {
        return reply.status(404).send({
          success: false,
          error: {
            code: "PARTNER_PROFILE_NOT_FOUND",
            message: "Partner profile not found",
          },
        });
      }

      return reply.status(204).send();
    }
  );
}
