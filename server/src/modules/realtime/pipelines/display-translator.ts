import {
  LlmClient,
} from "../../../infrastructure/llm";

import {
  AppLogger,
} from "../../../infrastructure/observability/logger";

import {
  isHindiScript,
} from "../../../shared/utils/language";

/**
 * Translates a transcript into Hindi (Devanagari) purely for what
 * the app displays as "You said: ..." — STT itself is left
 * unrestricted (any language), so the raw transcript can come back
 * in anything; this normalizes the *display* to Hindi regardless,
 * including Hinglish (Hindi in Latin script) getting converted to
 * proper Devanagari. The turn itself still runs on the original,
 * untranslated transcript — this never touches what the agent
 * actually sees. Shared by every voice pipeline (Free/Gold) so
 * there's exactly one implementation of this behavior.
 */
export class DisplayTranslator {
  constructor(
    private readonly llmClient: LlmClient,

    /**
     * Model used for this specifically — a small helper call that
     * doesn't need the main agent model's reasoning depth. Keeping
     * it on the default model added 5-10s of pure model latency to
     * every non-Hindi voice turn.
     */
    private readonly displayTranslationModel: string,

    private readonly logger: AppLogger
  ) {}

  /**
   * Skips the call entirely when the transcript is already
   * Devanagari (the common case for a Hindi speaker), and falls
   * back to the original text if translation fails — a display
   * nicety is never worth failing the turn over.
   */
  async translateForDisplay(
    transcript: string
  ): Promise<string> {
    if (isHindiScript(transcript)) {
      return transcript;
    }

    try {
      const result =
        await this.llmClient.generate({
          model:
            this.displayTranslationModel,

          instructions:
            "Translate the user's message into Hindi, written in Devanagari script. Reply with ONLY the translation — no explanation, no quotes, no transliteration into Latin script.",

          messages: [
            {
              role: "user",
              content: transcript,
            },
          ],

          maxOutputTokens: 300,
        });

      return (
        result.text.trim() || transcript
      );
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          module: "realtime",
        },
        "Transcript display-translation to Hindi failed — showing the original"
      );

      return transcript;
    }
  }
}
