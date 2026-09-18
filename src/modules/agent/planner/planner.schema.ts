import { z } from "zod";

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

  reasoning: z.string().min(1),

  mcp: z.object({
    required: z.boolean(),

    tools: z.array(
      z.string().min(1)
    ),

    parallel: z.boolean(),

    targetDate: z
      .string()
      .nullable(),

    targetRangeDays: z
      .number()
      .int()
      .min(1)
      .max(90)
      .nullable(),
  }),

  rag: z.object({
    required: z.boolean(),

    queries: z.array(
      z.string().min(1)
    ),

    /*
     * 0 is valid — the model naturally returns it when
     * required is false ("not applicable"), not just 1-10.
     */
    topK: z
      .number()
      .int()
      .min(0)
      .max(10),
  }),

  memory: z.object({
    required: z.boolean(),

    queries: z.array(
      z.string().min(1)
    ),

    topK: z
      .number()
      .int()
      .min(0)
      .max(10),
  }),
});

export type AgentPlanInput = z.infer<typeof agentPlanSchema>;