import { describe, expect, it } from "vitest";

import { cosineSimilarity } from "../../src/shared/utils/vector";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it("is scale-invariant", () => {
    const a = cosineSimilarity([1, 2, 3], [2, 4, 6]);
    expect(a).toBeCloseTo(1, 10);
  });

  it("returns 0 for mismatched lengths instead of throwing", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for empty vectors instead of throwing", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 when one vector is all zeros (no division by zero)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});
