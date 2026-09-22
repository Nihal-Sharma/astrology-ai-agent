import { z } from "zod";

/*
 * No free-text "reasoning" field on purpose — this call is fully
 * non-streaming and blocks the entire turn (response + TTS) until
 * it returns, so every extra token the model has to write directly
 * adds to time-to-first-audio. A prior version asked the model to
 * explain itself in a `reasoning` string, but nothing downstream
 * ever read it — pure latency cost for an unused field.
 */
export const agentPlanSchema = z.object({
  responseMode: z.enum([
    "direct",
    "mcp",
    "rag",
    "mcp_rag",
  ]),

  personaMode: z.enum([
    "companion",
    "astrologer",
    "blended",
  ]),

  /*
   * Optional, and absent from most calls: only present when this
   * planner call was given audio input directly instead of
   * already-transcribed text (the Gold-tier pipeline, ROADMAP.md's
   * Phase C — see PlannerService.createPlan). Exactly what the
   * model heard, not a translation or paraphrase.
   */
  transcript: z
    .string()
    .min(1)
    .optional(),

  /*
   * Every field below `required` is a detail that only actually
   * matters when `required` is true — `.default(...)` on all of
   * them rather than requiring the model to always spell them out.
   * `topK: 0`/empty arrays were already known to need this (a real
   * bug found live); a Gold-tier (audio-input) call surfaced the
   * same pattern across every other detail field too — the model
   * correctly decides `required: false` and then doesn't bother
   * filling in now-irrelevant details, which a strict schema
   * rejected outright as malformed output instead of the harmless
   * "nothing to see here" it actually is.
   */
  mcp: z.object({
    required: z.boolean(),

    tools: z
      .array(z.string().min(1))
      .default([]),

    parallel: z
      .boolean()
      .default(false),

    targetDate: z
      .string()
      .nullable()
      .default(null),

    targetRangeDays: z
      .number()
      .int()
      .min(1)
      .max(90)
      .nullable()
      .default(null),
  }),

  rag: z.object({
    required: z.boolean(),

    queries: z
      .array(z.string().min(1))
      .default([]),

    topK: z
      .number()
      .int()
      .min(0)
      .max(10)
      .default(0),
  }),

  memory: z.object({
    required: z.boolean(),

    queries: z
      .array(z.string().min(1))
      .default([]),

    topK: z
      .number()
      .int()
      .min(0)
      .max(10)
      .default(0),
  }),
});

export type AgentPlanInput = z.infer<typeof agentPlanSchema>;