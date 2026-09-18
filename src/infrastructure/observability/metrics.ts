import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from "@prometheus-io/client";

/**
 * Real Prometheus metrics, replacing the original
 * `console.log`-only stub — see §6 (Platform/Observability).
 * Self-contained: no external service required to write or
 * collect these, just a `/metrics` endpoint (registered in
 * app.ts) for something to scrape.
 */
export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
});

export const httpRequestDurationMs =
  new Histogram({
    name: "http_request_duration_ms",

    help: "HTTP request duration in milliseconds",

    labelNames: [
      "method",
      "route",
      "statusCode",
    ],

    buckets: [
      10, 50, 100, 250, 500, 1000,
      2500, 5000,
    ],

    registers: [metricsRegistry],
  });

export const llmRequestDurationMs =
  new Histogram({
    name: "llm_request_duration_ms",

    help: "LLM API call duration in milliseconds",

    labelNames: [
      "provider",
      "model",
      "operation",
      "status",
    ],

    buckets: [
      100, 300, 500, 1000, 2000,
      5000, 10000, 20000,
    ],

    registers: [metricsRegistry],
  });

export const mcpToolCallDurationMs =
  new Histogram({
    name: "mcp_tool_call_duration_ms",

    help: "Astrology MCP tool call duration in milliseconds",

    labelNames: [
      "tool",
      "status",
      "cacheHit",
    ],

    buckets: [
      10, 50, 100, 250, 500, 1000,
      2500, 5000,
    ],

    registers: [metricsRegistry],
  });

export const activeWebsocketConnections =
  new Gauge({
    name: "realtime_active_websocket_connections",

    help: "Currently open realtime WebSocket connections",

    registers: [metricsRegistry],
  });

export const agentTurnsTotal =
  new Counter({
    name: "agent_turns_total",

    help: "Total agent turns processed",

    labelNames: [
      "inputType",
      "personaMode",
      "status",
    ],

    registers: [metricsRegistry],
  });

export const rateLimitedTurnsTotal =
  new Counter({
    name: "rate_limited_turns_total",

    help: "Chat/voice turns rejected by the per-user rate limit",

    registers: [metricsRegistry],
  });
