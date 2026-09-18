import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  AppContainer,
} from "../../app/container";

import {
  AddMessageInput,
  CreateConversationInput,
  UpdateConversationInput,
} from "./conversation.types";

interface ConversationIdParams {
  conversationId: string;
}

interface UserIdParams {
  userId: string;
}

export async function registerConversationController(
  app: FastifyInstance,
  container: AppContainer
): Promise<void> {
  const service =
    container.services.conversation;

  /*
   * Create conversation
   */
  app.post(
    "/users/:userId/conversations",
    async (
      request: FastifyRequest<{
        Params: UserIdParams;

        Body: Omit<
          CreateConversationInput,
          "userId"
        >;
      }>,
      reply: FastifyReply
    ) => {
      const conversation =
        await service.createConversation({
          userId:
            request.params.userId,

          title:
            request.body.title,
        });

      return reply.status(201).send({
        success: true,
        data: conversation,
      });
    }
  );

  /*
   * Get conversations for a user
   */
  app.get(
    "/users/:userId/conversations",
    async (
      request: FastifyRequest<{
        Params: UserIdParams;

        Querystring: {
          limit?: number;
          skip?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const limit =
        request.query.limit ?? 20;

      const skip =
        request.query.skip ?? 0;

      const conversations =
        await service.getUserConversations(
          request.params.userId,
          limit,
          skip
        );

      return reply.send({
        success: true,
        data: conversations,
      });
    }
  );

  /*
   * Get conversation
   */
  app.get(
    "/conversations/:conversationId",
    async (
      request: FastifyRequest<{
        Params: ConversationIdParams;
      }>,
      reply: FastifyReply
    ) => {
      const conversation =
        await service.getConversation(
          request.params
            .conversationId
        );

      if (!conversation) {
        return reply.status(404).send({
          success: false,
          error: {
            code:
              "CONVERSATION_NOT_FOUND",

            message:
              "Conversation not found",
          },
        });
      }

      return reply.send({
        success: true,
        data: conversation,
      });
    }
  );

  /*
   * Update conversation
   */
  app.patch(
    "/conversations/:conversationId",
    async (
      request: FastifyRequest<{
        Params: ConversationIdParams;

        Body: UpdateConversationInput;
      }>,
      reply: FastifyReply
    ) => {
      const conversation =
        await service.updateConversation(
          request.params
            .conversationId,

          request.body
        );

      if (!conversation) {
        return reply.status(404).send({
          success: false,
          error: {
            code:
              "CONVERSATION_NOT_FOUND",

            message:
              "Conversation not found",
          },
        });
      }

      return reply.send({
        success: true,
        data: conversation,
      });
    }
  );

  /*
   * Add a message
   */
  app.post(
    "/conversations/:conversationId/messages",
    async (
      request: FastifyRequest<{
        Params: ConversationIdParams;

        Body: Omit<
          AddMessageInput,
          "conversationId" | "userId"
        > & {
          userId: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const message =
        await service.addMessage({
          conversationId:
            request.params
              .conversationId,

          userId:
            request.body.userId,

          role:
            request.body.role,

          content:
            request.body.content,

          contentType:
            request.body.contentType,

          metadata:
            request.body.metadata,
        });

      return reply.status(201).send({
        success: true,
        data: message,
      });
    }
  );

  /*
   * Get recent messages
   */
  app.get(
    "/conversations/:conversationId/messages",
    async (
      request: FastifyRequest<{
        Params: ConversationIdParams;

        Querystring: {
          limit?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const limit =
        request.query.limit ?? 20;

      const messages =
        await service.getRecentMessages(
          request.params
            .conversationId,

          limit
        );

      return reply.send({
        success: true,
        data: messages,
      });
    }
  );
}