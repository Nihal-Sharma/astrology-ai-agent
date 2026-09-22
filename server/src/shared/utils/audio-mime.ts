/**
 * Maps our internal `SttAudioFormat`-ish strings (what the client
 * sends in `audio:start {format}`) to a real audio MIME type — used
 * anywhere raw audio bytes get attached to a Gemini call (STT via
 * Files API, or inline on a multimodal `generateContent` call for
 * the Gold-tier pipeline's combined transcribe+plan call). Shared
 * so both call sites can't drift out of sync on what a given format
 * string maps to.
 */
const MIME_TYPE_BY_FORMAT: Record<
  string,
  string
> = {
  wav: "audio/wav",
  mp3: "audio/mp3",
  m4a: "audio/m4a",
  webm: "audio/webm",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "audio/mp4",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
};

const DEFAULT_MIME_TYPE = "audio/wav";

export function resolveAudioMimeType(
  format?: string
): string {
  return (
    MIME_TYPE_BY_FORMAT[
      format ?? "wav"
    ] ?? DEFAULT_MIME_TYPE
  );
}
