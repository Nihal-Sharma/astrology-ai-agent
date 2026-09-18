import { describe, expect, it } from "vitest";

import { agentPlanSchema } from "../../src/modules/agent/planner/planner.schema";

function validPlan(
  overrides: Record<string, unknown> = {}
) {
  return {
    responseMode: "direct",
    personaMode: "blended",
    reasoning: "Casual greeting, no calculation needed.",
    mcp: {
      required: false,
      tools: [],
      parallel: false,
      targetDate: null,
      targetRangeDays: null,
    },
    rag: {
      required: false,
      queries: [],
      topK: 0,
    },
    memory: {
      required: false,
      queries: [],
      topK: 0,
    },
    ...overrides,
  };
}

describe("agentPlanSchema", () => {
  it("accepts a well-formed direct-mode plan", () => {
    const result = agentPlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
  });

  it("accepts topK: 0 even when a tool is not required — this was a real bug found live (§2)", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({
        rag: { required: false, queries: [], topK: 0 },
        memory: { required: false, queries: [], topK: 0 },
      })
    );
    expect(result.success).toBe(true);
  });

  it("rejects an invalid responseMode, including the real 'memory' value the model once invented (§4)", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({ responseMode: "memory" })
    );
    expect(result.success).toBe(false);
  });

  it("rejects an invalid personaMode", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({ personaMode: "sarcastic" })
    );
    expect(result.success).toBe(false);
  });

  it("rejects a topK above the max", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({ rag: { required: true, queries: ["x"], topK: 11 } })
    );
    expect(result.success).toBe(false);
  });

  it("rejects a negative topK", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({ memory: { required: true, queries: ["x"], topK: -1 } })
    );
    expect(result.success).toBe(false);
  });

  it("rejects a targetRangeDays of 0 (must be >= 1 or null)", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({
        mcp: {
          required: true,
          tools: ["natal_transits_weekly"],
          parallel: false,
          targetDate: "2026-01-01",
          targetRangeDays: 0,
        },
      })
    );
    expect(result.success).toBe(false);
  });

  it("accepts a null targetDate/targetRangeDays for ordinary natal-chart questions", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({
        mcp: {
          required: true,
          tools: ["planets"],
          parallel: false,
          targetDate: null,
          targetRangeDays: null,
        },
      })
    );
    expect(result.success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const plan = validPlan() as Record<string, unknown>;
    delete plan.reasoning;
    const result = agentPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects an empty reasoning string", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({ reasoning: "" })
    );
    expect(result.success).toBe(false);
  });
});
