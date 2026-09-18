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

interface ConversationIdParams {
  conversationId: string;
}

export async function registerPartnerProfileController(
  app: FastifyInstance,
  container: AppContainer
): Promise<void> {
  const service =
    container.services.partnerProfile;

  app.post(
    "/conversations/:conversationId/partner-profile",
    async (
      request: FastifyRequest<{
        Params: ConversationIdParams;
        Body: Omit<
          CreatePartnerProfileInput,
          "conversationId" | "userId"
        > & {
          userId: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const profile =
        await service.createPartnerProfile({
          conversationId:
            request.params.conversationId,

          ...request.body,
        });

      return reply.status(201).send({
        success: true,
        data: profile,
      });
    }
  );

  app.get(
    "/conversations/:conversationId/partner-profile",
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

  app.patch(
    "/conversations/:conversationId/partner-profile",
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

  app.delete(
    "/conversations/:conversationId/partner-profile",
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
