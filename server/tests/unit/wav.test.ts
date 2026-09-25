import { describe, expect, it } from "vitest";

import { wrapPcmAsWav } from "../../src/shared/utils/wav";

describe("wrapPcmAsWav", () => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

  it("prepends a 44-byte header and leaves the PCM payload untouched", () => {
    const wav = wrapPcmAsWav(pcm, 24000, 1);

    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
  });

  it("writes a valid RIFF/WAVE/fmt/data layout", () => {
    const wav = wrapPcmAsWav(pcm, 24000, 1);

    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.toString("ascii", 36, 40)).toBe("data");

    // RIFF chunk size = everything after the first 8 bytes.
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    // fmt chunk is 16 bytes, PCM (format tag 1).
    expect(wav.readUInt32LE(16)).toBe(16);
    expect(wav.readUInt16LE(20)).toBe(1);
    // data chunk size = the PCM length.
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
  });

  it("encodes sample rate, channels, byte rate, block align and bit depth for mono", () => {
    const wav = wrapPcmAsWav(pcm, 24000, 1);

    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(24000); // sample rate
    expect(wav.readUInt32LE(28)).toBe(24000 * 2); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
  });

  it("scales byte rate and block align with the channel count", () => {
    const wav = wrapPcmAsWav(pcm, 16000, 2);

    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(28)).toBe(16000 * 4);
    expect(wav.readUInt16LE(32)).toBe(4);
  });

  it("produces a header-only file for empty PCM", () => {
    const wav = wrapPcmAsWav(Buffer.alloc(0), 24000, 1);

    expect(wav.length).toBe(44);
    expect(wav.readUInt32LE(4)).toBe(36);
    expect(wav.readUInt32LE(40)).toBe(0);
  });
});
