import { describe, expect, it } from "vitest";

import { formatDuration } from "../../src/shared/utils/duration";

describe("formatDuration", () => {
  it("renders sub-minute gaps as at least 1 minute", () => {
    expect(formatDuration(10_000)).toBe("1 minute");
  });

  it("renders minutes", () => {
    expect(formatDuration(5 * 60_000)).toBe("5 minutes");
  });

  it("renders hours", () => {
    expect(formatDuration(3 * 60 * 60_000)).toBe("3 hours");
  });

  it("renders singular hour without a trailing s", () => {
    expect(formatDuration(60 * 60_000)).toBe("1 hour");
  });

  it("renders days", () => {
    expect(formatDuration(2 * 24 * 60 * 60_000)).toBe("2 days");
  });

  it("renders months", () => {
    expect(formatDuration(60 * 24 * 60 * 60_000)).toBe("2 months");
  });

  it("renders years", () => {
    expect(formatDuration(400 * 24 * 60 * 60_000)).toBe("1 year");
  });
});
