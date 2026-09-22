import {
  FastifyInstance,
} from "fastify";

import fastifyJwt from "@fastify/jwt";

import {
  AppContainer,
} from "../../app/container";

/**
 * Registers `@fastify/jwt` on the app and decorates
 * `app.authenticate` — a `preHandler` protected routes attach
 * via `{ preHandler: [app.authenticate, ...] }`. See §6 (Auth).
 */
export async function registerAuthPlugin(
  app: FastifyInstance,
  container: AppContainer
): Promise<void> {
  await app.register(fastifyJwt, {
    secret:
      container.config.auth.jwtSecret,

    sign: {
      expiresIn:
        container.config.auth
          .jwtExpiresIn,
    },
  });

  app.decorate(
    "authenticate",
    async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.status(401).send({
          success: false,

          error: {
            code: "UNAUTHORIZED",

            message:
              "Invalid or missing authentication token",
          },
        });
      }
    }
  );
}
