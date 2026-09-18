import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import { MemoryConsolidator } from "../../src/modules/memory/memory.consolidator";
import { MemoryItem } from "../../src/modules/memory/memory.types";

function makeMemory(
  overrides: Partial<MemoryItem>
): MemoryItem {
  const now = new Date();

  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    fact: "The user's name is Test.",
    category: "identity",
    embedding: [1, 0, 0],
    importance: 1,
    referenceCount: 1,
    lastReferencedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("MemoryConsolidator.findDuplicate", () => {
  const consolidator = new MemoryConsolidator(0.88);

  it("finds a near-identical embedding above the threshold", () => {
    const existing = [makeMemory({ embedding: [1, 0, 0] })];
    const duplicate = consolidator.findDuplicate([0.99, 0.01, 0], existing);
    expect(duplicate).toBe(existing[0]);
  });

  it("returns null when nothing is similar enough", () => {
    const existing = [makeMemory({ embedding: [1, 0, 0] })];
    const duplicate = consolidator.findDuplicate([0, 1, 0], existing);
    expect(duplicate).toBeNull();
  });

  it("returns null for an empty existing set", () => {
    expect(consolidator.findDuplicate([1, 0, 0], [])).toBeNull();
  });

  it("picks the single best match when multiple are above threshold", () => {
    const closeButNotBest = makeMemory({ embedding: [0.9, 0.1, 0] });
    const best = makeMemory({ embedding: [1, 0, 0] });
    const duplicate = consolidator.findDuplicate(
      [1, 0, 0],
      [closeButNotBest, best]
    );
    expect(duplicate).toBe(best);
  });
});

describe("MemoryConsolidator.decayedImportance", () => {
  const consolidator = new MemoryConsolidator(0.88);

  it("returns the full importance for a just-referenced memory", () => {
    const now = new Date();
    const memory = makeMemory({ importance: 4, lastReferencedAt: now });
    expect(consolidator.decayedImportance(memory, now)).toBeCloseTo(4, 5);
  });

  it("halves importance after one half-life (60 days)", () => {
    const now = new Date();
    const sixtyDaysAgo = new Date(
      now.getTime() - 60 * 24 * 60 * 60 * 1000
    );
    const memory = makeMemory({
      importance: 4,
      lastReferencedAt: sixtyDaysAgo,
    });
    expect(consolidator.decayedImportance(memory, now)).toBeCloseTo(2, 1);
  });

  it("decays further after two half-lives (120 days)", () => {
    const now = new Date();
    const oneTwentyDaysAgo = new Date(
      now.getTime() - 120 * 24 * 60 * 60 * 1000
    );
    const memory = makeMemory({
      importance: 4,
      lastReferencedAt: oneTwentyDaysAgo,
    });
    expect(consolidator.decayedImportance(memory, now)).toBeCloseTo(1, 1);
  });

  it("never returns a negative value for a future lastReferencedAt", () => {
    const now = new Date();
    const future = new Date(now.getTime() + 60_000);
    const memory = makeMemory({ importance: 3, lastReferencedAt: future });
    expect(consolidator.decayedImportance(memory, now)).toBeCloseTo(3, 5);
  });
});
