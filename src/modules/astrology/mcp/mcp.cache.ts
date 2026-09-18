import {
  createHash,
} from "node:crypto";

import {
  RedisDatabase,
} from "../../../infrastructure/database";

export interface McpCacheInput {
  toolName: string;

  arguments: Record<
    string,
    unknown
  >;
}

/*
 * ------------------------------------------------------------
 * TTL policy.
 *
 * Cache keys are content-addressed (hashed from toolName +
 * resolved arguments — see buildKey), so a birth-profile edit
 * naturally produces a different key rather than needing
 * explicit invalidation: the old entry is simply never looked
 * up again and expires on its own.
 *
 * Almost every tool is a pure function of its explicit
 * date/time arguments (a chart for a given birth
 * date/time/place never changes), so those get a long TTL.
 * Tools whose name implies "as of right now" (e.g.
 * `current_vdasha`) can return a different answer for the
 * exact same birth details as time passes even though "now"
 * isn't an explicit argument, so they get a short TTL instead.
 * This is a conservative, name-based heuristic — worst case it
 * under-caches a tool that's actually fully deterministic
 * (extra cache misses, never wrong data).
 * ------------------------------------------------------------
 */
const DETERMINISTIC_TTL_SECONDS =
  60 * 60 * 24 * 30; // 30 days

const TIME_RELATIVE_TTL_SECONDS =
  60 * 60; // 1 hour

const TIME_RELATIVE_NAME_PATTERN =
  /current/i;

export function resolveCacheTtlSeconds(
  toolName: string
): number {
  return TIME_RELATIVE_NAME_PATTERN.test(
    toolName
  )
    ? TIME_RELATIVE_TTL_SECONDS
    : DETERMINISTIC_TTL_SECONDS;
}

export class McpCache {
  private readonly prefix =
    "astrology:mcp:";

  constructor(
    private readonly redis:
      RedisDatabase
  ) {}

  async get<T>(
    input: McpCacheInput
  ): Promise<T | null> {
    const key =
      this.buildKey(input);

    const value =
      await this.redis
        .getClient()
        .get(key);

    if (!value) {
      return null;
    }

    return JSON.parse(
      value
    ) as T;
  }

  async set<T>(
    input: McpCacheInput,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    const key =
      this.buildKey(input);

    await this.redis
      .getClient()
      .set(
        key,
        JSON.stringify(value),
        "EX",
        ttlSeconds ??
          resolveCacheTtlSeconds(
            input.toolName
          )
      );
  }

  async delete(
    input: McpCacheInput
  ): Promise<void> {
    const key =
      this.buildKey(input);

    await this.redis
      .getClient()
      .del(key);
  }

  private buildKey(
    input: McpCacheInput
  ): string {
    const payload =
      JSON.stringify({
        toolName:
          input.toolName,

        arguments:
          input.arguments,
      });

    const hash =
      createHash("sha256")
        .update(payload)
        .digest("hex");

    return `${this.prefix}${input.toolName}:${hash}`;
  }
}