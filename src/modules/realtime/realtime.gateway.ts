import {
  FastifyInstance,
  FastifyRequest,
} from "fastify";

import websocket from "@fastify/websocket";

import type {
  RawData,
} from "ws";

import {
  AppContainer,
} from "../../app/container";

import {
  parseClientEvent,
} from "./realtime.protocol";

import {
  RealtimeService,
  RealtimeSessionContext,
} from "./realtime.service";

import {
  activeWebsocketConnections,
} from "../../infrastructure/observability/metrics";

interface WsAuthQuery {
  token?: string;
}

export async function registerRealtimeGateway(
  app: FastifyInstance,
  container: AppContainer
): Promise<void> {
  await app.register(
    websocket
  );

  const realtimeService =
    new RealtimeService(
      container.services.agent,
      container.speech.stt,
      container.speech.tts,
      container.logger,
      container.config.rateLimit
        .chatMaxPerMinute
    );

  app.get<{
    Querystring: WsAuthQuery;
  }>(
    "/ws",
    {
      websocket: true,

      /*
       * Browsers' native WebSocket API can't set custom headers
       * on the upgrade request, so auth travels as a query
       * param here rather than `Authorization: Bearer` — see
       * §6 (Auth). This is the only place a token is accepted
       * outside a header.
       */
      preHandler: async (
        request: FastifyRequest<{
          Querystring: WsAuthQuery;
        }>,
        reply
      ) => {
        const token =
          request.query.token;

        if (!token) {
          return reply
            .status(401)
            .send({
              success: false,
              error: {
                code: "UNAUTHORIZED",
                message:
                  "Missing token query parameter",
              },
            });
        }

        try {
          request.user =
            app.jwt.verify(token);
        } catch {
          return reply
            .status(401)
            .send({
              success: false,
              error: {
                code: "UNAUTHORIZED",
                message:
                  "Invalid or expired token",
              },
            });
        }
      },
    },
    (socket, request) => {
      const session: RealtimeSessionContext = {
        sessionId:
          crypto.randomUUID(),

        /*
         * From the verified token, not client-supplied — see
         * the session:start handler below, which no longer
         * trusts a client-sent userId either.
         */
        userId:
          request.user.userId,
      };

      container.logger.info(
        {
          module:
            "realtime",

          sessionId:
            session.sessionId,

          userId:
            session.userId,

          ip:
            request.ip,
        },
        "WebSocket session connected"
      );

      activeWebsocketConnections.inc();

      socket.on(
        "message",
        async (
          raw: RawData,
          isBinary: boolean
        ) => {
          try {
            /*
             * Raw audio bytes for the turn currently being
             * recorded — see the wire-format decision in
             * realtime.types.ts. No JSON envelope for these;
             * `audio:start` (JSON) is what opens the buffer.
             */
            if (isBinary) {
              if (
                !session.audioChunks
              ) {
                throw new Error(
                  "Received a binary audio frame before audio:start"
                );
              }

              session.audioChunks.push(
                Buffer.isBuffer(
                  raw
                )
                  ? raw
                  : Buffer.from(
                      raw as ArrayBuffer
                    )
              );

              return;
            }

            const event =
              parseClientEvent(
                raw.toString()
              );

            if (
              event.type ===
              "session:start"
            ) {
              const payload =
                event.payload as {
                  conversationId?: string;
                };

              /*
               * session.userId is already set from the verified
               * token at connection time — a client-supplied
               * userId here is ignored, not trusted. The
               * conversationId IS client-supplied, so its
               * ownership must be checked before accepting it.
               */
              if (
                payload.conversationId
              ) {
                const conversation =
                  await container.services.conversation.getConversation(
                    payload.conversationId
                  );

                if (
                  !conversation ||
                  conversation.userId.toString() !==
                    session.userId
                ) {
                  /*
                   * Reject just this session:start, don't kill
                   * the whole connection — the token itself is
                   * still valid, so the client can simply retry
                   * with a conversationId it actually owns.
                   * session.conversationId is left unset, so any
                   * subsequent chat:send/audio:end still can't
                   * proceed (see the "conversationId is required"
                   * guard in RealtimeService).
                   */
                  socket.send(
                    JSON.stringify({
                      type: "chat:error",

                      requestId:
                        event.requestId,

                      payload: {
                        message:
                          "Conversation not found or not accessible",
                      },

                      timestamp:
                        new Date().toISOString(),
                    })
                  );

                  return;
                }

                session.conversationId =
                  payload.conversationId;
              }

              socket.send(
                JSON.stringify({
                  type:
                    "session:ready",

                  requestId:
                    event.requestId,

                  payload: {
                    sessionId:
                      session.sessionId,
                  },

                  timestamp:
                    new Date().toISOString(),
                })
              );

              return;
            }

            if (
              event.type ===
              "chat:cancel"
            ) {
              const cancelledTurnType =
                realtimeService.cancel(
                  session
                );

              socket.send(
                JSON.stringify({
                  type:
                    cancelledTurnType ===
                    "audio"
                      ? "audio:cancelled"
                      : "chat:cancelled",

                  requestId:
                    event.requestId,

                  payload: {},

                  timestamp:
                    new Date().toISOString(),
                })
              );

              return;
            }

            if (
              event.type ===
              "chat:send"
            ) {
              const payload =
                event.payload as {
                  message?: string;
                };

              if (
                !payload?.message
              ) {
                throw new Error(
                  "message is required"
                );
              }

              for await (
                const serverEvent of realtimeService.processText(
                  session,
                  {
                    requestId:
                      event.requestId,

                    message:
                      payload.message,
                  }
                )
              ) {
                if (
                  socket.readyState ===
                  1
                ) {
                  socket.send(
                    JSON.stringify(
                      serverEvent
                    )
                  );
                }
              }

              return;
            }

            if (
              event.type ===
              "audio:start"
            ) {
              const payload =
                event.payload as {
                  format?: string;
                };

              session.audioChunks =
                [];

              session.audioFormat =
                payload?.format;

              return;
            }

            if (
              event.type ===
              "audio:end"
            ) {
              const chunks =
                session.audioChunks ??
                [];

              session.audioChunks =
                undefined;

              const audio =
                Buffer.concat(
                  chunks
                );

              for await (
                const message of realtimeService.processAudio(
                  session,
                  {
                    requestId:
                      event.requestId,

                    audio,

                    format:
                      session.audioFormat,
                  }
                )
              ) {
                if (
                  socket.readyState !==
                  1
                ) {
                  continue;
                }

                /*
                 * Raw binary audio frame vs. JSON status
                 * event — see the wire-format decision in
                 * realtime.types.ts.
                 */
                if (
                  Buffer.isBuffer(
                    message
                  )
                ) {
                  socket.send(
                    message
                  );
                } else {
                  socket.send(
                    JSON.stringify(
                      message
                    )
                  );
                }
              }

              return;
            }

            if (
              event.type ===
              "session:end"
            ) {
              realtimeService.cancel(
                session
              );

              socket.close();

              return;
            }
          } catch (error) {
            container.logger.error(
              {
                err: error,

                module:
                  "realtime",

                sessionId:
                  session.sessionId,
              },
              "WebSocket message failed"
            );

            socket.send(
              JSON.stringify({
                type:
                  "chat:error",

                requestId:
                  "unknown",

                payload: {
                  message:
                    error instanceof
                    Error
                      ? error.message
                      : "Invalid request",
                },

                timestamp:
                  new Date().toISOString(),
              })
            );
          }
        }
      );

      socket.on(
        "close",
        () => {
          realtimeService.cancel(
            session
          );

          activeWebsocketConnections.dec();

          container.logger.info(
            {
              module:
                "realtime",

              sessionId:
                session.sessionId,
            },
            "WebSocket session disconnected"
          );
        }
      );
    }
  );
}