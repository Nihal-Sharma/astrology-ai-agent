import { describe, expect, it } from "vitest";

import { agentPlanSchema } from "../../src/modules/agent/planner/planner.schema";

function validPlan(
  overrides: Record<string, unknown> = {}
) {
  return {
    responseMode: "direct",
    personaMode: "blended",
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
    delete plan.responseMode;
    const result = agentPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("accepts a plan with no transcript field (the normal, text-input case)", () => {
    const result = agentPlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
    expect(result.data?.transcript).toBeUndefined();
  });

  it("accepts a plan with a transcript field (the Gold-tier audio-input case, §Phase C)", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({
        transcript: "What does my chart say about my career?",
      })
    );
    expect(result.success).toBe(true);
    expect(result.data?.transcript).toBe(
      "What does my chart say about my career?"
    );
  });

  it("rejects an empty transcript string", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({ transcript: "" })
    );
    expect(result.success).toBe(false);
  });

  it("defaults mcp/rag/memory detail fields when omitted entirely — a real bug found live on a Gold-tier (audio-input) call: the model correctly returned required:false for all three but omitted every detail key instead of the earlier topK:0-style placeholder, and the schema rejected it as malformed", () => {
    const result = agentPlanSchema.safeParse({
      responseMode: "direct",
      personaMode: "companion",
      mcp: { required: false },
      rag: { required: false },
      memory: { required: false },
    });

    expect(result.success).toBe(true);
    expect(result.data?.mcp).toEqual({
      required: false,
      tools: [],
      parallel: false,
      targetDate: null,
      targetRangeDays: null,
    });
    expect(result.data?.rag).toEqual({
      required: false,
      queries: [],
      topK: 0,
    });
    expect(result.data?.memory).toEqual({
      required: false,
      queries: [],
      topK: 0,
    });
  });

  it("still enforces detail-field validation when the fields ARE present (defaults don't weaken real validation)", () => {
    const result = agentPlanSchema.safeParse(
      validPlan({
        rag: { required: true, queries: ["x"], topK: 11 },
      })
    );

    expect(result.success).toBe(false);
  });
});
