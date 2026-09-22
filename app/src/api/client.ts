import { API_BASE_URL } from "../config";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);

    this.status = status;
    this.code = code;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
}

/**
 * Every server route (see ../../../server/src/app/app.ts) replies
 * with the same `{success, data}` / `{success:false, error}`
 * envelope — this is the one place that unwraps it.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",

      headers: {
        "Content-Type": "application/json",

        ...(options.token
          ? { Authorization: `Bearer ${options.token}` }
          : {}),
      },

      body:
        options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
    });
  } catch {
    throw new ApiError(
      `Could not reach the server at ${API_BASE_URL}. Is it running?`,
      0
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const json = (await response
    .json()
    .catch(() => null)) as Envelope<T> | null;

  if (!response.ok || !json?.success) {
    throw new ApiError(
      json?.error?.message ??
        `Request failed (${response.status})`,
      response.status,
      json?.error?.code
    );
  }

  return json.data as T;
}
