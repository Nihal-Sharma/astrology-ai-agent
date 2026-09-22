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

import {
  requireConversationOwnership,
  requireSelf,
} from "../auth";

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

  const selfGuards = [
    app.authenticate,
    requireSelf("userId"),
  ];

  const conversationGuards = [
    app.authenticate,
    requireConversationOwnership(
      container
    ),
  ];

  /*
   * Create conversation
   */
  app.post<{
    Params: UserIdParams;

    Body: Omit<
      CreateConversationInput,
      "userId"
    >;
  }>(
    "/users/:userId/conversations",
    {
      preHandler: selfGuards,
    },
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
  app.get<{
    Params: UserIdParams;

    Querystring: {
      limit?: number;
      skip?: number;
    };
  }>(
    "/users/:userId/conversations",
    {
      preHandler: selfGuards,
    },
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
  app.get<{
    Params: ConversationIdParams;
  }>(
    "/conversations/:conversationId",
    {
      preHandler: conversationGuards,
    },
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
  app.patch<{
    Params: ConversationIdParams;

    Body: UpdateConversationInput;
  }>(
    "/conversations/:conversationId",
    {
      preHandler: conversationGuards,
    },
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
  app.post<{
    Params: ConversationIdParams;

    Body: Omit<
      AddMessageInput,
      "conversationId" | "userId"
    >;
  }>(
    "/conversations/:conversationId/messages",
    {
      preHandler: conversationGuards,
    },
    async (
      request: FastifyRequest<{
        Params: ConversationIdParams;

        Body: Omit<
          AddMessageInput,
          "conversationId" | "userId"
        >;
      }>,
      reply: FastifyReply
    ) => {
      /*
       * userId comes from the verified token, never the request
       * body — the guard above already confirmed this
       * conversation belongs to request.user.userId, but a
       * client-supplied body.userId would let anyone post a
       * message attributed to a different user in their own
       * conversation. See §6 (Auth).
       */
      const message =
        await service.addMessage({
          conversationId:
            request.params
              .conversationId,

          userId:
            request.user.userId,

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
  app.get<{
    Params: ConversationIdParams;

    Querystring: {
      limit?: number;
    };
  }>(
    "/conversations/:conversationId/messages",
    {
      preHandler: conversationGuards,
    },
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