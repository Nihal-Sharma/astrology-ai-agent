import {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  AppContainer,
} from "../../app/container";

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({
    success: false,

    error: {
      code: "FORBIDDEN",

      message:
        "You do not have access to this resource",
    },
  });
}

/**
 * Route param `paramName` (e.g. "userId") must equal the
 * authenticated user's id — must run AFTER `app.authenticate`.
 */
export function requireSelf(
  paramName: string
) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const params =
      request.params as Record<
        string,
        string
      >;

    if (
      request.user?.userId !==
      params[paramName]
    ) {
      return forbidden(reply);
    }
  };
}

/**
 * Route param `:conversationId` must belong to a conversation
 * owned by the authenticated user — must run AFTER
 * `app.authenticate`. Covers routes keyed by conversationId
 * alone (conversations, messages, partner-profile), where
 * ownership can't be checked from the URL directly.
 */
export function requireConversationOwnership(
  container: AppContainer
) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const params =
      request.params as {
        conversationId?: string;
      };

    const conversationId =
      params.conversationId;

    if (!conversationId) {
      return reply.status(400).send({
        success: false,

        error: {
          code: "BAD_REQUEST",

          message:
            "conversationId is required",
        },
      });
    }

    const conversation =
      await container.services.conversation.getConversation(
        conversationId
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

    if (
      conversation.userId.toString() !==
      request.user?.userId
    ) {
      return forbidden(reply);
    }
  };
}
