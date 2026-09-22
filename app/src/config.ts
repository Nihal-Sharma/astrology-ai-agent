import { Platform } from "react-native";

const DEFAULT_PORT = 3000;

/**
 * Android emulators can't reach the host machine via "localhost"
 * — 10.0.2.2 is the emulator's alias for it. iOS simulator and
 * web share the host's loopback, so "localhost" works there.
 * Physical devices need the host's LAN IP instead — override via
 * EXPO_PUBLIC_API_URL in that case (see .env.example).
 */
function defaultApiUrl(): string {
  const host = Platform.OS === "android" ? "10.0.2.2" : "localhost";

  return `http://${host}:${DEFAULT_PORT}`;
}

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? defaultApiUrl();

/** Same host as API_BASE_URL, ws(s):// scheme — the /ws realtime gateway. */
export const WS_BASE_URL: string =
  API_BASE_URL.replace(/^http/, "ws");
