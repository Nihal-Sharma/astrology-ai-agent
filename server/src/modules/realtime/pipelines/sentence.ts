const SENTENCE_END_PATTERN =
  /[.!?](?=\s|$)/;

const MIN_SENTENCE_LENGTH = 2;

/**
 * Pulls the first complete sentence off the front of a
 * streaming text buffer, for speculative/partial TTS: start
 * synthesizing what's ready instead of waiting for the whole
 * reply. Imperfect on abbreviations ("Mr. Smith") — acceptable
 * for spoken delivery, where a slightly-early split just reads
 * as a short pause.
 */
export function popReadySentence(
  buffer: string
):
  | {
      sentence: string;
      remainder: string;
    }
  | null {
  const match =
    SENTENCE_END_PATTERN.exec(
      buffer
    );

  if (!match) {
    return null;
  }

  const endIndex =
    match.index + match[0].length;

  const sentence = buffer
    .slice(0, endIndex)
    .trim();

  const remainder = buffer
    .slice(endIndex)
    .trimStart();

  if (
    sentence.length <
    MIN_SENTENCE_LENGTH
  ) {
    return null;
  }

  return { sentence, remainder };
}
