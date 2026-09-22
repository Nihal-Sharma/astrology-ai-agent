/**
 * Script-based check backing the product's "English or Hindi
 * only" constraint (see `buildResponseSystemPrompt`'s language
 * rule). Neither OpenAI's STT nor TTS offers a hard multi-
 * language allowlist — STT's `language` option only biases
 * toward ONE language (not a set), and TTS just speaks whatever
 * text it's given — so this Unicode-range check is the actual
 * enforcement point: applied to transcribed speech before it
 * reaches the agent, and to each synthesized sentence before it
 * reaches TTS. See RealtimeService.
 */

const LATIN_LETTER =
  /[A-Za-zÀ-ɏ]/;

const DEVANAGARI_LETTER =
  /[ऀ-ॿ]/;

const ANY_LETTER = /\p{L}/u;

/**
 * True if `text` is (almost) entirely Latin-script (English,
 * or Hindi written in Latin/"Hinglish") and/or Devanagari-script
 * (Hindi) letters. A small tolerance (15%) allows the occasional
 * stray character — a proper noun, a transcription artifact —
 * without rejecting genuine English/Hindi content, while still
 * catching text that's predominantly a different script
 * entirely (Urdu, Arabic, Chinese, Tamil, ...).
 */
export function isEnglishOrHindi(
  text: string
): boolean {
  const letters =
    text.match(
      new RegExp(ANY_LETTER, "gu")
    ) ?? [];

  if (letters.length === 0) {
    return true;
  }

  const disallowedCount = letters.filter(
    (char) =>
      !LATIN_LETTER.test(char) &&
      !DEVANAGARI_LETTER.test(char)
  ).length;

  return (
    disallowedCount / letters.length <=
    0.15
  );
}

/**
 * True if `text` is already (almost) entirely Devanagari —
 * used to skip a needless translation call for a transcript
 * that's already Hindi. Latin-script text (English, or Hindi
 * written as "Hinglish") is NOT considered Hindi here on
 * purpose — the display-translation feature this backs is
 * meant to normalize Hinglish into proper Devanagari too, not
 * just leave it as-is.
 */
export function isHindiScript(
  text: string
): boolean {
  const letters =
    text.match(
      new RegExp(ANY_LETTER, "gu")
    ) ?? [];

  if (letters.length === 0) {
    return true;
  }

  const nonDevanagariCount =
    letters.filter(
      (char) =>
        !DEVANAGARI_LETTER.test(char)
    ).length;

  return (
    nonDevanagariCount / letters.length <=
    0.15
  );
}
