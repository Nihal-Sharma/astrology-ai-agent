import { z } from "zod";

export const conversationSummarySchema = z.object({
  summary: z.string().min(1),

  currentTopic: z.string().nullable(),
});

export type ConversationSummaryResult = z.infer<
  typeof conversationSummarySchema
>;
