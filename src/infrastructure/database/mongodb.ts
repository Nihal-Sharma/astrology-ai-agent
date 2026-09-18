import mongoose, {
  Connection,
} from "mongoose";

import {
  AppLogger,
} from "../observability/logger";

export interface MongoDatabaseOptions {
  uri: string;
  logger: AppLogger;

  maxPoolSize?: number;
  minPoolSize?: number;
  serverSelectionTimeoutMS?: number;
  socketTimeoutMS?: number;
}

export class MongoDatabase {
  private readonly uri: string;

  private readonly logger: AppLogger;

  private readonly options: Omit<
    MongoDatabaseOptions,
    "uri" | "logger"
  >;

  private connection: Connection | null = null;

  constructor(options: MongoDatabaseOptions) {
    this.uri = options.uri;
    this.logger = options.logger;

    this.options = {
      maxPoolSize: options.maxPoolSize ?? 20,
      minPoolSize: options.minPoolSize ?? 5,
      serverSelectionTimeoutMS:
        options.serverSelectionTimeoutMS ?? 5000,
      socketTimeoutMS:
        options.socketTimeoutMS ?? 10000,
    };
  }

  async connect(): Promise<void> {
    if (this.connection?.readyState === 1) {
      return;
    }

    await mongoose.connect(this.uri, {
      maxPoolSize: this.options.maxPoolSize,
      minPoolSize: this.options.minPoolSize,
      serverSelectionTimeoutMS:
        this.options.serverSelectionTimeoutMS,
      socketTimeoutMS:
        this.options.socketTimeoutMS,
    });

    this.connection = mongoose.connection;

    this.registerConnectionEvents();

    this.logger.info(
      "MongoDB connection established"
    );
  }

  async disconnect(): Promise<void> {
    if (!this.connection) {
      return;
    }

    await mongoose.disconnect();

    this.connection = null;

    this.logger.info(
      "MongoDB connection closed"
    );
  }

  async ping(): Promise<boolean> {
    if (
      !this.connection?.db ||
      this.connection.readyState !== 1
    ) {
      return false;
    }

    try {
      await this.connection.db.admin().ping();

      return true;
    } catch (error) {
      this.logger.error(
        {
          err: error,
        },
        "MongoDB ping failed"
      );

      return false;
    }
  }

  getConnection(): Connection {
    if (!this.connection) {
      throw new Error(
        "MongoDB connection has not been initialized. Call connect() first."
      );
    }

    return this.connection;
  }

  isConnected(): boolean {
    return this.connection?.readyState === 1;
  }

  private registerConnectionEvents(): void {
    if (!this.connection) {
      return;
    }

    this.connection.on(
      "connected",
      () => {
        this.logger.info(
          "MongoDB connected"
        );
      }
    );

    this.connection.on(
      "disconnected",
      () => {
        this.logger.warn(
          "MongoDB disconnected"
        );
      }
    );

    this.connection.on(
      "reconnected",
      () => {
        this.logger.info(
          "MongoDB reconnected"
        );
      }
    );

    this.connection.on(
      "error",
      (error) => {
        this.logger.error(
          {
            err: error,
          },
          "MongoDB connection error"
        );
      }
    );
  }
}