import {
  spawn,
} from "node:child_process";

import ffmpegPath from "ffmpeg-static";

/**
 * Live API sample rate requirement (confirmed live, see ROADMAP.md's
 * Phase D) — realtime audio INPUT must be 16-bit PCM, mono, exactly
 * this rate. Anything else is silently ignored (no error, no reply).
 */
export const LIVE_INPUT_SAMPLE_RATE_HZ = 16000;

/**
 * Decodes any ffmpeg-readable container (the app sends `.m4a` — see
 * `audio:start {format:"m4a"}` in realtime.gateway.ts) into headerless
 * 16-bit little-endian PCM at `LIVE_INPUT_SAMPLE_RATE_HZ`, mono —
 * exactly what `LiveSession.sendAudioChunk` needs. Necessary because,
 * confirmed live, the Live API's realtime input does NOT decode
 * containers itself (unlike the regular `generateContent` endpoint
 * Free/Gold send raw `.m4a` bytes to directly) — only
 * `sendRealtimeInput` accepts audio at all, and it requires raw PCM.
 *
 * Spawns ffmpeg reading from stdin, writing raw PCM to stdout — no
 * temp files.
 */
export function decodeToPcm16(
  input: Buffer
): Promise<Buffer> {
  return new Promise(
    (resolve, reject) => {
      if (!ffmpegPath) {
        reject(
          new Error(
            "ffmpeg-static did not resolve a binary path for this platform"
          )
        );
        return;
      }

      const ffmpeg = spawn(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          "pipe:0",
          "-f",
          "s16le",
          "-ac",
          "1",
          "-ar",
          String(
            LIVE_INPUT_SAMPLE_RATE_HZ
          ),
          "pipe:1",
        ]
      );

      const outChunks: Buffer[] =
        [];

      const errChunks: Buffer[] =
        [];

      ffmpeg.stdout.on(
        "data",
        (chunk: Buffer) => {
          outChunks.push(chunk);
        }
      );

      ffmpeg.stderr.on(
        "data",
        (chunk: Buffer) => {
          errChunks.push(chunk);
        }
      );

      ffmpeg.on(
        "error",
        reject
      );

      ffmpeg.on(
        "close",
        (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `ffmpeg exited with code ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
              )
            );
            return;
          }

          resolve(
            Buffer.concat(
              outChunks
            )
          );
        }
      );

      ffmpeg.stdin.end(input);
    }
  );
}
