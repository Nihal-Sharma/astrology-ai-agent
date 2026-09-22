import { describe, expect, it } from "vitest";

import { resolveAudioMimeType } from "../../src/shared/utils/audio-mime";

describe("resolveAudioMimeType", () => {
  it("maps m4a — what the app actually records and sends", () => {
    expect(resolveAudioMimeType("m4a")).toBe(
      "audio/m4a"
    );
  });

  it("maps every other known format", () => {
    expect(resolveAudioMimeType("wav")).toBe(
      "audio/wav"
    );
    expect(resolveAudioMimeType("mp3")).toBe(
      "audio/mp3"
    );
    expect(resolveAudioMimeType("webm")).toBe(
      "audio/webm"
    );
    expect(resolveAudioMimeType("ogg")).toBe(
      "audio/ogg"
    );
    expect(resolveAudioMimeType("flac")).toBe(
      "audio/flac"
    );
    expect(resolveAudioMimeType("mp4")).toBe(
      "audio/mp4"
    );
    expect(resolveAudioMimeType("mpeg")).toBe(
      "audio/mpeg"
    );
    expect(resolveAudioMimeType("mpga")).toBe(
      "audio/mpeg"
    );
  });

  it("defaults to audio/wav when format is omitted", () => {
    expect(resolveAudioMimeType(undefined)).toBe(
      "audio/wav"
    );
  });

  it("falls back to audio/wav for an unrecognized format rather than throwing", () => {
    expect(
      resolveAudioMimeType("made-up-format")
    ).toBe("audio/wav");
  });
});
