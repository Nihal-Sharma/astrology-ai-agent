import {
  Client,
} from "@modelcontextprotocol/client";

import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import {
  AppLogger,
} from "../../../infrastructure/observability/logger";

import {
  delay,
} from "../../../shared/utils/timing";

import {
  McpClientOptions,
  McpConnectionState,
  McpToolCallInput,
  McpToolCallResult,
  McpToolDefinition,
} from "./mcp.types";

export class AstrologyMcpClient {
  /*
   * ------------------------------------------------------------
   * Reconnect / circuit-breaker tuning.
   *
   * Without this, a dropped connection had no recovery path:
   * `connected` was only ever flipped by an explicit connect()/
   * disconnect() call, so once the underlying transport died
   * silently, every subsequent request kept failing until the
   * process was restarted. These two layers fix that:
   * - a couple of quick retries inside connect() ride out a
   *   single transient blip.
   * - the circuit breaker stops repeated calls from each
   *   individually retrying (and adding latency) against a
   *   server that's genuinely down for longer.
   * ------------------------------------------------------------
   */
  private static readonly CONNECT_MAX_ATTEMPTS = 2;

  private static readonly CONNECT_RETRY_DELAY_MS = 500;

  private static readonly CIRCUIT_BREAKER_THRESHOLD = 3;

  private static readonly CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

  private readonly client: Client;

  private readonly serverUrl: string;

  private readonly apiKey: string;

  private readonly timeoutMs: number;

  private readonly logger: AppLogger;

  private connected = false;

  private intentionalDisconnect = false;

  private consecutiveConnectFailures = 0;

  private circuitOpenUntil: number | null = null;

  constructor(
    options: McpClientOptions,
    logger: AppLogger
  ) {
    this.serverUrl =
      options.serverUrl;

    this.apiKey =
      options.apiKey;

    this.timeoutMs =
      options.timeoutMs;

    this.logger = logger;

    this.client = new Client({
      name: options.clientName,
      version: options.clientVersion,
    });

    /*
     * The MCP SDK invokes `onclose` whenever the underlying
     * connection closes for ANY reason — including a silent,
     * unexpected drop — which is the only reliable way to
     * notice that. Without this, `connected` would stay
     * (wrongly) `true` forever after a drop.
     */
    this.client.onclose = () =>
      this.handleUnexpectedClose();

    this.client.onerror = (
      error
    ) =>
      this.logger.warn(
        {
          err: error,
          module: "astrology-mcp",
        },
        "Astrology MCP transport error"
      );
  }

  /**
   * Builds a fresh transport per connection attempt.
   *
   * `StreamableHTTPClientTransport` refuses a second `start()`
   * call on the same instance (throws "already started"), so
   * reusing one across retries would make every retry after
   * the first fail immediately with that SDK-internal guard
   * error instead of actually attempting to reconnect.
   */
  private createTransport(): StreamableHTTPClientTransport {
    return new StreamableHTTPClientTransport(
      new URL(this.serverUrl),
      {
        requestInit: {
          headers: {
            "x-astrologyapi-key":
              this.apiKey,

            "Content-Type":
              "application/json",
          },
        },
      }
    );
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.isCircuitOpen()) {
      throw new Error(
        `Astrology MCP circuit breaker is open (too many recent connection failures) — will retry automatically after ${new Date(this.circuitOpenUntil as number).toISOString()}`
      );
    }

    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <=
      AstrologyMcpClient.CONNECT_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const startedAt =
        performance.now();

