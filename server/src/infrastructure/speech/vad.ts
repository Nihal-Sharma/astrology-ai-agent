import {
  VadEvent,
  VadOptions,
} from "./speech.types";

/*
 * ------------------------------------------------------------
 * Energy-based VAD.
 *
 * Not a neural model (e.g. Silero VAD) — a lightweight,
 * dependency-free technique: RMS energy per frame against an
 * adaptively-tracked noise floor, with hangover/hysteresis so
 * a brief pause mid-sentence doesn't register as end-of-speech.
 * This is the same family of technique WebRTC's own simplest
 * VAD mode uses, not a placeholder.
 *
 * A neural VAD (Silero, via onnxruntime) would be more robust
 * in noisy environments, at the cost of a native binary
 * dependency and a bundled model file — worth revisiting once
 * there's a real audio pipeline to tune thresholds against.
 * ------------------------------------------------------------
 */

const DEFAULT_SAMPLE_RATE = 24000;

const DEFAULT_MIN_THRESHOLD = 0.01;

/**
 * Silence this long before declaring an utterance ended.
 * Ordinary pauses between words/phrases in real speech are
 * typically well under this — testing against real generated
 * speech (not just silence) is what caught the original,
 * too-short value: a frame-count-based hangover with no notion
 * of real time was firing false "speech_end" events mid-
 * sentence, on ordinary pauses between words.
 */
const DEFAULT_HANGOVER_MS = 500;

/**
 * A frame must be this many times louder than the tracked
 * noise floor to count as speech.
 */
const SPEECH_MULTIPLIER = 2.5;

/**
 * Exponential-moving-average smoothing factor for the noise
 * floor — small, so it adapts slowly and isn't thrown off by
 * one loud silent-frame outlier (a cough, a door closing).
 */
const NOISE_FLOOR_SMOOTHING = 0.05;

export class VoiceActivityDetector {
  private noiseFloor = 0;

  private speaking = false;

  private silentDurationMs = 0;

  private readonly sampleRate: number;

  private readonly hangoverMs: number;

  private readonly minThreshold: number;

  constructor(
    options?: VadOptions
  ) {
    this.sampleRate =
      options?.sampleRate ??
      DEFAULT_SAMPLE_RATE;

    this.hangoverMs =
      options?.hangoverMs ??
      DEFAULT_HANGOVER_MS;

    this.minThreshold =
      options
        ?.minSpeechThreshold ??
      DEFAULT_MIN_THRESHOLD;
  }

  /**
   * Per-frame speech/silence classification for 16-bit signed
   * little-endian PCM (mono). Stateless from the caller's
   * perspective, but internally adapts its noise floor, so
   * repeated calls on a stream track the current environment
   * rather than using one fixed threshold forever.
   */
  isSpeech(
    audioFrame: Buffer
  ): boolean {
    if (audioFrame.length < 2) {
      return false;
    }

    const rms =
      this.computeRms(audioFrame);

    const dynamicThreshold =
      Math.max(
        this.minThreshold,
        this.noiseFloor *
          SPEECH_MULTIPLIER
      );

    const speechFrame =
      rms > dynamicThreshold;

    if (!speechFrame) {
      /*
       * Only adapt the noise floor during silence, so a
       * sustained loud voice never drags the threshold up to
       * match it (which would make the detector go deaf
       * partway through an utterance).
       */
      this.noiseFloor =
        this.noiseFloor === 0
          ? rms
          : this.noiseFloor *
              (1 -
                NOISE_FLOOR_SMOOTHING) +
            rms *
              NOISE_FLOOR_SMOOTHING;
    }

    return speechFrame;
  }

  /**
   * Stateful utterance tracking for barge-in / end-of-utterance:
   * feed sequential frames from a live stream, get told only
   * when speech starts, or ends (after `hangoverMs` of
   * continuous silence — not on the first silent frame, so an
   * ordinary pause between words doesn't chop the utterance).
   */
  processFrame(
    audioFrame: Buffer
  ): VadEvent | null {
    const speechFrame =
      this.isSpeech(audioFrame);

    if (speechFrame) {
      this.silentDurationMs = 0;

      if (!this.speaking) {
        this.speaking = true;

        return {
          type: "speech_start",
        };
      }

      return null;
    }

    if (!this.speaking) {
      return null;
    }

    this.silentDurationMs +=
      this.frameDurationMs(
        audioFrame
      );

    if (
      this.silentDurationMs >=
      this.hangoverMs
    ) {
      this.speaking = false;
      this.silentDurationMs = 0;

      return {
        type: "speech_end",
      };
    }

    return null;
  }

  /**
   * Clears all tracked state — call between sessions/turns so
   * a new utterance doesn't inherit a stale noise floor.
   */
  reset(): void {
    this.noiseFloor = 0;
    this.speaking = false;
    this.silentDurationMs = 0;
  }

  private frameDurationMs(
    audioFrame: Buffer
  ): number {
    const sampleCount = Math.floor(
      audioFrame.length / 2
    );

    return (
      (sampleCount /
        this.sampleRate) *
      1000
    );
  }

  private computeRms(
    audioFrame: Buffer
  ): number {
    const sampleCount = Math.floor(
      audioFrame.length / 2
    );

    if (sampleCount === 0) {
      return 0;
    }

    let sumSquares = 0;

    for (
      let index = 0;
      index < sampleCount;
      index += 1
    ) {
      const sample =
        audioFrame.readInt16LE(
          index * 2
        ) / 32768;

      sumSquares +=
        sample * sample;
    }

    return Math.sqrt(
      sumSquares / sampleCount
    );
  }
}
