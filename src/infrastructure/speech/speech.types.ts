export type SttAudioFormat =
  | "wav"
  | "mp3"
  | "m4a"
  | "webm"
  | "ogg"
  | "flac"
  | "mp4"
  | "mpeg"
  | "mpga";

export interface STTOptions {
  language?: string;

  sampleRate?: number;

  /**
   * Container format of the audio buffer — required for OpenAI to
   * decode it correctly (raw PCM has no self-describing header).
   * Defaults to "wav".
   */
  format?: SttAudioFormat;

  /**
   * Optional text to bias transcription style/vocabulary (e.g.
   * astrology terms, proper nouns) — passed through as the
   * provider's `prompt`.
   */
  prompt?: string;
}

export interface STTStreamEvent {
  type:
    | "transcript_delta"
    | "completed"
    | "error";

  /** Incremental text for "transcript_delta", full text for "completed". */
  text?: string;

  error?: Error;
}

export type TtsAudioFormat =
  | "mp3"
  | "opus"
  | "aac"
  | "flac"
  | "wav"
  | "pcm";

export interface TTSOptions {
  voice?: string;

  speed?: number;

  /**
   * Output container format. Defaults to "mp3" (broadly
   * playable). "pcm" has the least encoding overhead if the
   * client can play raw audio directly.
   */
  format?: TtsAudioFormat;

  /**
   * Style/delivery guidance (e.g. "warm and reassuring") — only
   * supported by gpt-4o-mini-tts, not tts-1/tts-1-hd.
   */
  instructions?: string;
}

export interface VadOptions {
  /**
   * Sample rate (Hz) of the PCM frames passed in — needed to
   * convert frame byte length into a duration, so hangover
   * timing is correct regardless of how the caller chunks
   * audio. Defaults to 24000 (OpenAI's PCM TTS/STT output
   * rate).
   */
  sampleRate?: number;

  /**
   * Absolute RMS floor (0-1) below which a frame is never
   * classified as speech, regardless of the adaptive noise
   * floor — guards against false positives while that floor is
   * still settling (e.g. right at stream start).
   */
  minSpeechThreshold?: number;

  /**
   * Milliseconds of continuous silence required before
   * declaring an utterance ended — avoids cutting off
   * mid-sentence on an ordinary pause between words. Time-based
   * rather than a frame count, since frame duration depends on
   * sample rate and how the caller chunks audio.
   */
  hangoverMs?: number;
}

export type VadEvent =
  | { type: "speech_start" }
  | { type: "speech_end" };

export interface TTSStreamChunk {
  type:
    | "audio_chunk"
    | "completed"
    | "error";

  /** Raw audio bytes for "audio_chunk". */
  audio?: Buffer;

  error?: Error;
}
