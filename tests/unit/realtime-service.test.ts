import { describe, expect, it } from "vitest";

import {
  popReadySentence,
  RealtimeService,
} from "../../src/modules/realtime/realtime.service";

describe("popReadySentence", () => {
  it("returns null when there is no sentence-ending punctuation yet", () => {
    expect(popReadySentence("The sun in Gemini")).toBeNull();
  });

  it("pops a simple sentence ending in a period", () => {
    const result = popReadySentence(
      "Your sun is in Gemini. The rest is still streaming"
    );
    expect(result?.sentence).toBe("Your sun is in Gemini.");
    expect(result?.remainder).toBe("The rest is still streaming");
  });

  it("pops a sentence ending in a question mark", () => {
    const result = popReadySentence(
      "Are you asking about your sun sign? More text follows"
    );
    expect(result?.sentence).toBe(
      "Are you asking about your sun sign?"
    );
  });

  it("pops a sentence ending in an exclamation mark", () => {
    const result = popReadySentence(
      "What a exciting placement! Here's why"
    );
    expect(result?.sentence).toBe("What a exciting placement!");
  });

  it("handles a sentence that ends exactly at the buffer end", () => {
    const result = popReadySentence("This is complete.");
    expect(result?.sentence).toBe("This is complete.");
    expect(result?.remainder).toBe("");
  });

  it("skips a too-short fragment (below MIN_SENTENCE_LENGTH) and waits for more text", () => {
    // "Hi." is short but still >= 2 chars, exercised for the
    // opposite edge: a single trailing punctuation mark alone.
    expect(popReadySentence(".")).toBeNull();
  });
});

describe("RealtimeService rate limiting", () => {
  function makeService(chatMaxPerMinute: number) {
    const noopLogger = {
      debug() {},
      error() {},
      info() {},
      warn() {},
    } as any;

    return new RealtimeService(
      {} as any,
      {} as any,
      {} as any,
      noopLogger,
      chatMaxPerMinute
    );
  }

  it("allows up to the configured limit, then blocks further turns in the same window", () => {
    const service = makeService(3);
    const checkRateLimit = (
      service as unknown as {
        checkRateLimit(userId: string): boolean;
      }
    ).checkRateLimit.bind(service);

    const results = Array.from({ length: 5 }, () =>
      checkRateLimit("user-a")
    );

    expect(results).toEqual([true, true, true, false, false]);
  });

  it("tracks separate users independently", () => {
    const service = makeService(1);
    const checkRateLimit = (
      service as unknown as {
        checkRateLimit(userId: string): boolean;
      }
    ).checkRateLimit.bind(service);

    expect(checkRateLimit("user-a")).toBe(true);
    expect(checkRateLimit("user-a")).toBe(false);
    expect(checkRateLimit("user-b")).toBe(true);
  });
});
