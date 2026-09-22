import { useCallback, useEffect, useRef, useState } from "react";

import {
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

import { File, Paths } from "expo-file-system";

import { WS_BASE_URL } from "../config";
import { createConversation } from "../api/conversations";
import {
  ClientEventType,
  ServerEvent,
  TurnModePayload,
} from "./types";

export type VoiceStatus =
  | "connecting"
  | "ready"
  | "recording"
  | "processing"
  | "speaking"
  | "error";

function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/** See recordingStartedAtRef's doc comment. */
const MIN_RECORDING_MS = 700;

/** How long to wait before retrying after a dropped/failed connection. */
const RECONNECT_DELAY_MS = 10_000;

/*
 * Tried streaming the .m4a file up in periodic deltas while
 * recording (read whatever's flushed to disk, send just the new
 * bytes since the last read), on the assumption that the AAC/
 * MPEG4 encoder only appends and never rewrites earlier bytes
 * until `.stop()`'s finalize step. That assumption didn't hold in
 * practice — it produced OpenAI's "Audio file might be corrupted
 * or unsupported" error, meaning the finalize step (or the
 * reads racing a still-writing file) does something more than
 * pure append. Reverted to one full read-and-send after `.stop()`
 * (below), which is what's actually verified to produce a valid
 * file. Revisiting this would need either confirming the real
 * on-disk write behavior of this specific encoder, or switching
 * to a container that's safe to append (e.g. WAV/PCM) instead of
 * diffing a live AAC/M4A file.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function concatChunks(
  chunks: Uint8Array[]
): Uint8Array {
  const totalLength = chunks.reduce(
    (sum, chunk) => sum + chunk.length,
    0
  );

  const combined = new Uint8Array(
    totalLength
  );

  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}

interface UseVoiceSessionOptions {
  token: string;
  userId: string;
}

/**
 * Push-to-talk voice session over the server's `/ws` realtime
 * gateway — see server/src/modules/realtime and the "Realtime —
 * WebSocket" section of README.md for the full protocol this
 * mirrors.
 *
 * Recording: `expo-audio`'s HIGH_QUALITY preset (.m4a) — sent as
 * `audio:start {format:"m4a"}` + one binary frame + `audio:end`
 * once recording stops (see the comment above `delay`'s
 * declaration for why this isn't streamed progressively).
 *
 * Playback: the server frames its reply per sentence
 * (`audio:sentence_start`/binary frames/`audio:sentence_end` —
 * see the wire-format note in realtime.types.ts), so each
 * sentence is buffered separately and queued for playback as
 * soon as its `sentence_end` arrives — playback of the first
 * sentence starts while later sentences are still being
 * synthesized, instead of waiting for the whole reply.
 */
export function useVoiceSession({
  token,
  userId,
}: UseVoiceSessionOptions) {
  const [status, setStatus] = useState<VoiceStatus>(
    "connecting"
  );

  const [error, setError] = useState<string | null>(
    null
  );

  const [transcript, setTranscript] = useState<
    string | null
  >(null);

  const [turnMode, setTurnMode] =
    useState<TurnModePayload | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  /** Binary frames for the sentence currently streaming in. */
  const currentSentenceChunksRef = useRef<Uint8Array[]>(
    []
  );

  /** Fully-received sentence clips waiting their turn to play. */
  const playbackQueueRef = useRef<Uint8Array[]>([]);

  const isPlayingRef = useRef(false);

  /**
   * True once `audio:completed` has arrived for the turn
   * currently playing — the queue can still have segments left
   * to drain after this, so it's what tells the drain loop
   * there's nothing more coming once the queue empties.
   */
  const turnCompleteRef = useRef(false);

  /**
   * `onPressIn`/`onPressOut` don't wait for each other — a quick
   * tap, or a press-out that lands while the mic-permission
   * prompt is still up, can fire `stopRecording` before
   * `startRecording`'s async prepare/record has actually
   * finished. `recordingStateRef` + `startPromiseRef` serialize
   * them: `stopRecording` always waits for any in-flight start
   * to settle first, and only calls `audioRecorder.stop()` if a
   * `record()` call actually succeeded — otherwise the native
   * recorder ends up half-prepared and every call after that
   * fails too ("already prepared" / permission errors on stop).
   */
  const recordingStateRef = useRef<
    "idle" | "starting" | "recording"
  >("idle");

  const startPromiseRef = useRef<Promise<void> | null>(
    null
  );

  /**
   * Timestamp `record()` actually succeeded — used to enforce
   * MIN_RECORDING_MS below. A very short Android MediaRecorder
   * (AAC/MPEG4) capture often doesn't get enough data to
   * finalize a valid container, and OpenAI's transcription API
   * then rejects it outright as "corrupted" rather than just
   * returning an empty transcript — this was hit in testing
   * with a quick tap. Padding the recording out avoids that
   * class of file entirely, rather than trying to detect/handle
   * the malformed-container response after the fact.
   */
  const recordingStartedAtRef = useRef<number | null>(
    null
  );

  const playerRef = useRef<ReturnType<
    typeof createAudioPlayer
  > | null>(null);

  const audioRecorder = useAudioRecorder(
    RecordingPresets.HIGH_QUALITY
  );

  const sendEvent = useCallback(
    (
      type: ClientEventType,
      payload?: unknown
    ) => {
      const ws = wsRef.current;

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      ws.send(
        JSON.stringify({
          type,
          requestId: makeRequestId(),
          payload,
        })
      );
    },
    []
  );

  /**
   * Drains playbackQueueRef one segment at a time — each
   * sentence was already synthesized as its own independent
   * clip (see the wire-format note in realtime.types.ts), so
   * playing them back-to-back as separate files, as soon as
   * each becomes available, sounds the same as one buffered
   * file but starts far sooner. No-ops if something's already
   * playing; the `playbackStatusUpdate` listener calls this
   * again when that finishes, which is what keeps the queue
   * draining. When the queue is empty and the turn has already
   * signaled `audio:completed`, that means there's nothing left
   * to come, so playback is fully done.
   */
  const tryPlayNext = useCallback(() => {
    if (isPlayingRef.current) {
      return;
    }

    const next = playbackQueueRef.current.shift();

    if (!next) {
      if (turnCompleteRef.current) {
        setStatus("ready");
      }

      return;
    }

    isPlayingRef.current = true;
    setStatus("speaking");

    try {
      /*
       * .wav, not .mp3 — the server's active TTS provider
       * (GeminiTtsClient, see gemini-tts.client.ts's
       * DEFAULT_MIME_TYPE) sends WAV bytes. The wire protocol has
       * no explicit format field, so this extension has to be kept
       * in sync by hand with whichever TTS client container.ts
       * actually constructs (OpenAI's would be .mp3 instead).
       */
      const file = new File(
        Paths.cache,
        `voice-reply-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.wav`
      );

      file.write(next);

      playerRef.current?.remove();

      const player = createAudioPlayer(
        file.uri
      );

      playerRef.current = player;

      player.addListener(
        "playbackStatusUpdate",
        (playerStatus) => {
          if (playerStatus.didJustFinish) {
            player.remove();

            if (
              playerRef.current === player
            ) {
              playerRef.current = null;
            }

            isPlayingRef.current = false;
            tryPlayNext();
          }
        }
      );

      player.play();
    } catch (err) {
      isPlayingRef.current = false;

      setError(
        err instanceof Error
          ? err.message
          : "Could not play the reply"
      );

      setStatus("error");
    }
  }, []);

  /** Stops/clears anything mid-playback and resets turn state — shared by cancel/error handling. */
  const resetPlayback = useCallback(() => {
    currentSentenceChunksRef.current = [];
    playbackQueueRef.current = [];
    turnCompleteRef.current = false;
    isPlayingRef.current = false;

    playerRef.current?.remove();
    playerRef.current = null;
  }, []);

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case "session:ready":
          setError(null);
          setStatus("ready");
          return;

        case "turn:mode":
          setTurnMode(
            event.payload as TurnModePayload
          );
          return;

        case "audio:transcribed": {
          const payload =
            event.payload as {
              text: string;
            };

          /*
           * First event of a new turn — reset playback state
           * left over from any previous turn before this one's
           * sentence segments start arriving.
           */
          resetPlayback();

          setTranscript(payload.text);
          setStatus("processing");
          return;
        }

        case "audio:sentence_start":
          currentSentenceChunksRef.current = [];
          return;

        case "audio:sentence_end": {
          const segment = concatChunks(
            currentSentenceChunksRef.current
          );

          currentSentenceChunksRef.current = [];

          if (segment.length > 0) {
            playbackQueueRef.current.push(
              segment
            );

            tryPlayNext();
          }

          return;
        }

        case "audio:completed":
          turnCompleteRef.current = true;

          if (
            !isPlayingRef.current &&
            playbackQueueRef.current
              .length === 0
          ) {
            setStatus("ready");
          }

          return;

        case "audio:cancelled":
          resetPlayback();
          setStatus("ready");
          return;

        case "audio:error":
        case "chat:error": {
          const payload =
            event.payload as {
              message: string;
            };

          resetPlayback();

          /*
           * This is a per-turn failure signaled by the server
           * (rate limit, STT/agent/TTS error, ...) — the
           * connection itself is still open and fine, so there's
           * no reason the mic button should stay disabled. Back
           * to "ready" (not "error") so the user can immediately
           * try the next turn instead of getting stuck — the
           * message is still shown via `error`, just without
           * blocking recording.
           */
          setError(payload.message);
          setStatus("ready");
          return;
        }

        default:
          return;
      }
    },
    [resetPlayback, tryPlayNext]
  );

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    let retryTimeout: ReturnType<
      typeof setTimeout
    > | null = null;

    /**
     * Reused across the initial connect and every retry —
     * skips creating a new conversation once one already
     * exists, so a dropped/failed *connection* doesn't start a
     * new voice chat each time.
     */
    async function ensureConversation(): Promise<boolean> {
      if (conversationIdRef.current) {
        return true;
      }

      try {
        const conversation =
          await createConversation(
            userId,
            token,
            "Voice chat"
          );

        if (cancelled) {
          return false;
        }

        conversationIdRef.current =
          conversation._id;

        return true;
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not start a conversation"
          );

          setStatus("error");
        }

        return false;
      }
    }

    function scheduleReconnect() {
      if (cancelled || retryTimeout) {
        return;
      }

      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        void connect();
      }, RECONNECT_DELAY_MS);
    }

    async function connect() {
      if (cancelled) {
        return;
      }

      setStatus("connecting");

      const ready = await ensureConversation();

      if (!ready) {
        /*
         * A transient network blip on this REST call
         * shouldn't be any more fatal than a dropped
         * WebSocket — retry it the same way.
         */
        scheduleReconnect();
        return;
      }

      const socket = new WebSocket(
        `${WS_BASE_URL}/ws?token=${encodeURIComponent(token)}`
      );

      socket.binaryType = "arraybuffer";
      ws = socket;
      wsRef.current = socket;

      socket.onopen = () => {
        sendEvent("session:start", {
          conversationId:
            conversationIdRef.current,
        });
      };

      /*
       * A real close event always follows a real error for a
       * WebSocket (spec-guaranteed) — reconnecting is handled
       * there so it only happens once per failure, not twice.
       */
      socket.onerror = () => {};

      socket.onclose = () => {
        if (cancelled) {
          return;
        }

        if (wsRef.current === socket) {
          wsRef.current = null;
        }

        setError(
          `Connection lost — retrying in ${RECONNECT_DELAY_MS / 1000}s…`
        );

        setStatus("error");
        scheduleReconnect();
      };

      socket.onmessage = (
        event: MessageEvent
      ) => {
        if (
          event.data instanceof ArrayBuffer
        ) {
          currentSentenceChunksRef.current.push(
            new Uint8Array(event.data)
          );

          return;
        }

        let parsed: ServerEvent;

        try {
          parsed = JSON.parse(
            event.data as string
          );
        } catch {
          return;
        }

        handleServerEvent(parsed);
      };
    }

    (async () => {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });

      /*
       * Requested here, up front, rather than only on first
       * press-and-hold — so the OS permission dialog (which can
       * take the user several seconds to respond to) isn't
       * competing with an actual recording gesture. startRecording
       * still checks/re-requests as a fallback if this hasn't
       * resolved yet or was denied.
       */
      const permission =
        await AudioModule.getRecordingPermissionsAsync();

      if (
        !permission.granted &&
        permission.canAskAgain
      ) {
        await AudioModule.requestRecordingPermissionsAsync();
      }

      await connect();
    })();

    return () => {
      cancelled = true;

      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }

      ws?.close();
      wsRef.current = null;

      playerRef.current?.remove();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, userId]);

  const startRecording = useCallback(() => {
    if (recordingStateRef.current !== "idle") {
      return;
    }

    recordingStateRef.current = "starting";
    setError(null);

    const promise = (async () => {
      try {
        const permission =
          await AudioModule.getRecordingPermissionsAsync();

        let granted = permission.granted;

        if (
          !granted &&
          permission.canAskAgain
        ) {
          const requested =
            await AudioModule.requestRecordingPermissionsAsync();

          granted = requested.granted;
        }

        if (!granted) {
          recordingStateRef.current = "idle";

          setError(
            "Microphone permission is needed to talk — enable it for this app in your phone's Settings."
          );

          setStatus("error");
          return;
        }

        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();

        recordingStateRef.current = "recording";
        recordingStartedAtRef.current = Date.now();

        sendEvent("audio:start", {
          format: "m4a",
        });

        setStatus("recording");
      } catch (err) {
        recordingStateRef.current = "idle";

        setError(
          err instanceof Error
            ? err.message
            : "Could not start recording"
        );

        setStatus("error");
      }
    })();

    startPromiseRef.current = promise;

    void promise.finally(() => {
      startPromiseRef.current = null;
    });
  }, [audioRecorder, sendEvent]);

  const stopRecording = useCallback(
    async () => {
      /*
       * See the recordingStateRef doc comment above — always
       * let an in-flight start settle before deciding whether
       * there's anything to stop.
       */
      if (startPromiseRef.current) {
        await startPromiseRef.current;
      }

      if (recordingStateRef.current !== "recording") {
        return;
      }

      recordingStateRef.current = "idle";

      const elapsedMs =
        Date.now() -
        (recordingStartedAtRef.current ?? Date.now());

      recordingStartedAtRef.current = null;

      if (elapsedMs < MIN_RECORDING_MS) {
        await delay(MIN_RECORDING_MS - elapsedMs);
      }

      await audioRecorder.stop();

      const uri = audioRecorder.uri;

      const ws = wsRef.current;

      if (!uri || !ws || ws.readyState !== WebSocket.OPEN) {
        /*
         * Connection dropped mid-recording — without this, the
         * status would just sit on "processing" forever, since
         * sendEvent silently no-ops when the socket isn't open
         * and nothing would ever move it back. The auto-reconnect
         * above will restore the session; the recording itself
         * is lost (nothing buffers it across a reconnect).
         */
        setError(
          "Connection was lost — that recording wasn't sent. Try again once reconnected."
        );

        setStatus("error");
        return;
      }

      setStatus("processing");

      try {
        const file = new File(uri);
        const bytes = await file.bytes();

        ws.send(bytes);
        sendEvent("audio:end");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not read the recording"
        );

        setStatus("error");
      }
    },
    [audioRecorder, sendEvent]
  );

  const cancelTurn = useCallback(() => {
    sendEvent("chat:cancel");
  }, [sendEvent]);

  return {
    status,
    error,
    transcript,
    turnMode,
    startRecording,
    stopRecording,
    cancelTurn,
  };
}