      try {
        await this.withTimeout(
          this.client.connect(
            this.createTransport()
          )
        );

        this.connected = true;

        this.consecutiveConnectFailures = 0;

        this.circuitOpenUntil = null;

        const serverVersion =
          this.client.getServerVersion();

        this.logger.info(
          {
            module:
              "astrology-mcp",
            serverUrl:
              this.serverUrl,
            serverName:
              serverVersion?.name,
            serverVersion:
              serverVersion?.version,
            attempt,
            durationMs:
              Math.round(
                performance.now() -
                  startedAt
              ),
          },
          "Connected to astrology MCP server"
        );

        return;
      } catch (error) {
        lastError = error;

        this.connected = false;

        this.logger.warn(
          {
            err: error,
            module:
              "astrology-mcp",
            serverUrl:
              this.serverUrl,
            attempt,
            maxAttempts:
              AstrologyMcpClient.CONNECT_MAX_ATTEMPTS,
          },
          "Failed to connect to astrology MCP server"
        );

        if (
          attempt <
          AstrologyMcpClient.CONNECT_MAX_ATTEMPTS
        ) {
          await delay(
            AstrologyMcpClient.CONNECT_RETRY_DELAY_MS *
              attempt
          );
        }
      }
    }

    this.recordConnectFailure();

    this.logger.error(
      {
        err: lastError,
        module: "astrology-mcp",
        serverUrl: this.serverUrl,
      },
      "Exhausted all connection attempts to astrology MCP server"
    );

    throw lastError;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.intentionalDisconnect = true;

    try {
      await this.client.close();
    } finally {
      this.connected = false;

      this.logger.info(
        {
          module: "astrology-mcp",
        },
        "Disconnected from astrology MCP server"
      );
    }
  }

  private handleUnexpectedClose(): void {
    /*
     * disconnect() already logs and updates state for the
     * intentional case — nothing more to do here.
     */
    if (this.intentionalDisconnect) {
      this.intentionalDisconnect = false;

      return;
    }

    if (this.connected) {
      this.connected = false;

      this.logger.warn(
        {
          module: "astrology-mcp",
        },
        "Astrology MCP connection dropped unexpectedly — will reconnect automatically on next request"
      );
    }
  }

  private isCircuitOpen(): boolean {
    if (this.circuitOpenUntil === null) {
      return false;
    }

    if (
      Date.now() >=
      this.circuitOpenUntil
    ) {
      /*
       * Cooldown elapsed — allow one trial attempt through.
       */
      this.circuitOpenUntil = null;

      this.consecutiveConnectFailures = 0;

      return false;
    }

    return true;
  }

  private recordConnectFailure(): void {
    this.consecutiveConnectFailures += 1;

    if (
      this.consecutiveConnectFailures >=
      AstrologyMcpClient.CIRCUIT_BREAKER_THRESHOLD
    ) {
      this.circuitOpenUntil =
        Date.now() +
        AstrologyMcpClient.CIRCUIT_BREAKER_COOLDOWN_MS;

      this.logger.error(
        {
          module: "astrology-mcp",
          consecutiveFailures:
            this.consecutiveConnectFailures,
          cooldownMs:
            AstrologyMcpClient.CIRCUIT_BREAKER_COOLDOWN_MS,
        },
        "Astrology MCP circuit breaker opened after repeated connection failures"
      );
    }
  }

  async listTools(): Promise<
    McpToolDefinition[]
  > {
    await this.ensureConnected();

    const result =
      await this.client.listTools();

    return result.tools.map(
      (tool) => ({
        name: tool.name,

        description:
          tool.description,

        inputSchema:
          tool.inputSchema,

        source: "server",

        enabled: true,

        categories: ["server"],
      })
    );
  }

  async callTool(
    input: McpToolCallInput
  ): Promise<McpToolCallResult> {
    await this.ensureConnected();

    const startedAt =
      performance.now();

    try {
      /*
       * MCP SDK supports passing an AbortSignal
       * through request options.
       */
      const result =
        await this.withTimeout(
          this.client.callTool(
            {
              name:
                input.toolName,

              arguments:
                input.arguments ?? {},
            },
            {
              signal:
                input.signal,
            }
          )
        );

      const executionTimeMs =
        Math.round(
          performance.now() -
            startedAt
        );

      this.logger.debug(
        {
          module:
            "astrology-mcp",

          tool:
            input.toolName,

          durationMs:
            executionTimeMs,
        },
        "MCP tool executed"
      );

      return {
        toolName:
          input.toolName,

        success:
          !result.isError,

        content:
          result.content,

        isError:
          result.isError,

        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs =
        Math.round(
          performance.now() -
            startedAt
        );

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        {
          err: error,

          module:
            "astrology-mcp",

          tool:
            input.toolName,

          durationMs:
            executionTimeMs,
        },
        "MCP tool execution failed"
      );

      return {
        toolName:
          input.toolName,

        success: false,

        content: [],

        executionTimeMs,

        error: message,
      };
    }
  }

  /**
   * Real liveness check via the MCP protocol's own `ping`
   * request — not just the locally-cached `connected` flag —
   * matching how `MongoDatabase.ping()`/`RedisDatabase.ping()`
   * verify actual reachability for the `/ready` endpoint.
   */
  async ping(): Promise<boolean> {
    if (!this.connected) {
      return false;
    }

    try {
      await this.withTimeout(
        this.client.ping()
      );

      return true;
    } catch (error) {
      this.logger.warn(
        {
          err: error,

          module:
            "astrology-mcp",
        },
        "MCP ping failed"
      );

      return false;
    }
  }

  getConnectionState():
    McpConnectionState {
    const serverVersion =
      this.client.getServerVersion();

    return {
      connected:
        this.connected,

      serverName:
        serverVersion?.name,

      serverVersion:
        serverVersion?.version,

      protocolVersion: undefined,
    };
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>
  ): Promise<T> {
    let timeoutHandle:
      NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,

        new Promise<T>(
          (_, reject) => {
            timeoutHandle =
              setTimeout(
                () => {
                  reject(
                    new Error(
                      `MCP request timed out after ${this.timeoutMs}ms`
                    )
                  );
                },
                this.timeoutMs
              );
          }
        ),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(
          timeoutHandle
        );
      }
    }
  }
}