import {
  FastifyInstance,
} from "fastify";

import websocket from "@fastify/websocket";

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
      container.logger
    );

  app.get(
    "/ws",
    {
      websocket: true,
    },
    (socket, request) => {
      const session: RealtimeSessionContext = {
        sessionId:
          crypto.randomUUID(),
      };

      container.logger.info(
        {
          module:
            "realtime",

          sessionId:
            session.sessionId,

          ip:
            request.ip,
        },
        "WebSocket session connected"
      );

      socket.on(
        "message",
        async (
          raw,
          isBinary
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
                  userId?: string;
                  conversationId?: string;
                };

              session.userId =
                payload.userId;

              session.conversationId =
                payload.conversationId;

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