import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LIVE_INPUT_SAMPLE_RATE_HZ,
  decodeToPcm16,
} from "../../src/shared/utils/audio-transcode";

import { wrapPcmAsWav } from "../../src/shared/utils/wav";

/**
 * Real ffmpeg (the `ffmpeg-static` binary) — no mock. The whole
 * point of this module is a contract with an external process, so
 * a fake would only test the fake.
 */

/** One second of a 440Hz sine, 16-bit little-endian PCM. */
function sinePcm(
  sampleRate: number,
  channels: number,
  seconds = 1
): Buffer {
  const frames = Math.round(sampleRate * seconds);
  const pcm = Buffer.alloc(frames * channels * 2);

  for (let i = 0; i < frames; i += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000
    );

    for (let c = 0; c < channels; c += 1) {
      pcm.writeInt16LE(sample, (i * channels + c) * 2);
    }
  }

  return pcm;
}

function peakAmplitude(pcm: Buffer): number {
  let peak = 0;

  for (let i = 0; i + 1 < pcm.length; i += 2) {
    peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  }

  return peak;
}

describe("decodeToPcm16", () => {
  it("targets the 16kHz rate the Live API requires", () => {
    expect(LIVE_INPUT_SAMPLE_RATE_HZ).toBe(16000);
  });

  it("resamples 24kHz mono WAV to 16kHz 16-bit PCM without a header", async () => {
    const wav = wrapPcmAsWav(sinePcm(24000, 1), 24000, 1);

    const out = await decodeToPcm16(wav);

    // 1s @ 16kHz mono, 2 bytes/sample = 32000 bytes. Allow a few
    // samples of slack for the resampler's edge handling.
    expect(out.length).toBeGreaterThan(31000);
    expect(out.length).toBeLessThan(33000);
    expect(out.length % 2).toBe(0);

    // Not a WAV/RIFF container anymore — headerless PCM.
    expect(out.toString("ascii", 0, 4)).not.toBe("RIFF");

    // Audio survived, not silence.
    expect(peakAmplitude(out)).toBeGreaterThan(5000);
  });

  it("downmixes stereo and resamples 44.1kHz to 16kHz mono", async () => {
    const wav = wrapPcmAsWav(sinePcm(44100, 2), 44100, 2);

    const out = await decodeToPcm16(wav);

    expect(out.length).toBeGreaterThan(31000);
    expect(out.length).toBeLessThan(33000);
    expect(peakAmplitude(out)).toBeGreaterThan(5000);
  });

  it("rejects, with ffmpeg's own stderr, on data that isn't audio", async () => {
    await expect(
      decodeToPcm16(randomBytes(100))
    ).rejects.toThrow(/ffmpeg exited with code/);
  });

  it("rejects — without crashing the process — on a large non-audio upload", async () => {
    /*
     * Regression: ffmpeg rejects garbage before reading all of
     * stdin, the pending write then emits EPIPE/EOF on `stdin`, and
     * with no handler that became an uncaught exception —
     * `server.ts` turns those into `process.exit(1)`, so one bad
     * upload would have taken the whole server down. If this ever
     * regresses, vitest reports the uncaught error and fails the run.
     */
    await expect(
      decodeToPcm16(randomBytes(8_000_000))
    ).rejects.toThrow(/ffmpeg exited with code/);

    // Let any straggling stdin error surface before the test ends.
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
});
