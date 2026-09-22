const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Minimal base64url decoder — no `atob`/Buffer dependency
 * (neither is reliably available across Hermes/iOS/Android/web),
 * and the JWT payload here is plain ASCII JSON so a full UTF-8
 * decode isn't needed.
 */
function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");

  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const char of normalized) {
    const value = BASE64_CHARS.indexOf(char);

    if (value === -1) {
      continue;
    }

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  return output;
}

export interface JwtPayload {
  userId: string;
  email?: string;
  iat: number;
  exp: number;
}

/** Decodes the payload only — never trust this for verification, the server already signed/verified it. */
export function decodeJwtPayload(
  token: string
): JwtPayload | null {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  try {
    const json = base64UrlDecode(parts[1]);

    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}
