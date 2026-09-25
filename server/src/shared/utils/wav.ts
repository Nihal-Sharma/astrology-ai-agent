const PCM_BITS_PER_SAMPLE = 16;

/**
 * Prepends a standard 44-byte RIFF/WAVE header to raw 16-bit PCM
 * data — turns headerless PCM (what Gemini's TTS and Live APIs both
 * return) into a normal, independently-playable .wav file. Needs
 * the full PCM length upfront (the header's data-size field), so
 * callers must buffer the complete clip before wrapping rather than
 * wrapping and sending fragments as they arrive.
 *
 * Shared by `GeminiTtsClient` (per-sentence synthesis) and
 * `DiamondVoicePipeline` (per-turn Live audio) — same header logic,
 * different callers, extracted here so a fix applies to both.
 */
export function wrapPcmAsWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number
): Buffer {
  const blockAlign =
    channels *
    (PCM_BITS_PER_SAMPLE / 8);

  const byteRate =
    sampleRate * blockAlign;

  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(
    36 + pcm.length,
    4
  );
  header.write("WAVE", 8, "ascii");

  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(
    channels,
    22
  );
  header.writeUInt32LE(
    sampleRate,
    24
  );
  header.writeUInt32LE(
    byteRate,
    28
  );
  header.writeUInt16LE(
    blockAlign,
    32
  );
  header.writeUInt16LE(
    PCM_BITS_PER_SAMPLE,
    34
  );

  header.write("data", 36, "ascii");
  header.writeUInt32LE(
    pcm.length,
    40
  );

  return Buffer.concat([
    header,
    pcm,
  ]);
}
