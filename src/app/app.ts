import Fastify, {
  FastifyInstance,
  FastifyServerOptions,
} from "fastify";

import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";

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

import {
  registerAuthPlugin,
  registerAuthController,
} from "../modules/auth";

import {
  AppError,
} from "../shared/errors/app-error";

import {
  metricsRegistry,
} from "../infrastructure/observability/metrics";

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

  await app.register(fastifyCors, {
    origin:
      options.container.config.cors
        .origin,
  });

  /*
   * General REST rate limit (cost/abuse control) — the
   * separate, stricter per-user chat/voice turn limit lives in
   * RealtimeService, since that path isn't one HTTP request per
   * turn. See §6 (Platform/Auth).
   */
  await app.register(
    fastifyRateLimit,
    {
      max: options.container.config
        .rateLimit.max,

      timeWindow:
        options.container.config
          .rateLimit.windowMs,
    }
  );

  /*
   * Registers `app.authenticate` — every controller below reads
   * this decorator at route-registration time, so it must be
   * registered first.
   */
  await registerAuthPlugin(
    app,
    options.container
  );

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
   * Prometheus scrape endpoint — see §6 (Observability).
   * Unauthenticated, same as /health and /ready: it's how
   * Prometheus itself reaches it (no auth headers by default),
   * and it exposes only aggregated numeric metrics, no PII.
   */
  app.get(
    "/metrics",
    async (_request, reply) => {
      reply.header(
        "Content-Type",
        metricsRegistry.contentType
      );

      return metricsRegistry.metrics();
    }
  );

  /**
   * Root endpoint.
   */
  app.get("/", async () => {
    return {
      service: options.container.config.app.name,
      status: "running",
    };
  });

  await registerAuthController(
    app,
    options.container
  );

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

  /**
   * Global error handler. Recognizes AppError (thrown by
   * auth/ownership guards and service-layer validation) and
   * uses its statusCode/message; anything else is an unexpected
   * 500 with the message hidden outside development.
   */
  app.setErrorHandler((error: Error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn(
        {
          err: error,
        },
        "Handled application error"
      );

      return reply
        .status(error.statusCode)
        .send({
          success: false,
          error: {
            code: "APPLICATION_ERROR",
            message: error.message,
          },
        });
    }

    /*
     * Fastify's own errors (malformed JSON body, payload too
     * large, schema validation, ...) already carry a correct
     * client-error statusCode — use it instead of defaulting
     * every unrecognized error to 500, so a bad request from
     * the client is reported as a 4xx, not "our fault".
     */
    const fastifyStatusCode = (
      error as {
        statusCode?: number;
      }
    ).statusCode;

    const statusCode =
      fastifyStatusCode &&
      fastifyStatusCode >= 400 &&
      fastifyStatusCode < 500
        ? fastifyStatusCode
        : 500;

    request.log.error(
      {
        err: error,
      },
      "Unhandled application error"
    );

    return reply.status(statusCode).send({
      success: false,
      error: {
        code:
          statusCode < 500
            ? "BAD_REQUEST"
            : "INTERNAL_SERVER_ERROR",
        message:
          statusCode < 500 ||
          options.container.config.app.env === "development"
            ? error.message
            : "Internal server error",
      },
    });
  });

  return app;
}
