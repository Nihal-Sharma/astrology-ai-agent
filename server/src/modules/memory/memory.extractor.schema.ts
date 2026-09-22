import { z } from "zod";

export const extractedMemoryCategorySchema = z.enum([
  "identity",
  "preference",
  "relationship",
  "life_event",
  "recurring_topic",
  "other",
]);

export const memoryExtractionSchema = z.object({
  facts: z.array(
    z.object({
      fact: z.string().min(1),

      category: extractedMemoryCategorySchema,

      importance: z.number().min(1).max(5),
    })
  ),
});

export type ExtractedMemoryCategory = z.infer<
  typeof extractedMemoryCategorySchema
>;

export type MemoryExtractionResult = z.infer<
  typeof memoryExtractionSchema
>;

export type ExtractedFact =
  MemoryExtractionResult["facts"][number];
