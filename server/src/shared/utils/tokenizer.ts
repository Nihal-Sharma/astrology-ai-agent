import {
  countTokens as countTokensO200k,
  encode,
  decode,
} from "gpt-tokenizer";

/**
 * Uses the o200k_base encoding (GPT-4o / GPT-5 family).
 * Good enough as a budgeting signal even if the configured
 * model differs slightly in tokenizer — we only need this to
 * be consistent, not byte-exact with the provider's billing.
 */
export function countTokens(text: string): number {
  if (!text) {
    return 0;
  }

  return countTokensO200k(text);
}

/**
 * Hard-truncates text to fit within maxTokens, appending a
 * marker so the model knows content was cut off.
 */
export function capTokens(
  text: string,
  maxTokens: number
): string {
  if (maxTokens <= 0) {
    return "";
  }

  const tokens = encode(text);

  if (tokens.length <= maxTokens) {
    return text;
  }

  const truncationMarker = "\n…(truncated)";
  const markerTokens = countTokens(truncationMarker);
  const keepTokens = Math.max(0, maxTokens - markerTokens);

  return (
    decode(tokens.slice(0, keepTokens)) +
    truncationMarker
  );
}
