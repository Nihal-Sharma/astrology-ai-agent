import crypto from "node:crypto";

import {
  AppLogger,
} from "./logger";

/**
 * Real (if intentionally lightweight) span tracing, replacing
 * the original `console.log`-only stub — see §6 (Platform/
 * Observability).
 *
 * Deliberately NOT the OpenTelemetry SDK: a real OTel wiring
 * needs an exporter destination (Jaeger, Honeycomb, Datadog,
 * ...), which is an infrastructure/cost decision for whoever
 * runs this in production, not something to pick silently here.
 * This gives genuine nested span timing today — traceId/spanId/
 * parentSpanId/durationMs/attributes, structured through the
 * existing real Pino logger — with a shape that maps directly
 * onto OTel spans if/when a real backend is chosen later.
 */
export interface Span {
  traceId: string;

  spanId: string;

  end(
    attributes?: Record<string, unknown>
  ): void;
}

export interface StartSpanOptions {
  traceId?: string;

  parentSpanId?: string;

  attributes?: Record<string, unknown>;
}

export function startSpan(
  name: string,
  logger: AppLogger,
  options?: StartSpanOptions
): Span {
  const traceId =
    options?.traceId ??
    crypto.randomUUID();

  const spanId = crypto.randomUUID();

  const startedAt = performance.now();

  return {
    traceId,

    spanId,

    end(endAttributes) {
      const durationMs = Math.round(
        performance.now() - startedAt
      );

      logger.debug(
        {
          module: "tracing",
          traceId,
          spanId,
          parentSpanId:
            options?.parentSpanId,
          span: name,
          durationMs,
          ...options?.attributes,
          ...endAttributes,
        },
        `span:${name}`
      );
    },
  };
}
