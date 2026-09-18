import Redis, {
  RedisOptions,
} from "ioredis";

import {
  AppLogger,
} from "../observability/logger";

export interface RedisDatabaseOptions {
  url: string;
  logger: AppLogger;

  maxRetriesPerRequest?: number;
  connectTimeout?: number;
  lazyConnect?: boolean;
}

export class RedisDatabase {
  private readonly redis: Redis;
  private readonly logger: AppLogger;

  constructor(options: RedisDatabaseOptions) {
    this.logger = options.logger;

    const redisOptions: RedisOptions = {
      maxRetriesPerRequest:
        options.maxRetriesPerRequest ?? 3,

      connectTimeout:
        options.connectTimeout ?? 5000,

      lazyConnect:
        options.lazyConnect ?? true,

      enableReadyCheck: true,
    };

    this.redis = new Redis(
      options.url,
      redisOptions
    );

    this.registerConnectionEvents();
  }

  async connect(): Promise<void> {
    if (this.redis.status === "ready") {
      return;
    }

    if (this.redis.status === "wait") {
      await this.redis.connect();
      return;
    }

    if (
      this.redis.status === "connecting" ||
      this.redis.status === "reconnecting"
    ) {
      await this.waitUntilReady();
      return;
    }

    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    if (
      this.redis.status === "end" ||
      this.redis.status === "wait"
    ) {
      return;
    }

    await this.redis.quit();

    this.logger.info(
      "Redis connection closed"
    );
  }

  async ping(): Promise<boolean> {
    try {
      const response = await this.redis.ping();

      return response === "PONG";
    } catch (error) {
      this.logger.error(
        {
          err: error,
        },
        "Redis ping failed"
      );

      return false;
    }
  }

  getClient(): Redis {
    return this.redis;
  }

  isConnected(): boolean {
    return this.redis.status === "ready";
  }

  private async waitUntilReady(): Promise<void> {
    await new Promise<void>(
      (resolve, reject) => {
        const onReady = () => {
          cleanup();
          resolve();
        };

        const onError = (
          error: Error
        ) => {
          cleanup();
          reject(error);
        };

        const cleanup = () => {
          this.redis.off(
            "ready",
            onReady
          );

          this.redis.off(
            "error",
            onError
          );
        };

        this.redis.once(
          "ready",
          onReady
        );

        this.redis.once(
          "error",
          onError
        );
      }
    );
  }

  private registerConnectionEvents(): void {
    this.redis.on(
      "connect",
      () => {
        this.logger.debug(
          "Redis connecting"
        );
      }
    );

    this.redis.on(
      "ready",
      () => {
        this.logger.info(
          "Redis connected"
        );
      }
    );

    this.redis.on(
      "reconnecting",
      () => {
        this.logger.warn(
          "Redis reconnecting"
        );
      }
    );

    this.redis.on(
      "close",
      () => {
        this.logger.warn(
          "Redis connection closed"
        );
      }
    );

    this.redis.on(
      "error",
      (error) => {
        this.logger.error(
          {
            err: error,
          },
          "Redis connection error"
        );
      }
    );
  }
}