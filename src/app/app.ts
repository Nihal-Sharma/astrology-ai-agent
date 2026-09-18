import Fastify, {
  FastifyInstance,
  FastifyServerOptions,
} from "fastify";

import { AppContainer } from "./container";

import {
  registerUserController,
} from "../modules/user";

import {
  registerBirthProfileController,
} from "../modules/birth-profile";
import {
  registerPartnerProfileController,
} from "../modules/partner-profile";
import {
  registerConversationController,
} from "../modules/conversation";
export interface CreateAppOptions {
  container: AppContainer;
}
import {
  registerRealtimeGateway,
} from "../modules/realtime";
export async function createApp(
  options: CreateAppOptions
): Promise<FastifyInstance> {
  const loggerOptions: FastifyServerOptions["logger"] = {
    level:
      options.container.config.app.env === "development"
        ? "debug"
        : "info",
  };

  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
  });

  /**
   * Global health endpoint.
   *
   * Keep this independent from business modules so infrastructure
   * health can be checked even when the agent itself is unavailable.
   */
  app.get("/health", async () => {
    return {
      status: "ok",
      service: options.container.config.app.name,
      environment: options.container.config.app.env,
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * Readiness endpoint — verifies MongoDB, Redis, and the
   * astrology MCP server are all actually reachable, not just
   * that the process is up.
   */
  app.get("/ready", async (request, reply) => {
  const { mongo, redis } = options.container.db;
  const { mcp } = options.container.astrology;

  const [mongoReady, redisReady, mcpReady] =
    await Promise.all([
      mongo.ping(),
      redis.ping(),
      mcp.ping(),
    ]);

  const ready = mongoReady && redisReady && mcpReady;

  if (!ready) {
    return reply.status(503).send({
      status: "not_ready",

      dependencies: {
        mongodb: mongoReady
          ? "ready"
          : "unavailable",

        redis: redisReady
          ? "ready"
          : "unavailable",

        astrologyMcp: mcpReady
          ? "ready"
          : "unavailable",
      },
    });
  }

  return {
    status: "ready",

    dependencies: {
      mongodb: "ready",
      redis: "ready",
      astrologyMcp: "ready",
    },
  };
});
  /**
   * Root endpoint.
   */
  app.get("/", async () => {
    return {
      service: options.container.config.app.name,
      status: "running",
    };
  });

  /**
   * TODO:
   *
   * Register modules here:
   *
   * await registerUserModule(app, container);
   * await registerConversationModule(app, container);
   * await registerBirthProfileModule(app, container);
   * await registerAgentModule(app, container);
   * await registerVoiceModule(app, container);
   */

  /**
   * Global error handler.
   *
   * We'll replace this with the shared application error system
   * once src/shared/errors is implemented.
   */
  await registerRealtimeGateway(
  app,
  options.container
);
  await registerUserController(
    app,
    options.container
  );
 await registerConversationController(
  app,
  options.container
);
  await registerBirthProfileController(
    app,
    options.container
  );
  await registerPartnerProfileController(
    app,
    options.container
  );
  app.setErrorHandler((error: Error, request, reply) => {
    request.log.error(
      {
        err: error,
      },
      "Unhandled application error"
    );

    return reply.status(500).send({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message:
          options.container.config.app.env === "development"
            ? error.message
            : "Internal server error",
      },
    });
  });

  return app;
}