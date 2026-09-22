/**
 * Strips a markdown code fence (```json ... ``` or bare ``` ...
 * ```) from around an LLM's text output, if present — a no-op
 * otherwise. Every structured-output caller (PlannerService,
 * MemoryExtractor, ConversationSummarizer) prompts for "only JSON"
 * but still needs this: Gemini (unlike OpenAI's Responses API,
 * which was what these call sites were originally written/tested
 * against) routinely wraps JSON responses in a fence regardless of
 * the prompt — confirmed live via a real "Unexpected token '`'"
 * JSON.parse failure on gemini-3.8-flash's memory-extraction
 * output. Apply this before JSON.parse rather than switching to a
 * provider-side structured-output mode, since that would need
 * per-provider schema translation this codebase doesn't have yet.
 */
export function stripJsonCodeFence(
  text: string
): string {
  const trimmed = text.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const withoutOpeningFence =
    trimmed.replace(
      /^```[a-zA-Z]*\s*\n?/,
      ""
    );

  const withoutClosingFence =
    withoutOpeningFence.replace(
      /\n?```\s*$/,
      ""
    );

  return withoutClosingFence.trim();
}
