import {
  ClientEvent,
} from "./realtime.types";

export function parseClientEvent(
  raw: string
): ClientEvent {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Invalid JSON payload"
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null
  ) {
    throw new Error(
      "WebSocket event must be an object"
    );
  }

  const event =
    parsed as Record<
      string,
      unknown
    >;

  if (
    typeof event.type !==
    "string"
  ) {
    throw new Error(
      "WebSocket event type is required"
    );
  }

  if (
    typeof event.requestId !==
    "string"
  ) {
    throw new Error(
      "WebSocket requestId is required"
    );
  }

  return {
    type: event.type as ClientEvent["type"],

    requestId:
      event.requestId,

    payload:
      event.payload,
  };
}