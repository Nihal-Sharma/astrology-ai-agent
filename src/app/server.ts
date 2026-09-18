import { createApp } from "./app";
import { config } from "./config";
import { createContainer } from "./container";
import { syncAstrologyToolsFromServer } from "../modules/astrology";

async function bootstrap(): Promise<void> {
  const container = createContainer();
   await container.db.mongo.connect();
    await container.db.redis.connect();
    await container.astrology.mcp.connect();
    await syncAstrologyToolsFromServer(
      container.astrology.mcp,
      container.astrology.toolRegistry,
      container.logger
    );
  const app = await createApp({
    container,
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}. Shutting down...`);

    try {
      await app.close();
        await Promise.allSettled([
          container.db.mongo.disconnect(),
          container.db.redis.disconnect(),
           container.astrology.mcp.disconnect(),
        ]);
      app.log.info("HTTP server closed successfully");

      process.exit(0);
    } catch (error) {
      app.log.error(
        {
          err: error,
        },
        "Error while shutting down"
      );

      process.exit(1);
    }
  };

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("uncaughtException", (error) => {
    app.log.fatal(
      {
        err: error,
      },
      "Uncaught exception"
    );

    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    app.log.fatal(
      {
        reason,
      },
      "Unhandled promise rejection"
    );

    process.exit(1);
  });

  try {
    await app.listen({
      host: config.app.host,
      port: config.app.port,
    });

    app.log.info(
      `🚀 ${config.app.name} running on ${config.app.host}:${config.app.port}`
    );
  } catch (error) {
    app.log.fatal(
      {
        err: error,
      },
      "Failed to start server"
    );
      await Promise.allSettled([
          container.db.mongo.disconnect(),
          container.db.redis.disconnect(),
          
        ]);
    process.exit(1);
  }
}

void bootstrap();