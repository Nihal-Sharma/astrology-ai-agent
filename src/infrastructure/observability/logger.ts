import pino, {
  Logger,
  LoggerOptions,
  Bindings,
} from "pino";

import { config } from "../../app/config";

export type AppLogger = Logger;

function createLogger(): AppLogger {
  const options: LoggerOptions = {
    name: config.app.name,

    level:
      config.app.env === "development"
        ? "debug"
        : "info",

    base: {
      service: config.app.name,
      environment: config.app.env,
    },

    timestamp: pino.stdTimeFunctions.isoTime,

    formatters: {
      level(label) {
        return {
          level: label,
        };
      },
    },
  };

  /**
   * Pretty logs in development.
   *
   * Production remains JSON so logs can be consumed by
   * log aggregation / observability systems.
   */
  if (config.app.env === "development") {
    return pino(
      {
        ...options,
      },
      pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      })
    );
  }

  return pino(options);
}

export const logger = createLogger();

/**
 * Create a child logger with persistent context.
 *
 * Example:
 *
 * const requestLogger = createChildLogger({
 *   requestId,
 *   sessionId,
 *   userId,
 * });
 *
 * requestLogger.info("Processing user turn");
 */
export function createChildLogger(
  bindings: Bindings
): AppLogger {
  return logger.child(bindings);
}